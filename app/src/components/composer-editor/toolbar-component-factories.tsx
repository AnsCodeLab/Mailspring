import React from 'react';
import { Range, Editor, Mark, Value, Block, Selection } from 'slate';
import CompactPicker from 'react-color/lib/Compact';
import { localized } from 'mailspring-exports';
import { ComposerEditorPluginToolbarComponentProps } from './types';
import {
  marksToReapply,
  faceFromMarkValue,
  resolveDisplay,
  ptFromMarkValue,
} from './toolbar-utils';

// Helper Functions

// Slate's `value.activeMarks` getter calls `Document.getActiveMarksAtRange`,
// which can throw "Invalid attempt to destructure non-iterable instance" when
// the value's selection references a node the document no longer contains
// (e.g. mid-edit, after a paste, or when a stale value is rendered). We can't
// fix Slate, so funnel every access through this helper: on throw, fall back
// to an empty list. `.find` / `.some` work the same on arrays as on the
// Immutable.Set Slate normally returns, and the next render picks up the
// correct state once Slate re-normalizes.
export function safeActiveMarks(value: Value): Mark[] {
  try {
    return value.activeMarks.toArray();
  } catch (err) {
    return [];
  }
}

export interface IEditorToolbarConfigItem {
  type: string;
  tagNames?: string[];
  render?: (props: {
    node?: Block;
    mark?: any;
    attributes: any;
    children: any;
    targetIsHTML: boolean;
  }) => JSX.Element | void;
  button?: {
    isActive: (value: Value) => boolean;
    onToggle: (editor: Editor, active: boolean) => any;
    iconClass: string;
  };
}

function removeMarksOfTypeInRange(editor: Editor, range: Range | Selection, type: string) {
  if (range.isCollapsed) {
    const active = safeActiveMarks(editor.value).find((m) => m.type === type);
    if (active) {
      editor.removeMark(active);
    }
    return;
  }
  const document = editor.value.document;
  const texts = document.getTextsAtRange(range as any);
  const { start, end } = range;

  texts.forEach((node) => {
    const { key } = node;
    let index = 0;
    let length = node.text.length;

    if (key === start.key) index = start.offset;
    if (key === end.key) length = end.offset;
    if (key === start.key && key === end.key) length = end.offset - start.offset;

    node.getMarks().forEach((mark) => {
      if (mark.type === type) {
        (editor.removeMarkByKey as any)(key, index, length, mark, { normalize: true });
      }
    });
  });
}

export function expandSelectionToRangeOfMark(editor: Editor, type: string) {
  const { selection, document } = editor.value;
  const node = document.getNode(selection.anchor.key);
  let start = selection.anchor.offset;
  let end = selection.anchor.offset;

  // expand backwards until the mark disappears
  while (start > 0 && (node as any).getMarksAtIndex(start).find((m) => m.type === type)) {
    start -= 1;
  }
  // expand forwards until the mark disappears
  while (
    end < node.text.length - 1 &&
    (node as any).getMarksAtIndex(end + 1).find((m) => m.type === type)
  ) {
    end += 1;
  }

  // expand selection
  editor.select({
    anchor: { key: selection.anchor.key, offset: start } as any,
    focus: { key: selection.anchor.key, offset: end } as any,
    isFocused: true,
    isBackward: false,
  } as any);
}

export function getActiveValueForMark(value: Value, type: string) {
  const active = safeActiveMarks(value).find((m) => m.type === type);
  return (active && active.data.get('value')) || '';
}

