import React from 'react';
import { Editor, Value, Node, Block } from 'slate';
import SoftBreak from 'slate-soft-break';
import EditList from '@bengotow/slate-edit-list';
import AutoReplace from 'slate-auto-replace';
import When from 'slate-when';

import { MessageWithEditorState, localized } from 'mailspring-exports';
import {
  BuildToggleButton,
  BuildBlockTypeDropdown,
  BuildAlignButtonGroup,
  IEditorToolbarConfigItem,
} from './toolbar-component-factories';
import { ComposerEditorPlugin } from './types';

function nodeIsEmpty(node: Node) {
  if (node.text !== '') {
    return false;
  }

  if (node.object !== 'text') {
    const children = ((node.nodes.toArray ? node.nodes.toArray() : node.nodes) || []) as any;
    if (children.length === 0) {
      return true;
    }
    if (children.length === 1 && children[0].object === 'text') {
      return true;
    }
  }
  return false;
}

function isBlockTypeOrWithinType(value: Value, type: string) {
  if (!value.focusBlock) {
    return false;
  }
  const isMe = value.focusBlock.type === type;
  const isParent = value.document
    .getAncestors(value.focusBlock.key)
    .find((b) => b.object === 'block' && b.type === type);

  return !!(isMe || isParent);
}

function toggleBlockTypeWithBreakout(editor: Editor, type: string) {
  if (!editor.value.focusBlock) return;

  const ancestors = editor.value.document.getAncestors(editor.value.focusBlock.key);

  let idx = ancestors.findIndex((b) => b.object === 'block' && b.type === type);
  if (idx === -1 && editor.value.focusBlock.type === type) {
    idx = ancestors.size - 1;
  }

  if (idx !== -1) {
    const depth = ancestors.size - idx;
    if (depth > 0) {
      editor.splitBlock(ancestors.size - idx);
      for (let x = 0; x < depth; x++) editor.unwrapBlock({ type });
    }
    editor.setBlocks(BLOCK_CONFIG.div.type);
  } else {
    editor.setBlocks(type);
  }
}

export const BLOCKQUOTE_TYPE = 'blockquote';

export function isWithinListOrQuote(value: Value): boolean {
  return (
    isBlockTypeOrWithinType(value, BLOCK_CONFIG.list_item.type) ||
    isBlockTypeOrWithinType(value, BLOCKQUOTE_TYPE)
  );
}

// The heading dropdown converts the current block in place (plain `editor.setBlocks`,
// no breakout transform), which is only safe when the block isn't nested inside a list
// item or blockquote. It stays enabled while already inside a heading — that's how you
// switch back to Normal.
export function isHeadingDropdownDisabled(value: Value): boolean {
  return isWithinListOrQuote(value);
}

// Alignment/direction only ever apply to BLOCK_CONFIG.div; disable (not hide) the
// controls anywhere else they'd be meaningless or unsafe: inside a list item or
// blockquote (same nesting risk as the heading dropdown), or on a heading itself.
export function isAlignDirDisabled(value: Value): boolean {
  return (
    isWithinListOrQuote(value) ||
    isBlockTypeOrWithinType(value, BLOCK_CONFIG.heading_one.type) ||
    isBlockTypeOrWithinType(value, BLOCK_CONFIG.heading_two.type)
  );
}

// `div` node data is an Immutable.Map on the live-editing render path but a plain
// object on the HTML-serialize path (the deserialize rule below returns a plain JS
// object for `data`) — every read of block data must handle both shapes.
export function readBlockData(data: any, key: string): any {
  if (!data) return undefined;
  return typeof data.get === 'function' ? data.get(key) : data[key];
}

// `editor.setNodeByKey`/`setBlocks` REPLACE a block's entire `data` field rather than
// merging into it, so every block-data write must merge the patch into the existing
// data itself first, or a write of `align` would silently drop an existing `className`
// or `dir` (and vice versa).
export function mergeBlockData(currentData: any, patch: Record<string, any>): any {
  if (currentData && typeof currentData.merge === 'function') {
    return currentData.merge(patch);
  }
  return { ...(currentData || {}), ...patch };
}

export function currentBlockAlign(value: Value): string | undefined {
  return value.focusBlock ? readBlockData(value.focusBlock.data, 'align') : undefined;
}

export function currentBlockDir(value: Value): string | undefined {
  return value.focusBlock ? readBlockData(value.focusBlock.data, 'dir') : undefined;
}

// Clicking an already-active alignment button clears it; clicking a different one
// applies it.
export function nextAlignValue(current: string | null | undefined, clicked: string): string | null {
  return current === clicked ? null : clicked;
}

