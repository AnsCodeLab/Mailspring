import React from 'react';
import { Editor, Value, Document, Block, Node, BlockJSON, SchemaProperties } from 'slate';
import SoftBreak from 'slate-soft-break';
import When from 'slate-when';

import { BuildToggleButton } from './toolbar-component-factories';
import { BLOCK_CONFIG } from './base-block-plugins';
import { ComposerEditorPlugin, Rule } from './types';

export const TABLE_TYPE = 'table';
export const TABLE_ROW_TYPE = 'table_row';
export const TABLE_CELL_TYPE = 'table_cell';

// `document.getParent` is typed to return `Node | null` (a cell/row's parent could, in
// principle, be any node kind), but by construction a table_row's parent is always the
// enclosing table block and a table_cell's parent is always the enclosing row block --
// both real `Block`s. Centralizing the one unavoidable assertion here (rather than
// scattering `as Block` through every call site) keeps it auditable.
function parentBlock(document: Document, key: string): Block {
  return document.getParent(key) as Block;
}

// `TABLE_CELL_TYPE`'s and `TABLE_ROW_TYPE`'s normalize callbacks below both need to
// hoist an alien block out to be a genuine sibling of the ENCLOSING TABLE itself
// (i.e. at the table's own parent level, typically the document) -- not merely a
// sibling of the row/cell that's still nested one level inside the table. Verified by
// construction: `change.moveNodeByKey(childKey, table.key, index)` targets `table` as
// the new parent, which only relocates the child to be a sibling of the row within the
// table's own child list, still failing the table's `nodes` schema entry immediately
// (a `table` child is not a `table_row`) and, when that fixer wraps it into a fresh
// row, racing back into this same fixer -- an infinite normalize loop confirmed via a
// minimal reproduction against the installed Slate runtime. Moving one level further
// out, to the table's own parent, is what "sibling of the enclosing table" actually
// requires.
function hoistToSiblingOfTable(change: Editor, table: Block, childKey: string) {
  const parent = change.value.document.getParent(table.key) as Document | Block;
  const index = parent.nodes.indexOf(table);
  change.moveNodeByKey(childKey, parent.key, index + 1);
}

// @types/slate declares `Editor.unwrapBlockByKey`/`wrapBlockByKey` without the extra
// `{ normalize: false }` options argument that `@bengotow/slate-edit-list`'s real
// schema normalize callbacks pass (see `slate-edit-list/lib/validation/schema.js`,
// read directly -- the exact reference this mirrors), and which the installed Slate
// runtime accepts (and, per a direct trace of `unwrapBlockAtRange`/`wrapBlockAtRange`,
// silently no-ops on in this Slate version, since every step is already wrapped in its
// own `editor.withoutNormalizing`). A real gap in the installed type package, not
// papered over with `any`.
type SchemaChange = Editor & {
  unwrapBlockByKey(key: string, options?: { normalize?: boolean }): Editor;
  wrapBlockByKey(key: string, type: string, options?: { normalize?: boolean }): Editor;
};