// Distinct values of `type` across the current selection's text leaves. Empty when the
// mark is absent everywhere; length>1 means a mixed selection. Slate-dependent, verified
// manually; the pure decision lives in resolveDisplay().
export function collectMarkValues(value: Value, type: string): any[] {
  const { selection, document } = value;
  if (selection.isCollapsed) {
    const v = getActiveValueForMark(value, type);
    return v ? [v] : [];
  }
  const seen = new Set<any>();
  let texts;
  try {
    texts = document.getTextsAtRange(selection as any);
  } catch (err) {
    return [];
  }
  const { start, end } = selection as any;
  texts.forEach((node: any) => {
    // Characters of this leaf actually covered by the selection (getTextsAtRange
    // also returns a node the selection only touches at a boundary — 0 chars).
    let from = 0;
    let to = node.text.length;
    if (node.key === start.key) from = start.offset;
    if (node.key === end.key) to = end.offset;
    if (to - from <= 0) return;

    // A Slate Text node groups characters into "leaves" — contiguous runs of
    // uniform marks. node.getMarks() returns the UNION across the whole node, so a
    // node holding "Hello "(sans-serif) + "world"(georgia) reports BOTH faces and a
    // selection of just "world" looks mixed. Walk the leaves and collect only from
    // those overlapping the covered range.
    const leaves = typeof node.getLeaves === 'function' ? node.getLeaves() : null;
    if (leaves) {
      let offset = 0;
      leaves.forEach((leaf: any) => {
        const ls = offset;
        const le = offset + leaf.text.length;
        offset = le;
        if (le <= from || ls >= to) return; // leaf outside the covered range
        leaf.marks.forEach((m: any) => {
          if (m.type === type) seen.add(m.data.get('value'));
        });
      });
    } else {
      node.getMarks().forEach((m: any) => {
        if (m.type === type) seen.add(m.data.get('value'));
      });
    }
  });
  return Array.from(seen);
}

export function applyValueForMark(editor: Editor, type: string, markValue: any) {
  editor.focus();
  removeMarksOfTypeInRange(editor, editor.value.selection, type);

  if (markValue) {
    editor.addMark({
      type,
      data: {
        value: markValue,
      },
    });
  }
}

// Apply a value mark (size/face/color) to the current selection WITHOUT dropping the
// other character marks that were active. Slate's remove+add dance in applyValueForMark
// can clear sibling marks at a collapsed cursor; we snapshot first and re-add what got
// lost. The re-apply decision is the pure marksToReapply helper (unit-tested).
export function applyValueForMarkSafe(editor: Editor, type: string, markValue: any) {
  const saved = safeActiveMarks(editor.value);
  applyValueForMark(editor, type, markValue);
  // Pass an empty presentTypes set so all saved non-target marks are unconditionally
  // re-added. At a collapsed cursor Slate's remove+add dance may clear sibling marks
  // entirely; re-applying them is safe because Slate deduplicates on real text ranges.
  for (const m of marksToReapply(saved as any, new Set<string>(), type)) {
    editor.addMark({ type: m.type, data: { value: m.value } });
  }
}

// React Component Factories

export function BuildToggleButton({
  type,
  button: { iconClass, isActive, onToggle },
}: IEditorToolbarConfigItem) {
  return ({ editor, className, value }: ComposerEditorPluginToolbarComponentProps) => {
    const active = isActive(value);
    const onMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
      onToggle(editor, active);
      e.preventDefault();
    };
    return (
      <button className={`${className} ${active ? 'active' : ''}`} onMouseDown={onMouseDown}>
        <i title={type} className={iconClass} />
      </button>
    );
  };
}