export function setDivBlockData(editor: Editor, patch: Record<string, any>) {
  const { focusBlock } = editor.value;
  if (!focusBlock) return editor;
  // @types/slate's BlockProperties requires `type` even though setNodeByKey only patches
  // the properties given — pass the block's own (unchanged) type alongside the data patch
  // to satisfy the signature without widening to `any`/a cast.
  return editor.setNodeByKey(focusBlock.key, {
    type: focusBlock.type,
    data: mergeBlockData(focusBlock.data, patch),
  });
}

export function indentBlock(editor: Editor) {
  const focusBlock = editor.value.focusBlock;
  if (focusBlock && focusBlock.type === BLOCK_CONFIG.div.type) {
    return editor.setBlocks(BLOCK_CONFIG.blockquote.type);
  }
  return editor;
}

export function outdentBlock(editor: Editor) {
  const focusBlock = editor.value.focusBlock;
  if (focusBlock && focusBlock.type === BLOCK_CONFIG.blockquote.type) {
    return editor.setBlocks(BLOCK_CONFIG.div.type);
  }
  return editor;
}

export const BLOCK_CONFIG: {
  [key: string]: IEditorToolbarConfigItem;
} = {
  div: {
    type: 'div',
    tagNames: ['div', 'br', 'p'],
    render: ({ node, attributes, children, targetIsHTML }) => {
      const align = readBlockData(node.data, 'align');
      const explicitDir = readBlockData(node.data, 'dir');
      const style: React.CSSProperties = {};
      if (align) style.textAlign = align;
      const styleProp = Object.keys(style).length ? style : undefined;

      // An explicit user-set direction always wins; only fall back to Slate's
      // content-based auto-detection (HTML export only) when none was set.
      let dir: string = undefined;
      if (explicitDir === 'rtl' || explicitDir === 'ltr') {
        dir = explicitDir;
      } else if (targetIsHTML && node.isLeafBlock() && node.getTextDirection() === 'rtl') {
        dir = 'rtl';
      }

      if (targetIsHTML && nodeIsEmpty(node)) {
        return <br {...attributes} dir={dir} style={styleProp} />;
      }
      return (
        <div
          {...attributes}
          dir={dir}
          className={readBlockData(node.data, 'className')}
          style={styleProp}
        >
          {children}
        </div>
      );
    },
  },
  blockquote: {
    type: BLOCKQUOTE_TYPE,
    tagNames: ['blockquote'],
    render: (props) => (
      <blockquote {...props.attributes} spellCheck={false}>
        {props.children}
      </blockquote>
    ),
    button: {
      iconClass: 'fa fa-quote-left',
      isActive: (value) => {
        return isBlockTypeOrWithinType(value, BLOCK_CONFIG.blockquote.type);
      },
      onToggle: (editor: Editor, active) => {
        return toggleBlockTypeWithBreakout(editor, BLOCK_CONFIG.blockquote.type);
      },
    },
  },
  code: {
    type: 'code',
    tagNames: ['pre'],
    render: (props) => (
      <code {...props.attributes} spellCheck={false}>
        <pre
          style={{
            backgroundColor: `rgba(0,0,0,0.05)`,
            padding: `0.2em 1em`,
          }}
        >
          {props.children}
        </pre>
      </code>
    ),
    button: {
      isActive: (value) => value.focusBlock && value.focusBlock.type === BLOCK_CONFIG.code.type,
      iconClass: 'fa fa-sticky-note-o',
      onToggle: (editor, active) => {
        if (active) {
          return editor.setBlocks(BLOCK_CONFIG.div.type);
        } else if (editor.value.selection.isCollapsed) {
          return editor.setBlocks(BLOCK_CONFIG.code.type);
        } else {
          const value = editor.value;
          // Collect all the text fragments which are being converted to a code block
          const texts = value.document
            .getTextsAtRange(value.selection as any)
            .toArray()
            .map((t) => {
              if (t.key === value.selection.anchor.key) {
                return value.selection.isBackward
                  ? t.text.substr(0, value.selection.anchor.offset)
                  : t.text.substr(value.selection.anchor.offset);
              } else if (t.key === value.selection.focus.key) {
                return value.selection.isBackward
                  ? t.text.substr(value.selection.focus.offset)
                  : t.text.substr(0, value.selection.focus.offset);
              } else {
                return t.text;
              }
            });

          if (texts[0] === '') {
            texts.shift();
          }
          if (texts[texts.length - 1] === '') {
            texts.pop();
          }
          // Remove leading spaces that are present on every line
          let minLeadingSpaces = 1000;
          texts
            .filter((text) => text.trim().length > 0)
            .forEach((text) => {
              const match = /^ +/.exec(text);
              if (match === null) {
                minLeadingSpaces = 0;
              } else {
                minLeadingSpaces = Math.min(minLeadingSpaces, match[0].length);
              }
            });
          // Join the text blocks together into a single string
          const text = texts.map((t) => t.substr(minLeadingSpaces)).join('\n');

          // Delete the selection and insert a single code block with the text
          return editor
            .delete()
            .insertBlock(BLOCK_CONFIG.code.type)
            .insertText(text)
            .insertBlock(BLOCK_CONFIG.div.type);
        }
      },
    },
  },
  ol_list: {
    type: 'ol_list',
    tagNames: ['ol'],
    render: (props) => <ol {...props.attributes}>{props.children}</ol>,
    button: {
      iconClass: 'fa fa-list-ol',
      isActive: (value) => {
        const list = EditListPlugin.utils.getCurrentList(value);
        return list && list.type === BLOCK_CONFIG.ol_list.type;
      },
      onToggle: (editor: Editor, active) =>
        active
          ? EditListPlugin.changes.unwrapList(editor)
          : EditListPlugin.changes.wrapInList(editor, BLOCK_CONFIG.ol_list.type),
    },
  },
  ul_list: {
    type: 'ul_list',
    tagNames: ['ul'],
    render: (props) => <ul {...props.attributes}>{props.children}</ul>,
    button: {
      iconClass: 'fa fa-list-ul',
      isActive: (value) => {
        const list = EditListPlugin.utils.getCurrentList(value);
        return list && list.type === BLOCK_CONFIG.ul_list.type;
      },
      onToggle: (editor: Editor, active) =>
        active
          ? EditListPlugin.changes.unwrapList(editor)
          : EditListPlugin.changes.wrapInList(editor, BLOCK_CONFIG.ul_list.type),
    },
  },
  list_item: {
    type: 'list_item',
    tagNames: ['li'],
    render: (props) => <li {...props.attributes}>{props.children}</li>,
  },
  heading_one: {
    type: 'heading_one',
    tagNames: ['h1'],
    render: (props) => <h1 {...props.attributes}>{props.children}</h1>,
  },
  heading_two: {
    type: 'heading_two',
    tagNames: ['h2'],
    render: (props) => <h2 {...props.attributes}>{props.children}</h2>,
  },
};