// Schema -- the real safety net. Mirrors `EditListPlugin`'s shape exactly (see
// `base-block-plugins.tsx`'s `EditListPlugin`, backed by `@bengotow/slate-edit-list`'s
// own `schema`/`normalizeNode`): a plugin-level `schema` field, merged automatically by
// Slate/slate-react with the top-level `schema` prop (`conversion.tsx`'s `schema`
// object needs no changes for this). This is what keeps a pasted, cut, drag-dropped, or
// otherwise-malformed table fragment structurally valid regardless of what triggered
// the mutation -- not just the keystrokes `onKeyDown` below happens to intercept.
export const TABLE_SCHEMA: SchemaProperties = {
  blocks: {
    [TABLE_CELL_TYPE]: {
      parent: [{ type: TABLE_ROW_TYPE }],
      // A cell is a leaf: it must directly contain only text/inlines, never a nested
      // table/table_row. Without this, the confirmed bug below (table_row's own
      // child_type_invalid fixer wrapping an alien pasted TABLE_TYPE into a cell) would
      // produce a table nested inside a cell -- this entry is defense in depth at the
      // cell level, catching the case even if content lands directly under a cell by
      // some other path than the table_row-level insertion the bug was traced through.
      nodes: [{ match: [{ object: 'text' }, { object: 'inline' }] }],
      normalize: (change: Editor, error) => {
        if (error.code === 'parent_type_invalid') {
          // REAL BUG found via red-green TDD (a required test constructing a real
          // Slate `Editor` around a `table_cell` directly under `table`, skipping
          // `table_row`): when this cell's immediate parent already IS the enclosing
          // TABLE_TYPE block, unconditionally unwrapping here (as `slate-edit-list`'s
          // `list_item` fixer does) finds no OTHER ancestor to target and dissolves
          // the enclosing table itself -- confirmed via a minimal reproduction against
          // the installed Slate runtime, including a follow-on content-loss variant
          // where leaving this violation for the table-level fixer to resolve next
          // (a bare no-op return here) let the cell get torn down to its bare text
          // child before the table-level fixer ever ran, losing the cell's own text.
          // The correct, self-contained fix: wrap THIS cell directly into a fresh row
          // in place, exactly what the table-level fixer would otherwise do for the
          // same violation, converging without depending on cross-rule ordering.
          const parent = change.value.document.getParent(error.node.key);
          if (parent && parent.object === 'block' && parent.type === TABLE_TYPE) {
            const editable = change as unknown as SchemaChange;
            editable.wrapBlockByKey(error.node.key, TABLE_ROW_TYPE, { normalize: false });
            return;
          }
          const editable = change as unknown as SchemaChange;
          editable.unwrapBlockByKey(error.node.key, { normalize: false });
        } else if (error.code === 'child_type_invalid' || error.code === 'child_object_invalid') {
          // Hoist the alien block child out to be a sibling of the enclosing table
          // (never wrap it into the cell -- that's exactly the corruption being
          // prevented). Mirrors the table_row fixer below.
          const row = parentBlock(change.value.document, error.node.key);
          const table = parentBlock(change.value.document, row.key);
          hoistToSiblingOfTable(change, table, error.child.key);
        }
      },
    },
    [TABLE_ROW_TYPE]: {
      parent: [{ type: TABLE_TYPE }],
      nodes: [{ match: { type: TABLE_CELL_TYPE } }],
      normalize: (change: Editor, error) => {
        if (error.code === 'parent_type_invalid') {
          const editable = change as unknown as SchemaChange;
          editable.unwrapBlockByKey(error.node.key, { normalize: false });
        } else if (error.code === 'child_type_invalid') {
          // CONFIRMED BUG found by the second plan-review pass: pasting a table while
          // the cursor is inside an existing cell hits insertBlockAtRange, which
          // inserts the pasted table as a direct sibling of cells inside this row's
          // own children -- tripping this exact rule. The naive fixer (wrap the alien
          // child into a cell) would nest the pasted table INSIDE a table_cell,
          // breaking the cell "leaf" model. A TABLE_TYPE alien child must be hoisted
          // out to be a sibling of the enclosing table instead; anything else (stray
          // text/other blocks) still gets wrapped into a cell as originally designed.
          if (error.child.type === TABLE_TYPE) {
            const table = parentBlock(change.value.document, error.node.key);
            hoistToSiblingOfTable(change, table, error.child.key);
          } else {
            const editable = change as unknown as SchemaChange;
            editable.wrapBlockByKey(error.child.key, TABLE_CELL_TYPE, { normalize: false });
          }
        }
      },
    },
    [TABLE_TYPE]: {
      nodes: [{ match: { type: TABLE_ROW_TYPE } }],
      normalize: (change: Editor, error) => {
        if (error.code === 'child_type_invalid') {
          const editable = change as unknown as SchemaChange;
          editable.wrapBlockByKey(error.child.key, TABLE_ROW_TYPE, { normalize: false });
        }
      },
    },
  },
};

