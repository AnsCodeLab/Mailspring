import React from 'react';
import { Editor, Value, Range } from 'slate';
import { clipboard as ElectronClipboard } from 'electron';
import { localized, InlineStyleTransformer, SanitizeTransformer } from 'mailspring-exports';
import { ComposerEditorPlugin, ComposerEditorPluginToolbarComponentProps } from './types';
import { safeActiveMarks, applyValueForMark } from './toolbar-component-factories';
import {
  captureCharacterMarks,
  canCopyOrCut,
  canPaint,
  TOGGLE_MARK_TYPES,
  VALUE_MARK_TYPES,
  CapturedMark,
} from './toolbar-utils';

// Lazy imports to break the circular dependency with conversion.tsx (which imports this
// module to register it in the plugins array, and this module needs conversion utilities).
// Deferring to inside function bodies ensures conversion.tsx has fully evaluated first.
function getConversionFns() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./conversion') as {
    convertFromHTML: (html: string) => Value;
    convertToHTML: (value: Value) => string;
    convertToPlainText: (value: Value) => string;
  };
}

type ClipboardLike = Pick<
  typeof ElectronClipboard,
  'writeText' | 'write' | 'readText' | 'readHTML'
>;

// --- Slate orchestration (tested with a fake editor/clipboard) ---

export function copySelectionToClipboard(editor: Editor, clipboard: ClipboardLike): boolean {
  if (editor.value.selection.isCollapsed) {
    return false;
  }
  const { convertToPlainText, convertToHTML } = getConversionFns();
  const range = editor.value.selection as any as Range;
  const fragment = editor.value.document.getFragmentAtRange(range);
  const value = Value.create({ document: fragment });
  const text = convertToPlainText(value);
  if (!text) {
    return false;
  }
  clipboard.write({ text, html: convertToHTML(value) });
  return true;
}

export function pasteFromClipboard(editor: Editor, clipboard: ClipboardLike) {
  const { convertFromHTML } = getConversionFns();
  let html = clipboard.readHTML();
  if (html) {
    html = SanitizeTransformer.runSync(html);
    try {
      html = InlineStyleTransformer.runSync(html);
    } catch (err) {
      // no-op — fall through to whatever sanitize produced
    }
    const value = convertFromHTML(html);
    if (value && value.document) {
      editor.insertFragment(value.document);
      return;
    }
  }
  const text = clipboard.readText();
  if (text) {
    editor.insertText(text);
  }
}

export function pastePlainFromClipboard(editor: Editor, clipboard: ClipboardLike) {
  const text = clipboard.readText();
  if (text) {
    editor.insertText(text);
  }
}

// Apply a captured set of character marks to the current selection so it matches the
// source: captured toggle marks are turned on, uncaptured ones off; value marks are set
// to the captured value or cleared.
export function applyCapturedMarks(editor: Editor, captured: CapturedMark[]) {
  const types = new Set(captured.map((c) => c.type));
  const active = safeActiveMarks(editor.value);
  for (const t of TOGGLE_MARK_TYPES) {
    const present = active.some((m) => m.type === t);
    if (types.has(t) && !present) {
      editor.addMark(t);
    }
    if (!types.has(t) && present) {
      editor.removeMark(active.find((m) => m.type === t));
    }
  }
  for (const t of VALUE_MARK_TYPES) {
    const c = captured.find((x) => x.type === t);
    applyValueForMark(editor, t, c ? c.value : null);
  }
  editor.focus();
}

// --- Toolbar buttons ---

function ClipboardButton({
  icon,
  title,
  disabled,
  onMouseDown,
  active,
  className,
}: {
  icon: string;
  title: string;
  disabled?: boolean;
  active?: boolean;
  className: string;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      className={`${className} ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) {
          onMouseDown(e);
        }
      }}
    >
      <i title={title} className={icon} />
    </button>
  );
}

const CutButton = (props: ComposerEditorPluginToolbarComponentProps) => (
  <ClipboardButton
    className={props.className}
    icon="fa fa-scissors"
    title={localized('Cut')}
    disabled={!canCopyOrCut(props.value.selection.isCollapsed)}
    onMouseDown={() => {
      if (copySelectionToClipboard(props.editor, ElectronClipboard)) {
        props.editor.delete();
      }
    }}
  />
);

const CopyButton = (props: ComposerEditorPluginToolbarComponentProps) => (
  <ClipboardButton
    className={props.className}
    icon="fa fa-copy"
    title={localized('Copy')}
    disabled={!canCopyOrCut(props.value.selection.isCollapsed)}
    onMouseDown={() => copySelectionToClipboard(props.editor, ElectronClipboard)}
  />
);

const PasteButton = (props: ComposerEditorPluginToolbarComponentProps) => (
  <ClipboardButton
    className={props.className}
    icon="fa fa-clipboard"
    title={localized('Paste')}
    onMouseDown={() => pasteFromClipboard(props.editor, ElectronClipboard)}
  />
);

const PastePlainButton = (props: ComposerEditorPluginToolbarComponentProps) => (
  <ClipboardButton
    className={props.className}
    icon="fa fa-clipboard"
    title={localized('Paste as plain text')}
    onMouseDown={() => pastePlainFromClipboard(props.editor, ElectronClipboard)}
  />
);

// Format Painter — one-shot. Click captures the character marks at the current selection
// and arms; the next non-collapsed selection has those marks applied, then it disarms.
// Esc or a second click cancels.
class FormatPainterButton extends React.Component<
  ComposerEditorPluginToolbarComponentProps,
  { armed: boolean }
> {
  _captured: CapturedMark[] = [];
  state = { armed: false };

  componentDidUpdate(prevProps: ComposerEditorPluginToolbarComponentProps) {
    if (!this.state.armed) {
      return;
    }
    const sel = this.props.value.selection;
    const prevSel = prevProps.value.selection;
    // Apply once the user has made a NEW non-collapsed selection.
    if (!sel.isCollapsed && sel !== prevSel) {
      applyCapturedMarks(this.props.editor, this._captured);
      this._disarm();
    }
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this._onKeyDown);
  }

  _onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this._disarm();
    }
  };

  _disarm = () => {
    document.removeEventListener('keydown', this._onKeyDown);
    if (this.state.armed) {
      this.setState({ armed: false });
    }
  };

  _onMouseDown = () => {
    if (this.state.armed) {
      this._disarm();
      return;
    }
    this._captured = captureCharacterMarks(safeActiveMarks(this.props.value) as any);
    if (!canPaint(this._captured)) {
      return;
    }
    document.addEventListener('keydown', this._onKeyDown);
    this.setState({ armed: true });
  };

  render() {
    const captured = captureCharacterMarks(safeActiveMarks(this.props.value) as any);
    return (
      <ClipboardButton
        className={this.props.className}
        icon="fa fa-paint-brush"
        title={localized('Format Painter')}
        active={this.state.armed}
        disabled={!this.state.armed && !canPaint(captured)}
        onMouseDown={this._onMouseDown}
      />
    );
  }
}

const ClipboardPlugin: ComposerEditorPlugin = {
  toolbarSectionClass: 'clipboard-section',
  toolbarComponents: [CutButton, CopyButton, PasteButton, PastePlainButton, FormatPainterButton],
};

const ClipboardPlugins: ComposerEditorPlugin[] = [ClipboardPlugin];
export default ClipboardPlugins;