export const EditListPlugin = new EditList({
  types: [BLOCK_CONFIG.ol_list.type, BLOCK_CONFIG.ul_list.type],
  typeItem: BLOCK_CONFIG.list_item.type,
  typeDefault: BLOCK_CONFIG.div.type,
});

function renderNode(props, editor: Editor = null, next = () => {}) {
  const config = BLOCK_CONFIG[props.node.type];
  return config ? config.render(props) : next();
}

// Merges className + align + dir into one data object so a single deserialized node can
// carry multiple style-driving keys at once (the block-config lookup above only returns
// ONE matched config, so this must be a single combined object, not several separate
// single-key returns).
function buildBlockDeserializeData(
  el: HTMLElement
): { className?: string; align?: string; dir?: string } | undefined {
  const data: { className?: string; align?: string; dir?: string } = {};

  const className = el.getAttribute('class');
  if (className) data.className = className;

  const align = el.style && el.style.textAlign;
  if (align) data.align = align;

  const dirAttr = el.getAttribute('dir');
  if (dirAttr === 'rtl' || dirAttr === 'ltr') {
    data.dir = dirAttr;
  } else if (el.style && el.style.direction === 'rtl') {
    data.dir = 'rtl';
  }

  return Object.keys(data).length ? data : undefined;
}

const rules = [
  {
    deserialize(el: HTMLElement, next) {
      const tagName = el.tagName.toLowerCase();
      let config = Object.values(BLOCK_CONFIG).find((c) => c.tagNames.includes(tagName));

      // apply a few special rules:
      // block elements with monospace font are translated to <code> blocks
      if (
        ['div', 'blockquote'].includes(tagName) &&
        !el.classList.contains('gmail_default') &&
        (el.style.fontFamily || el.style.font || '').includes('monospace')
      ) {
        config = BLOCK_CONFIG.code;
      }

      // div elements that are entirely empty and have no meaningful-looking styles applied
      // would probably just add extra whitespace
      const empty = !el.hasChildNodes();
      if (tagName === 'div' && empty) {
        const s = (el.getAttribute('style') || '').toLowerCase();
        if (!s.includes('background') && !s.includes('margin') && !s.includes('padding')) {
          return;
        }
      }

      // return block
      if (config) {
        return {
          object: 'block',
          type: config.type,
          nodes: next(el.childNodes),
          data: buildBlockDeserializeData(el),
        };
      }
    },
    serialize(obj: any, children: any) {
      if (obj.object !== 'block') return;
      return renderNode({ node: obj, children, targetIsHTML: true });
    },
  },
];