export function BuildMarkButtonWithValuePicker(config) {
  return class ToolbarMarkDataPicker extends React.Component<
    ComposerEditorPluginToolbarComponentProps,
    { expanded: boolean; fieldValue: string }
  > {
    _inputEl: HTMLInputElement;
    _el: HTMLDivElement;

    state = {
      fieldValue: '',
      expanded: false,
    };

    onPrompt = (e: React.MouseEvent) => {
      e.preventDefault();
      const active = safeActiveMarks(this.props.value).find((m) => m.type === config.type);
      const fieldValue = (active && active.data.get(config.field)) || '';
      this.setState({ expanded: true, fieldValue: fieldValue }, () => {
        setTimeout(() => {
          this._inputEl.focus();
          this._inputEl.select();
        }, 0);
      });
    };

    onConfirm = (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault();

      // attach the URL value to the LINK that was created when we opened the link modal
      const { value, editor } = this.props;
      const { fieldValue } = this.state;

      if (fieldValue.trim() === '') {
        this.onRemove(e as React.MouseEvent);
        this.setState({ expanded: false, fieldValue: '' });
        return;
      }

      const newMark = Mark.create({
        type: config.type,
        data: {
          [config.field]: fieldValue,
        },
      });
      const active = safeActiveMarks(value).find((m) => m.type === config.type);
      if (active) {
        // update the active mark
        expandSelectionToRangeOfMark(editor, config.type);
        removeMarksOfTypeInRange(editor, value.selection, config.type);
        editor.addMark(newMark);
        editor.focus();
      } else if (value.selection.isCollapsed) {
        // apply new mark to new text
        editor.addMark(newMark).insertText(fieldValue).removeMark(newMark).insertText(' ').focus();
      } else {
        // apply new mark to selected text
        removeMarksOfTypeInRange(editor, value.selection, config.type);
        editor.addMark(newMark);
        editor.focus();
      }

      this.setState({ expanded: false, fieldValue: '' });
    };

    onRemove = (e: React.MouseEvent) => {
      e.preventDefault();
      const { value, editor } = this.props;
      const active = safeActiveMarks(value).find((m) => m.type === config.type);
      if (value.selection.isCollapsed) {
        const anchorNode = value.document.getNode(value.selection.anchor.key);
        const expanded = value.selection.moveToRangeOfNode(anchorNode);
        editor.removeMarkAtRange(expanded as any, active);
      } else {
        editor.removeMark(active);
      }
    };

    onBlur = (e: React.FocusEvent) => {
      if (!this._el.contains(e.relatedTarget as Node)) {
        this.setState({ expanded: false });
      }
    };

    render() {
      const { value, className } = this.props;
      const { expanded } = this.state;

      const active = safeActiveMarks(value).find((m) => m.type === config.type);
      return (
        <div
          className={`${className} link-picker`}
          ref={(el) => (this._el = el)}
          tabIndex={-1}
          onBlur={this.onBlur}
        >
          {active ? (
            <button className="active" onMouseDown={this.onPrompt}>
              <i className={config.iconClassOn} />
            </button>
          ) : (
            <button onMouseDown={this.onPrompt}>
              <i className={config.iconClassOff} />
            </button>
          )}
          {expanded && (
            <div className="dropdown">
              <input
                type="text"
                placeholder={config.placeholder}
                value={this.state.fieldValue}
                ref={(el) => (this._inputEl = el)}
                onBlur={this.onBlur}
                onChange={(e) => this.setState({ fieldValue: e.target.value })}
                onKeyDown={(e) => {
                  if (e.which === 13) {
                    this.onConfirm(e);
                  }
                }}
              />
              <button onMouseDown={this.onConfirm}>{active ? 'Save' : 'Add'}</button>
            </div>
          )}
        </div>
      );
    }
  };
}

export function BuildColorPicker(config) {
  return class ToolbarColorPicker extends React.Component<
    ComposerEditorPluginToolbarComponentProps,
    { expanded: boolean }
  > {
    _el: HTMLElement;

    constructor(props: ComposerEditorPluginToolbarComponentProps) {
      super(props);
      this.state = {
        expanded: false,
      };
    }

    _onToggleExpanded = () => {
      this.setState({ expanded: !this.state.expanded });
    };

    _onBlur = (e: React.FocusEvent) => {
      if (!this._el.contains(e.relatedTarget as Node)) {
        this.setState({ expanded: false });
      }
    };

    _onChangeComplete = ({ hex }) => {
      this.setState({ expanded: false });
      const { editor } = this.props;
      const markValue = hex !== config.default ? hex : null;
      applyValueForMark(editor, config.type, markValue);
    };

    shouldComponentUpdate(nProps, nState) {
      if (
        getActiveValueForMark(nProps.value, config.type) !==
        getActiveValueForMark(this.props.value, config.type)
      )
        return true;
      if (nState.expanded !== this.state.expanded) return true;
      return false;
    }

    render() {
      const color = getActiveValueForMark(this.props.value, config.type) || config.default;
      const { expanded } = this.state;

      return (
        <div
          tabIndex={-1}
          onBlur={this._onBlur}
          ref={(el) => (this._el = el)}
          className={`color-picker ${this.props.className}`}
        >
          <button
            onClick={this._onToggleExpanded}
            style={{
              backgroundColor: color,
            }}
          />
          {expanded && (
            <div className="dropdown">
              <CompactPicker color={color} onChangeComplete={this._onChangeComplete} />
            </div>
          )}
        </div>
      );
    }
  };
}