// Tab / Shift+Tab -- use Slate's own document-order traversal, bounded to the same
// table. `getNextBlock`/`getPreviousBlock` auto-descend through container blocks
// (table/table_row) to the innermost block in the single-step case, but have no "stay
// within this table" concept on their own -- a naive while-loop would tunnel through
// unrelated document content into a SECOND, unrelated table if one exists elsewhere in
// the document. Every traversal step is bounded to the same table by comparing
// ancestor table keys.
export function tableKeyForCell(document: Document, cell: Block): string | null {
  const table = document.getClosest(
    cell.key,
    (n: Node) => n.object === 'block' && n.type === TABLE_TYPE
  );
  return table ? table.key : null;
}

export function nextCell(document: Document, cell: Block): Block | null {
  const myTable = tableKeyForCell(document, cell);
  let next = document.getNextBlock(cell);
  while (next && next.type !== TABLE_CELL_TYPE) {
    next = document.getNextBlock(next);
  }
  return next && tableKeyForCell(document, next) === myTable ? next : null;
}

export function previousCell(document: Document, cell: Block): Block | null {
  const myTable = tableKeyForCell(document, cell);
  let previous = document.getPreviousBlock(cell);
  while (previous && previous.type !== TABLE_CELL_TYPE) {
    previous = document.getPreviousBlock(previous);
  }
  return previous && tableKeyForCell(document, previous) === myTable ? previous : null;
}

// Pure decision: what should Tab / Shift+Tab do from `cell`? Kept separate from
// `onKeyDown` so it's directly unit-testable without a real editor.
export type TabDecision =
  | { action: 'moveToCell'; cell: Block }
  | { action: 'insertRow' }
  | { action: 'none' };

export function decideTabForward(document: Document, cell: Block): TabDecision {
  const next = nextCell(document, cell);
  return next ? { action: 'moveToCell', cell: next } : { action: 'insertRow' };
}

export function decideTabBackward(document: Document, cell: Block): TabDecision {
  const previous = previousCell(document, cell);
  return previous ? { action: 'moveToCell', cell: previous } : { action: 'none' };
}

// Pure decision: what should Backspace (at the start of the table's first cell) /
// Delete (at the end of the table's last cell) do? Shared by both keys since the
// decision logic is symmetric; the direction-specific cursor capture (previous vs.
// next block) lives in `onKeyDown`, which is where the second plan-review pass traced
// a real asymmetry between Slate's own `deleteBackwardAtRange` (no ambient cursor
// repair) and `deleteForwardAtRange` (repositions explicitly).
export type BoundaryDecision =
  | { action: 'moveToAdjacentCell'; cell: Block }
  | { action: 'removeTable' }
  | { action: 'preventOnly' };

export function decideBoundaryRemoval(table: Block, adjacentCell: Block | null): BoundaryDecision {
  if (adjacentCell) {
    return { action: 'moveToAdjacentCell', cell: adjacentCell };
  }
  const tableEmpty = table.getTexts().every((t) => t.text === '');
  return tableEmpty ? { action: 'removeTable' } : { action: 'preventOnly' };
}

function insertRowAfter(editor: Editor, document: Document, cell: Block) {
  const row = parentBlock(document, cell.key);
  const table = parentBlock(document, row.key);
  const rowIndex = table.nodes.indexOf(row);
  const newRow = Block.fromJSON(buildRowJSON(row.nodes.size));
  const firstCell = newRow.nodes.get(0) as Block;
  editor.insertNodeByKey(table.key, rowIndex + 1, newRow);
  editor.moveToStartOfNode(firstCell).focus();
}