// support functions

export function hasBlockquote(value: Value) {
  const nodeHasBlockquote = (node) => {
    if (!node.nodes) return false;
    for (const childNode of node.nodes.toArray()) {
      if (childNode.type === BLOCK_CONFIG.blockquote.type || nodeHasBlockquote(childNode)) {
        return true;
      }
    }
  };
  return nodeHasBlockquote(value.document);
}

export function hasNonTrailingBlockquote(value: Value) {
  const nodeHasNonTrailingBlockquote = (node) => {
    if (!node.nodes) return false;
    let found = false;
    for (const block of node.nodes.toArray()) {
      if (block.type === BLOCK_CONFIG.blockquote.type) {
        found = true;
      } else if (found && block.text.length > 0) {
        return true;
      } else if (nodeHasNonTrailingBlockquote(block)) {
        return true;
      }
    }
  };
  return nodeHasNonTrailingBlockquote(value.document);
}

export function allNodesInBFSOrder(value: Value) {
  const all = [];
  const collect = (node) => {
    if (!node.nodes) return;
    all.push(node);
    node.nodes.toArray().forEach(collect);
  };
  collect(value.document);
  return all;
}

export function isQuoteNode(n: Node) {
  return (
    n.object === 'block' &&
    (n.type === BLOCKQUOTE_TYPE ||
      (n.data && n.data.get('className') && n.data.get('className').includes('gmail_quote')))
  );
}

export function lastUnquotedNode(value: Value) {
  const all = allNodesInBFSOrder(value);
  for (let idx = 0; idx < all.length; idx++) {
    const n = all[idx];
    if (isQuoteNode(n)) {
      return all[Math.max(0, idx - 1)];
    }
  }
  return all[0];
}

export function removeQuotedText(editor: Editor) {
  let quoteBlock = null;
  while ((quoteBlock = allNodesInBFSOrder(editor.value).find(isQuoteNode))) {
    editor.removeNodeByKey(quoteBlock.key);
  }
}

export function hideQuotedTextByDefault(draft: MessageWithEditorState) {
  if (draft.isForwarded()) {
    return false;
  }
  if (hasNonTrailingBlockquote(draft.bodyEditorState)) {
    return false;
  }
  return true;
}

const BLOCK_TYPE_OPTIONS = [
  { name: localized('Normal'), value: BLOCK_CONFIG.div.type },
  { name: localized('Heading 1'), value: BLOCK_CONFIG.heading_one.type },
  { name: localized('Heading 2'), value: BLOCK_CONFIG.heading_two.type },
  { name: localized('Quote'), value: BLOCKQUOTE_TYPE },
];

const BlockTypeDropdown = BuildBlockTypeDropdown({
  options: BLOCK_TYPE_OPTIONS,
  default: BLOCK_CONFIG.div.type,
  isDisabled: isHeadingDropdownDisabled,
  onSetBlockType: (editor, type) => editor.setBlocks(type),
});

const ALIGN_OPTIONS = [
  { value: 'left', iconClass: 'fa fa-align-left', title: localized('Align left') },
  { value: 'center', iconClass: 'fa fa-align-center', title: localized('Align center') },
  { value: 'right', iconClass: 'fa fa-align-right', title: localized('Align right') },
  { value: 'justify', iconClass: 'fa fa-align-justify', title: localized('Justify') },
];

const AlignButtonGroup = BuildAlignButtonGroup({
  options: ALIGN_OPTIONS,
  isActive: (value, align) => currentBlockAlign(value) === align,
  isDisabled: isAlignDirDisabled,
  onToggle: (editor, value, align) =>
    setDivBlockData(editor, { align: nextAlignValue(currentBlockAlign(value), align) }),
});

const IndentButton = BuildToggleButton({
  type: 'indent',
  button: {
    isActive: () => false,
    onToggle: (editor) => indentBlock(editor),
    iconClass: 'fa fa-indent',
  },
});