export function BuildFontPicker(config) {
  return class FontPicker extends React.Component<ComposerEditorPluginToolbarComponentProps> {
    _onSetValue = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const { editor } = this.props;
      let markValue: string | number | null =
        e.target.value !== config.default ? e.target.value : null;
      if (!(typeof config.options[0].value === 'string')) {
        markValue = Number(markValue);
      }
      applyValueForMark(editor, config.type, markValue);
    };

    shouldComponentUpdate(nextProps) {
      return (
        getActiveValueForMark(nextProps.value, config.type) !==
        getActiveValueForMark(this.props.value, config.type)
      );
    }

    render() {
      const value = getActiveValueForMark(this.props.value, config.type) || config.default;
      const displayed = config.convert(value);

      return (
        <button
          style={{ padding: 0, paddingRight: 6 }}
          className={`${this.props.className} with-select`}
        >
          <i className={config.iconClass} />
          <select value={displayed} onChange={this._onSetValue} tabIndex={-1}>
            {config.options.map(({ name, value }) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </button>
      );
    }
  };
}

export function BuildFontSizeInput(config: {
  type: string;
  default?: string;
  configKey?: string;
  iconClass?: string;
}) {
  const PRESET_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

  return class FontSizeInput extends React.Component<
    ComposerEditorPluginToolbarComponentProps,
    { open: boolean; inputValue: string }
  > {
    _el: HTMLDivElement;
    state = { open: false, inputValue: '' };

    _displayed() {
      const distinct = collectMarkValues(this.props.value, config.type).map((v) =>
        ptFromMarkValue(v)
      );
      const effectiveDefault =
        (config.configKey && AppEnv.config?.get(config.configKey)) || config.default || '';
      return resolveDisplay(distinct, effectiveDefault);
    }

    _apply = (raw: string) => {
      const pt = parseInt(raw, 10);
      const markValue = pt >= 6 && pt <= 200 ? String(pt) + 'pt' : null;
      applyValueForMarkSafe(this.props.editor, config.type, markValue);
      this.setState({ open: false });
    };

    _toggleOpen = (e: React.MouseEvent) => {
      e.preventDefault();
      if (!this.state.open) {
        this.setState({ open: true, inputValue: this._displayed().display });
      } else {
        this.setState({ open: false });
      }
    };

    _onBlur = (e: React.FocusEvent) => {
      if (!this._el.contains(e.relatedTarget as Node)) {
        this.setState({ open: false });
      }
    };

    // The toolbar toggles preventDefault() on mousedown (to keep the editor's
    // selection), which suppresses the blur that would otherwise close us. So we
    // close on any mousedown outside this picker — e.g. clicking the sibling font
    // dropdown — using a capture-phase document listener while open.
    _onDocMouseDown = (e: MouseEvent) => {
      if (this._el && !this._el.contains(e.target as Node)) {
        this.setState({ open: false });
      }
    };

    componentDidUpdate(_prevProps, prevState: { open: boolean }) {
      if (this.state.open && !prevState.open) {
        document.addEventListener('mousedown', this._onDocMouseDown, true);
      } else if (!this.state.open && prevState.open) {
        document.removeEventListener('mousedown', this._onDocMouseDown, true);
      }
    }

    componentWillUnmount() {
      document.removeEventListener('mousedown', this._onDocMouseDown, true);
    }

    render() {
      const { open, inputValue } = this.state;
      const { display } = this._displayed();
      return (
        <div
          className={`${this.props.className} font-size-picker`}
          tabIndex={-1}
          ref={(el) => (this._el = el)}
          onBlur={this._onBlur}
        >
          <button className="dropdown-toggle" onMouseDown={this._toggleOpen}>
            <i className={config.iconClass || 'fa fa-text-height'} />
            <span className="value">{display}</span>
            <i className="fa fa-caret-down" />
          </button>
          {open && (
            <div className="dropdown menu">
              <input
                type="number"
                min={6}
                max={200}
                autoFocus
                value={inputValue}
                onChange={(e) => this.setState({ inputValue: e.target.value })}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    this._apply((e.target as HTMLInputElement).value);
                  }
                  if (e.key === 'Escape') {
                    this.setState({ open: false });
                  }
                  e.stopPropagation();
                }}
              />
              {PRESET_SIZES.map((size) => (
                <div
                  key={size}
                  className={`item ${String(size) === display ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    this._apply(String(size));
                  }}
                >
                  {String(size) === display && <i className="fa fa-check" />}
                  {size}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
  };
}

export function BuildFontFacePicker(config: {
  type: string;
  default?: string;
  configKey?: string;
  options: Array<{ name: string; value: string }>;
}) {
  return class FontFacePicker extends React.Component<
    ComposerEditorPluginToolbarComponentProps,
    { open: boolean; custom: boolean; customValue: string }
  > {
    _el: HTMLDivElement;

    state = { open: false, custom: false, customValue: '' };

    _effectiveDefault() {
      return (config.configKey && AppEnv.config?.get(config.configKey)) || config.default || '';
    }

    _activeValue() {
      const distinct = collectMarkValues(this.props.value, config.type).map((v) =>
        faceFromMarkValue(v, config.options)
      );
      // Show the option label for the resolved value, blank when mixed.
      const { display, mixed } = resolveDisplay(distinct, this._effectiveDefault());
      if (mixed) return { label: '', value: '' };
      const opt = config.options.find((o) => o.value === display);
      return { label: opt ? opt.name : display, value: display };
    }

    _toggleOpen = (e: React.MouseEvent) => {
      e.preventDefault();
      this.setState({ open: !this.state.open, custom: false });
    };

    _onBlur = (e: React.FocusEvent) => {
      if (!this._el.contains(e.relatedTarget as Node)) {
        this.setState({ open: false, custom: false });
      }
    };

    // Close on any mousedown outside this picker (e.g. clicking the sibling font-size
    // dropdown). The toggles preventDefault() on mousedown to preserve the editor
    // selection, which suppresses blur, so we rely on a capture-phase document listener.
    _onDocMouseDown = (e: MouseEvent) => {
      if (this._el && !this._el.contains(e.target as Node)) {
        this.setState({ open: false, custom: false });
      }
    };

    componentDidUpdate(_prevProps, prevState: { open: boolean }) {
      if (this.state.open && !prevState.open) {
        document.addEventListener('mousedown', this._onDocMouseDown, true);
      } else if (!this.state.open && prevState.open) {
        document.removeEventListener('mousedown', this._onDocMouseDown, true);
      }
    }

    componentWillUnmount() {
      document.removeEventListener('mousedown', this._onDocMouseDown, true);
    }

    _apply = (faceValue: string | null) => {
      // Selecting the default (e.g. "Sans Serif" = 'sans-serif') clears any existing
      // font mark rather than writing a CSS generic into the HTML. CSS generics like
      // 'sans-serif' have no real font backing in LibreOffice/Word, causing errors on paste.
      const markValue = faceValue === this._effectiveDefault() ? null : faceValue;
      applyValueForMarkSafe(this.props.editor, config.type, markValue);
      this.setState({ open: false, custom: false });
    };

    render() {
      const { open, custom, customValue } = this.state;
      const active = this._activeValue();
      return (
        <div
          className={`${this.props.className} font-face-picker`}
          tabIndex={-1}
          ref={(el) => (this._el = el)}
          onBlur={this._onBlur}
        >
          <button className="dropdown-toggle" onMouseDown={this._toggleOpen}>
            <span className="value">{active.label || localized('Font')}</span>
            <i className="fa fa-caret-down" />
          </button>
          {open && (
            <div className="dropdown menu">
              {config.options.map((o) => (
                <div
                  key={o.value}
                  className={`item ${o.value === active.value ? 'active' : ''}`}
                  style={{ fontFamily: o.value }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    this._apply(o.value);
                  }}
                >
                  {o.value === active.value && <i className="fa fa-check" />}
                  {o.name}
                </div>
              ))}
              <div className="divider" />
              {custom ? (
                <input
                  type="text"
                  autoFocus
                  placeholder={localized('Custom font…')}
                  value={customValue}
                  onChange={(e) => this.setState({ customValue: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customValue.trim()) this._apply(customValue.trim());
                    if (e.key === 'Escape') this.setState({ open: false, custom: false });
                    e.stopPropagation();
                  }}
                />
              ) : (
                <div
                  className="item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    this.setState({ custom: true });
                  }}
                >
                  {localized('Custom…')}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }
  };
}