function onKeyDown(event: React.KeyboardEvent, editor: Editor, next: () => void) {
  const { value } = editor;
  const { focusBlock, document } = value;
  if (!focusBlock || focusBlock.type !== TABLE_CELL_TYPE) {
    return next();
  }
  const cell = focusBlock;

  if (event.key === 'Tab') {
    if (event.shiftKey) {
      const decision = decideTabBackward(document, cell);
      if (decision.action === 'moveToCell') {
        event.preventDefault();
        editor.moveToStartOfNode(decision.cell).focus();
      }
      // action === 'none': already in this table's first cell -- let the default
      // Tab-out-of-editor behavior proceed, matching the issue's scope (only forward
      // auto-row-add was requested).
      return;
    }
    const decision = decideTabForward(document, cell);
    event.preventDefault();
    if (decision.action === 'moveToCell') {
      editor.moveToStartOfNode(decision.cell).focus();
    } else {
      insertRowAfter(editor, document, cell);
    }
    return;
  }

  if (!value.selection.isCollapsed) {
    return next();
  }

  if (event.key === 'Backspace') {
    const firstText = cell.getFirstText();
    const { focus } = value.selection;
    if (!firstText || focus.key !== firstText.key || focus.offset !== 0) {
      return next();
    }
    const row = parentBlock(document, cell.key);
    const table = parentBlock(document, row.key);
    const decision = decideBoundaryRemoval(table, previousCell(document, cell));
    event.preventDefault();
    if (decision.action === 'moveToAdjacentCell') {
      editor.moveToEndOfNode(decision.cell).focus();
    } else if (decision.action === 'removeTable') {
      // The second plan-review pass traced a real asymmetry in Slate's own core:
      // `deleteForwardAtRange` explicitly repositions the cursor after its own
      // empty-block removal; `deleteBackwardAtRange` does not, relying on ambient
      // selection repair this hand-rolled removal cannot assume it gets for free.
      // Capture the adjacent block BEFORE removing the table and move explicitly.
      const previousBlock = document.getPreviousBlock(table);
      editor.removeNodeByKey(table.key);
      if (previousBlock) {
        editor.moveToEndOfNode(previousBlock).focus();
      }
    }
    // action === 'preventOnly': boundary cell, but the table has other content --
    // swallow the keystroke without modifying anything.
    return;
  }

  if (event.key === 'Delete') {
    const lastText = cell.getLastText();
    const { focus } = value.selection;
    if (!lastText || focus.key !== lastText.key || focus.offset !== lastText.text.length) {
      return next();
    }
    const row = parentBlock(document, cell.key);
    const table = parentBlock(document, row.key);
    const decision = decideBoundaryRemoval(table, nextCell(document, cell));
    event.preventDefault();
    if (decision.action === 'moveToAdjacentCell') {
      editor.moveToStartOfNode(decision.cell).focus();
    } else if (decision.action === 'removeTable') {
      const nextBlock = document.getNextBlock(table);
      editor.removeNodeByKey(table.key);
      if (nextBlock) {
        editor.moveToStartOfNode(nextBlock).focus();
      }
    }
    return;
  }

  return next();
}

// Insert-table toolbar button. Each cell's `nodes` array must explicitly contain one
// real (even empty-string) text node -- not an empty `nodes: []` array. Slate's own
// core min-1-child rule would insert a bare text node and cascade correctly even from
// a genuinely empty `nodes: []`, but relying on that fallback cascade instead of
// seeding real content up front is needlessly fragile and inconsistent with how every
// other multi-block insert in this codebase already seeds real content (see
// `conversion.tsx`'s `TEXT_RULE_IMPROVED` deserialize rule for this exact JSON shape).
function buildRowJSON(cellCount: number): BlockJSON {
  return {
    object: 'block',
    type: TABLE_ROW_TYPE,
    nodes: Array.from({ length: cellCount }, () => ({
      object: 'block',
      type: TABLE_CELL_TYPE,
      nodes: [{ object: 'text', leaves: [{ object: 'leaf', text: '' }] }],
    })),
  };
}

function buildTableJSON(rowCount: number, cellCount: number): BlockJSON {
  return {
    object: 'block',
    type: TABLE_TYPE,
    nodes: Array.from({ length: rowCount }, () => buildRowJSON(cellCount)),
  };
}