const OutdentButton = BuildToggleButton({
  type: 'outdent',
  button: {
    isActive: () => false,
    onToggle: (editor) => outdentBlock(editor),
    iconClass: 'fa fa-outdent',
  },
});

const DirToggleButton = BuildToggleButton({
  type: 'dir',
  button: {
    isActive: (value) => currentBlockDir(value) === 'rtl',
    isDisabled: isAlignDirDisabled,
    onToggle: (editor, active) => setDivBlockData(editor, { dir: active ? 'ltr' : 'rtl' }),
    iconClass: 'fa fa-text-width',
  },
});

// plugins

const MailspringBaseBlockPlugin: ComposerEditorPlugin = {
  toolbarComponents: [
    BlockTypeDropdown,
    ...Object.values(BLOCK_CONFIG)
      .filter((config) => config.button)
      .map(BuildToggleButton),
    AlignButtonGroup,
    IndentButton,
    OutdentButton,
    DirToggleButton,
  ],
  renderNode,
  appCommands: {
    'core:select-all': (event, editor: Editor) => {
      // If the document contains void blocks the browser's natural solution is to set
      // the selection to a DOM fragment range not to a contenteditable text range
      // (or something like that.) This makes select-all + delete work consistently.
      event.preventDefault();
      event.stopPropagation();
      return editor.moveToRangeOfDocument();
    },
    'contenteditable:quote': (event, editor: Editor) => {
      const { isActive, onToggle } = BLOCK_CONFIG.blockquote.button;
      return onToggle(editor, isActive(editor.value));
    },
    'contenteditable:numbered-list': (event, editor: Editor) => {
      const { isActive, onToggle } = BLOCK_CONFIG.ol_list.button;
      return onToggle(editor, isActive(editor.value));
    },
    'contenteditable:bulleted-list': (event, editor: Editor) => {
      const { isActive, onToggle } = BLOCK_CONFIG.ul_list.button;
      return onToggle(editor, isActive(editor.value));
    },
    'contenteditable:indent': (event, editor: Editor) => indentBlock(editor),
    'contenteditable:outdent': (event, editor: Editor) => outdentBlock(editor),
  },
  rules,
};

const plugins: ComposerEditorPlugin[] = [
  // Base implementation of BLOCK_CONFIG block types,
  // the "block" toolbar section, and serialization
  MailspringBaseBlockPlugin,

  // Return creates soft newlines in code blocks
  When({
    when: (value) => value.blocks.some((b) => b.type === BLOCK_CONFIG.code.type),
    plugin: SoftBreak(),
  }),

  // Pressing backspace when you're at the top of the document should not delete down
  {
    onKeyDown: function onKeyDown(event: React.KeyboardEvent, editor: Editor, next: () => void) {
      if (event.key !== 'Backspace' || event.shiftKey || event.metaKey || event.altKey) {
        return next();
      }
      const { selection, focusText, document } = editor.value;
      const firstText = document.getFirstText();
      if (
        selection.isCollapsed &&
        selection.focus &&
        selection.focus.offset === 0 &&
        focusText &&
        firstText &&
        firstText.key === focusText.key
      ) {
        event.preventDefault();
        return;
      } else {
        return next();
      }
    },
  },

  // Return breaks you out of blockquotes completely
  {
    onKeyDown: function onKeyDown(event: React.KeyboardEvent, editor: Editor, next: () => void) {
      if (event.shiftKey) {
        return next();
      }
      if (event.key !== 'Enter') {
        return next();
      }
      if (!isBlockTypeOrWithinType(editor.value, BLOCK_CONFIG.blockquote.type)) {
        return next();
      }
      toggleBlockTypeWithBreakout(editor, BLOCK_CONFIG.blockquote.type);
      event.preventDefault(); // since this inserts a newline
    },
  },

  // Tabbing in / out in lists, enter to start new list item
  EditListPlugin,

  // "1. " and "- " start new lists
  AutoReplace({
    onlyIn: [BLOCK_CONFIG.div.type, BLOCK_CONFIG.div.type],
    trigger: ' ',
    before: /^([-]{1})$/,
    change: (transform, e, matches) => {
      EditListPlugin.changes.wrapInList(transform, BLOCK_CONFIG.ul_list.type);
    },
  }),
  AutoReplace({
    onlyIn: [BLOCK_CONFIG.div.type, BLOCK_CONFIG.div.type],
    trigger: ' ',
    before: /^([1]{1}[.]{1})$/,
    change: (transform, e, matches) => {
      EditListPlugin.changes.wrapInList(transform, BLOCK_CONFIG.ol_list.type);
    },
  }),
];

export default plugins;