export function insertTable(editor: Editor, rows = 2, cols = 2) {
  const table = Block.fromJSON(buildTableJSON(rows, cols));
  const firstRow = table.nodes.get(0) as Block;
  const firstCell = firstRow.nodes.get(0) as Block;

  editor.insertBlock(table);

  // `insertBlock`'s own post-insert selection repair (`moveToEndOfNode`) lands the
  // cursor inside the table's own last cell for a non-void, non-empty block like ours
  // (unlike a void block such as `hr`, which Slate's `insertBlockAtRange` special-cases
  // via `editor.isVoid(startBlock)`) -- chaining a second `insertBlock(div)` from there
  // would land the trailing div as a spurious sibling CELL inside the table's own last
  // row (and get wrapped by our own TABLE_ROW_TYPE schema fixer), not as a sibling of
  // the whole table. Insert the trailing div explicitly as the table's own next
  // sibling instead, exactly mirroring `hr-plugins.tsx`'s void-block-adjacent
  // cursor-safety pattern but computed directly rather than via chained `insertBlock`.
  const parent = editor.value.document.getParent(table.key) as Document | Block | null;
  if (parent) {
    const index = parent.nodes.indexOf(table);
    editor.insertNodeByKey(parent.key, index + 1, Block.create(BLOCK_CONFIG.div.type));
  }

  editor.moveToStartOfNode(firstCell).focus();
}

const InsertTableButton = BuildToggleButton({
  type: 'table',
  button: {
    isActive: () => false,
    onToggle: (editor: Editor) => insertTable(editor),
    iconClass: 'fa fa-table',
  },
});

// HTML round-trip. A real <table> needs a <tbody> too for maximum email-client
// compatibility -- wrap the <tr>s in one on serialize. Tolerate a <tbody> wrapper (and
// <th> header cells) transparently on deserialize by not special-casing them: the
// deserialize rule matches on tr/td/th tag names regardless of whether a tbody wrapper
// is present, since `next(el.childNodes)` already recurses through unknown wrapper
// elements when no rule claims them.
function renderNode(props, editor: Editor = null, next = () => {}) {
  const { node, children, attributes } = props;
  switch (node.type) {
    case TABLE_TYPE:
      return (
        <table {...attributes}>
          <tbody>{children}</tbody>
        </table>
      );
    case TABLE_ROW_TYPE:
      return <tr {...attributes}>{children}</tr>;
    case TABLE_CELL_TYPE:
      return <td {...attributes}>{children}</td>;
    default:
      return next();
  }
}

export const rules: Rule[] = [
  {
    deserialize(el: HTMLElement, next) {
      const tagName = el.tagName ? el.tagName.toLowerCase() : '';
      if (tagName === 'table') {
        return { object: 'block', type: TABLE_TYPE, nodes: next(el.childNodes) };
      }
      if (tagName === 'tr') {
        return { object: 'block', type: TABLE_ROW_TYPE, nodes: next(el.childNodes) };
      }
      if (tagName === 'td' || tagName === 'th') {
        return { object: 'block', type: TABLE_CELL_TYPE, nodes: next(el.childNodes) };
      }
    },
    serialize(obj, children) {
      if (obj.object !== 'block') return;
      return renderNode({ node: obj, children, targetIsHTML: true });
    },
  },
];

// `ComposerEditorPlugin` (in `./types`) extends slate-react's `Plugin<Editor>`, which
// (per `@types/slate-react`) inherits a `schema?: SchemaProperties` field from Slate
// core's own `Plugin` interface -- but in this project's actual tsconfig, that
// generic inheritance fails to resolve (verified directly: `tsc` rejects `schema` as
// an unknown property even though `EditListPlugin` in base-block-plugins.tsx relies on
// the identical runtime field, dodging this only because its own package ships no
// types at all). A real gap in the installed `@types/slate-react` package, not papered
// over with `any` -- widen only the one broken field via a local type augmentation.
type ComposerEditorPluginWithSchema = ComposerEditorPlugin & { schema?: SchemaProperties };

const TablePlugin: ComposerEditorPluginWithSchema = {
  schema: TABLE_SCHEMA,
  toolbarSectionClass: 'table-section',
  toolbarComponents: [InsertTableButton],
  renderNode,
  rules,
  onKeyDown,
};

const plugins: ComposerEditorPlugin[] = [
  TablePlugin,

  // Enter inside a table cell inserts a soft line-break, never splits the cell into a
  // new block -- the exact same pattern already used for code blocks in
  // base-block-plugins.tsx.
  When({
    when: (value: Value) => value.blocks.some((b) => b.type === TABLE_CELL_TYPE),
    plugin: SoftBreak(),
  }),
];

export default plugins;
