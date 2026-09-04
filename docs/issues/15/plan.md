# Issue #15 — Insert table, and right-click image size presets

## Part A: Image size presets (small, low-risk — implement first)

### Verified current mechanism

- `ImageAttachmentItem` (`app/src/components/attachment-items.tsx:272-495`) already has a
  full drag-resize implementation: `_resizeStart`/`_resizeImage`/`_resizeEnd` compute new
  pixel width/height from mouse movement and, on release, call `this.props.onResized(width,
  height)` (line 490).
- `inline-attachment-plugins.tsx`'s `ImageNode` (lines 22-64) wires `onResized` straight
  into the Slate node: `newN.data.set('imgProps', { width, height })`, persisted and
  round-tripped to `<img width="..." height="...">` on send (the `rules` block, lines
  73-97, and the `targetIsHTML` branch, lines 27-31).
- `renderImage()` (`attachment-items.tsx:290-315`) applies `imgProps.width`/`.height` as
  inline `px` CSS **only when truthy** (`if (imgProps.height) {...}`) — so calling
  `onResized(undefined, undefined)` already correctly clears back to the image's natural
  browser-default size with zero new code needed for the "Original" case.
- The existing image right-click handler (`attachment-items.tsx:347`) only calls the shared
  `buildContextMenu({ onOpenAttachment, onSaveAttachment })` helper
  (`attachment-items.tsx:19-51`) — Open/Save only, no size options, and that function calls
  `Menu.buildFromTemplate(template).popup({})` directly (void return — can't be extended
  after the fact, must be extended at its own call site).

### Fix

1. Extend `buildContextMenu`'s param shape with an optional
   `sizePresets?: { label: string; active: boolean; onClick: () => void }[]` — when
   provided, push a `{ label: localized('Size'), submenu: [...] }` entry built from it.
   Optional/no-op for every other existing caller (plain `AttachmentItem`'s two call sites
   at lines 213-224 and the image's Open/Save-only path) — zero behavior change for them.
2. In `ImageAttachmentItem.render()`'s `onContextMenu` (line 347), build the 4 presets from
   the actual rendered `<img>` element's natural dimensions. Prefer
   `event.currentTarget.querySelector('img')` (simpler, scoped to the element the context
   menu fired on) over the drag-resize handlers' `ReactDOM.findDOMNode`/global
   `document.querySelector('.image-attachment-item[data-resizing] ...')` pattern — that
   pattern exists because drag-resize needs to find the currently-dragging element from
   global mouse-move listeners with no direct element reference; a context-menu handler
   already has one. Read `naturalWidth`/`naturalHeight`, falling back to current `.width`/
   `.height` if a natural size isn't available yet (e.g. still loading):
   - **Original**: `onResized(undefined, undefined)` — clears `imgProps`, matches the
     already-correct fallback-to-natural-size behavior above.
   - **Large**: target width `min(naturalWidth, 600)`, height scaled to preserve aspect
     ratio (`width * naturalHeight / naturalWidth`).
   - **Medium**: target width `min(naturalWidth, 320)`, same aspect-ratio scaling.
   - **Small**: target width `min(naturalWidth, 160)`, same aspect-ratio scaling.
   - `active` (for a checked/radio visual state, if Electron's native menu supports it via
     `type: 'radio'` — a nice-to-have, not required) compares the current `imgProps.width`
     against each preset's computed target.
3. No new files, no Slate schema/node changes, no new persistence path — this reuses
   `onResized` exactly as drag-resize already does.

### Testing

- `attachment-items.tsx` has no existing spec file (confirmed via search) — this is UI/DOM
  logic (reading a live `<img>` element's natural size, building an Electron `Menu`), not
  practically unit-testable in isolation without a full React+DOM mount. Extract the pure
  **size computation** (`naturalWidth/Height` in → target `{width, height}` out, for each of
  the 4 presets) into a standalone exported function so at least that part is unit-tested
  (mirrors this session's established pattern of pulling pure logic out of DOM-coupled code
  for testability — e.g. `extensionForClipboardMimeType` out of `handleFilePasted` in a
  prior issue this session).
- No e2e test: no existing Playwright convention for triggering/reading a native Electron
  context menu's contents (confirmed no precedent searching `playwright/`), and this
  sandbox's fixture-DB limitation (documented in prior issues this session) blocks
  thread-based composer e2e tests anyway. Manual verification steps recorded in
  `test-cases.md`.

## Part B: Table insertion and editing (large, real risk — the plan-review gate should
scrutinize this hardest)

### Why this is riskier than every other composer feature added this session — and the correction from the plan-review gate

Every existing block type in `BLOCK_CONFIG` is either a **void** block (`hr`, one level,
no children to manage — see `hr-plugins.tsx`) or a **leaf** block holding text/inlines
directly (`div`, `heading_one`, `blockquote`). The only existing **multi-level nested**
structure is lists (`ol_list`/`ul_list` > `list_item`), and — **corrected from this plan's
first draft** — that nesting's structural integrity is NOT "no formal schema, careful
command design instead." `@bengotow/slate-edit-list/lib/core.js` (the actual npm package,
read directly) exports both `schema: schema(opts)` and `normalizeNode: normalizeNode(opts)`
from `validation/schema.js`/`validation/normalizeNode.js`, registered as fields on the
`EditListPlugin` object already included directly in `base-block-plugins.tsx`'s plugin
array. Slate merges each plugin's own `schema` field with the top-level `schema` prop
(`composer-editor.tsx:342`) — this is how list nesting actually stays structurally valid:
a real, declarative Slate schema with `parent`/`nodes` match rules and `normalize` repair
callbacks, which Slate's own core engine runs automatically after every document mutation
(keystrokes, paste, cut, drag-drop, undo/redo — not just the interactions a keydown handler
happens to intercept). The list schema (`validation/schema.js`, read directly) is
~40 lines: a `blocks` map keyed by type, each entry declaring `parent`/`nodes` match
constraints and a `normalize(change, error)` callback keyed by Slate's own violation codes
(`parent_type_invalid`, `child_type_invalid`, `child_object_invalid`) that calls
`change.unwrapBlockByKey`/`wrapBlockByKey`/`moveNodeByKey` to repair the tree. This is
directly reusable as a pattern for tables — not prohibitively large, and it's the actual
local precedent, not the absence of one.

**Revised design: build a real schema for tables too**, mirroring the list package's shape
exactly. This single decision resolves several corruption paths the plan-review gate found
in the first draft that keydown guards alone cannot cover, because keydown handlers only
see keystrokes — they cannot see paste (`composer-editor.tsx`'s `onPaste` calls
`editor.insertFragment(value.document)` unconditionally for pasted HTML — and
`sanitize-transformer.ts` already whitelists `table`/`tbody`/`tr`/`th`/`td`, with an
existing code comment about "pasting tables from Excel", confirming this is a routine,
expected user action, not an edge case), cut, expanded-selection deletion, or
slate-react's built-in block drag-and-drop — all of these run through Slate's normal
operation pipeline, which always runs schema normalization afterward regardless of what
triggered the mutation. A keydown-only design has no visibility into any of them; a schema
does, uniformly, for free.

### Scope decision (explicit — reviewers should confirm or push back)

Minimum viable, matching the issue's own "Suggested fix"/"Non-goals" split:
- Insert a table (fixed 2×2 default — **no** row/column size-picker UI; that's scope creep
  beyond "insert a table" for a first pass).
- Type content into cells (marks/inlines like bold/links/images work inside cells, for
  free, by modeling `table_cell` as a leaf block exactly like `div` — see "Node model"
  below).
- Tab / Shift+Tab moves between cells in document order; Tab from the last cell of the
  last row inserts a new row and moves into its first cell (this one WAS explicitly in the
  issue's own suggested fix text, not deferred to non-goals — implementing it).
- Backspace/Delete at cell/row/table boundaries are UX-convenience guards on top of the
  schema safety net (see below) — not the only line of defense against corruption anymore.
- HTML round-trip: `<table>`/`<tr>`/`<td>` (and `<th>`) in and out.
- Explicitly **deferred** (already listed as non-goals in the issue): add/remove
  row/column UI beyond the Tab-adds-row case above, cell merging, column resize handles,
  table styling presets.

### Node model

- `table` (block, NOT void — holds `table_row` children only)
- `table_row` (block, NOT void — holds `table_cell` children only)
- `table_cell` (block, NOT void, **leaf** — holds text/marks/inlines directly, exactly
  like `BLOCK_CONFIG.div` today, so bold/italic/links/images work inside cells with zero
  extra code)

### Schema — the real safety net (new, corrects the first draft)

New `TABLE_SCHEMA` in `table-plugins.tsx`, registered as that plugin object's own `schema`
field (mirroring `EditListPlugin`'s shape exactly — plugin-level `schema`, merged
automatically by Slate/slate-react with the top-level `schema` prop, no change needed to
`conversion.tsx`'s central `schema` object):
```ts
const TABLE_SCHEMA = {
  blocks: {
    [TABLE_CELL_TYPE]: {
      parent: [{ type: TABLE_ROW_TYPE }],
      normalize: (change, error) => {
        if (error.code === 'parent_type_invalid') {
          change.unwrapBlockByKey(error.node.key, { normalize: false });
        }
      },
    },
    [TABLE_ROW_TYPE]: {
      parent: [{ type: TABLE_TYPE }],
      nodes: [{ match: { type: TABLE_CELL_TYPE } }],
      normalize: (change, error) => {
        if (error.code === 'parent_type_invalid') {
          change.unwrapBlockByKey(error.node.key, { normalize: false });
        } else if (error.code === 'child_type_invalid') {
          change.wrapBlockByKey(error.child.key, TABLE_CELL_TYPE, { normalize: false });
        }
      },
    },
    [TABLE_TYPE]: {
      nodes: [{ match: { type: TABLE_ROW_TYPE } }],
      normalize: (change, error) => {
        if (error.code === 'child_type_invalid') {
          change.wrapBlockByKey(error.child.key, TABLE_ROW_TYPE, { normalize: false });
        }
      },
    },
  },
};
```
**Verified, not a guess**: `@types/slate`'s `SlateError` class declares `code: ErrorCode`
(a union including exactly `'parent_type_invalid'`/`'child_type_invalid'`/
`'child_object_invalid'`, matching the codes `slate-edit-list`'s own schema uses) plus a
`[key: string]: any` index signature — and `slate-edit-list/lib/validation/schema.js`'s
actual normalize callbacks, read directly, confirm the exact runtime field names used off
that object: `context.node.key` for `parent_type_invalid`, `context.child.key` for
`child_type_invalid` (the callback's second parameter is literally the `SlateError`/
`error` object, named `context` at that call site — same object, local naming choice).
The `TABLE_SCHEMA` pseudocode above uses these exact confirmed field names.

This single addition means: a pasted, cut, drag-dropped, or otherwise-malformed table
fragment gets auto-repaired by Slate's own engine using the exact same mechanism that
already keeps list nesting valid — no bespoke handling needed for paste/cut/drag-drop
specifically. The keydown handlers below become a thinner, UX-focused layer on top of this
net, not the last line of defense.

### Enter key — reuse existing precedent exactly

`base-block-plugins.tsx` already has this EXACT pattern for code blocks (lines ~595-599):
```ts
When({
  when: (value) => value.blocks.some((b) => b.type === BLOCK_CONFIG.code.type),
  plugin: SoftBreak(),
}),
```
Add an identical `When`/`SoftBreak` entry scoped to `TABLE_CELL_TYPE` in the new
`table-plugins.tsx`'s plugin array. This means Enter inside any cell inserts a soft
line-break within that cell's text, never splits/creates a new block.

### Tab / Shift+Tab — use Slate's own document-order traversal, bounded to the same table

Verified available on this Slate version (`@types/slate`): `Document.getNextBlock(key:
string | Node): Block | null` and `getPreviousBlock(key: string | Node): Block | null` —
confirmed via the plan-review gate's direct trace of `slate.js`'s
`getNextDeepMatchingNodeAndPath`/`findFirstDescendantAndPath` that these auto-descend
through container blocks (`table`/`table_row`) to the innermost block in the single-step
case, so a naive next/previous-cell walk mostly works — **but** the gate also found a real
bug in the first draft: `getNextBlock`/`getPreviousBlock` have no "stay within this table"
concept, so the while-loop tunnels through unrelated document content into a SECOND,
unrelated table if one exists elsewhere in the document (Tab from the last cell of table #1
would silently jump into table #2 instead of adding a new row). **Fix: bound every
traversal step to the same table** by comparing ancestor table keys:
```ts
function tableKeyForCell(document: Document, cell: Block): string | null {
  const table = document.getClosest(cell.key, (n) => n.object === 'block' && n.type === TABLE_TYPE);
  return table ? table.key : null;
}
function nextCell(document: Document, cell: Block): Block | null {
  const myTable = tableKeyForCell(document, cell);
  let next = document.getNextBlock(cell);
  while (next && next.type !== TABLE_CELL_TYPE) next = document.getNextBlock(next);
  return next && tableKeyForCell(document, next) === myTable ? next : null;
}
// mirror for previousCell() using getPreviousBlock
```
Returning `null` now correctly and unambiguously means "no more cells in THIS table" (not
"tunneled into another table"), which is also exactly the signal needed for the
Tab-adds-new-row decision below.

`onKeyDown` (registered on the new `table-plugins.tsx` plugin, keyed off the focused
block's type being `TABLE_CELL_TYPE`):
- **Tab**: `nextCell()`. If found, `editor.moveToStartOfNode(next).focus()`,
  `event.preventDefault()`. If `null` (end of this table), insert a new `table_row` with
  the same cell count as the last row, as a sibling after the current row
  (`editor.insertNodeByKey(tableKey, rowIndex + 1, newRowNode)` — standard Slate API,
  confirmed correct/idiomatic by the plan-review gate via direct trace against Slate's own
  internal usage in `splitBlockAtRange`/`unwrapBlockAtRange`/`insertFragmentAtRange`), then
  move into its first cell.
- **Shift+Tab**: `previousCell()`. If found, move into it, `preventDefault()`. If `null`
  (already in the very first cell of this table), let the default Tab-out-of-editor
  behavior proceed (don't preventDefault) — matches the issue's scope (only forward
  auto-row-add was requested).

### Backspace / Delete boundary guards (UX convenience layer, not the safety net anymore)

`onKeyDown`, when the focused block is `TABLE_CELL_TYPE` and `value.selection.isCollapsed`:
- **Backspace** at offset 0 of the cell's first text node:
  - If `previousCell()` (bounded to the same table) is non-null: `event.preventDefault()`,
    no-op (or move focus to the end of the previous cell — nicer, not required).
  - If null (this is the table's first cell) AND the entire table's text is empty (walk
    all `table_cell` descendants via `table.getTexts()` — bounded, small tree): **call
    `event.preventDefault()`** (the first draft's pseudocode omitted this — the
    plan-review gate correctly flagged it as a real bug: without it, Slate's own
    default-empty-block-removal shortcut in `deleteBackwardAtRange` could run concurrently
    and interact unpredictably with our own `removeNodeByKey`), then
    `editor.removeNodeByKey(table.key)`. If the table was the only document content, the
    existing `getDocumentBrokenReason`/recovery logic in `composer-editor.tsx` already
    handles the resulting empty-document case — don't duplicate it here.
  - If null but the table has other (non-empty) content: `event.preventDefault()`, no-op.
- **Delete** (forward-delete) at the end offset of the cell's last text node — **added in
  this revision; the first draft only handled Backspace**, and the plan-review gate traced
  a matching unconditional empty-block-removal shortcut in Slate's own
  `deleteForwardAtRange` that Delete would hit unguarded otherwise:
  - If `nextCell()` (bounded to the same table) is non-null: `event.preventDefault()`,
    no-op (or move focus to the start of the next cell).
  - If null (this is the table's last cell) and the whole table is empty: same
    remove-whole-table handling as Backspace above, with `preventDefault()`.
  - If null but the table has other content: `event.preventDefault()`, no-op.

With the schema in place as the general safety net, these four guards exist purely to make
Backspace/Delete at a cell boundary feel intentional (not silently swallowed, not
corrupting anything) — they are not required to catch every possible corruption path
themselves anymore.

### Insert-table toolbar button

New `table-plugins.tsx` plugin, `toolbarComponents: [InsertTableButton]` (plain
`BuildToggleButton({ isActive: () => false, ... })`, matching the `hr`/`indent`/`clear-
formatting` one-shot-action pattern already used repeatedly this session — no new factory
needed). `onToggle` builds a 2×2 table (one `table` block containing 2 `table_row` blocks,
each containing 2 empty `table_cell` blocks) via `editor.insertBlock(...)` with a nested
JSON node structure (Slate's `insertBlock` accepts a full `BlockJSON` tree, not just a flat
type string — same technique already usable for compound inserts), followed by a trailing
empty `div` (void-block-adjacent cursor-safety pattern, exactly matching `hr-plugins.tsx`'s
`insertHorizontalRule`), then moves focus into the first cell.

### HTML round-trip

New `rules` in `table-plugins.tsx`:
- `table`/`table_row`/`table_cell` `render()` → `<table>`/`<tr>`/`<td>` (a real `<table>`
  needs a `<tbody>` too for maximum email-client compatibility — wrap the `<tr>`s in one on
  serialize; tolerate `<tbody>` transparently on deserialize by not special-casing it, i.e.
  the deserialize rule matches on `tr`/`td` tag names regardless of whether a `tbody`
  wrapper is present, since `next(el.childNodes)` already recurses through unknown
  wrapper elements).
- Deserialize should also tolerate `<th>` (map to the same `table_cell` type) so tables
  pasted in from other sources with header rows don't silently lose content.

### Registration

`table-plugins.tsx` inserted into `conversion.tsx#plugins` near `BaseBlockPlugins`/
`HrPlugins` (position matters for HTML-deserialization rule precedence per the existing
top-of-file comment in `conversion.tsx`, but `table`/`tr`/`td` tag names don't collide with
any existing rule, so any position near the other block plugins is safe).

### Testing

- Pure-logic unit tests (mirroring this session's established convention — fake/minimal
  Slate-shaped objects, no full editor mount) for: `nextCell`/`previousCell` traversal
  logic bounded to the same table (feed a fake `document.getNextBlock`/`getPreviousBlock`/
  `getClosest` sequence, including a case with a second, unrelated table to prove the
  cross-table bug is actually fixed), the Tab-at-last-cell new-row-insertion decision, the
  Backspace AND Delete boundary decisions (each of the 3 branches: no-op-prevent,
  remove-whole-table-with-preventDefault, no-op-prevent-because-not-boundary-cell), and the
  HTML round-trip rules' `deserialize`/`serialize` functions called directly against fake
  DOM-like elements (same technique already used for `hr-plugins.tsx`/
  `base-block-plugins.tsx`'s existing rule tests) — including a `<th>`-tolerant case and a
  `<tbody>`-wrapped case.
- **New requirement from the revised (schema-based) design**: a test that actually
  constructs a real Slate `Value`/`Editor` with a deliberately malformed table fragment
  (e.g. a `table_cell` as a direct child of `table`, skipping `table_row`) and asserts that
  running Slate's own normalization (`editor.change()`/`value.change().normalize()` or
  equivalent — check the exact API this Slate fork exposes for triggering normalization in
  a test context, e.g. how `EditListPlugin`'s own test suite does it if bundled, or how
  this repo's existing specs trigger normalization elsewhere) repairs it back into a valid
  `table > table_row > table_cell` tree per `TABLE_SCHEMA`'s `normalize` callbacks. Without
  this, the schema's `normalize` callback bodies are unverified — the pure-logic tests
  above test the OTHER decision functions, not that the schema itself is wired up and
  behaves as designed.
- Given the real risk profile here, ALSO add a focused Playwright e2e test in
  `compose.spec.ts` (using the popout-compose path established this session, not
  `openThread`, which this sandbox can't run) that: clicks Insert Table, types into the
  first cell, presses Tab, types into the second cell, presses Tab again (crossing into row
  2), types, and asserts the resulting DOM has a `<table>` with the expected cell text in
  the expected cells — this is the feature this session where e2e coverage of the actual
  keyboard-interaction behavior is worth the cost, given the Backspace/Tab boundary logic
  can't be fully trusted from pure-logic tests alone (they test the decision functions in
  isolation, not that Slate's actual `onKeyDown` wiring calls them correctly end-to-end).

## Acceptance criteria mapping (from the issue)

| Issue AC | How satisfied |
|---|---|
| Insert a table, type content, round-trips through send/receive | Part B, "Node model" + "HTML round-trip" |
| Right-click image → Original/Large/Medium/Small, resizes immediately, persists like drag-resize | Part A |
| No regression to existing drag-resize / Open/Save menu | Part A — `onResized` reused unchanged; `buildContextMenu` extension is additive-only |

## Non-goals (unchanged from the issue)

- Advanced table editing: merge cells, column/row resize handles, table styling presets,
  row/column add-remove UI beyond the Tab-adds-row case.
- Changing the `imgProps`/HTML `width`/`height` persistence mechanism.

## Plan Review Gate — verdict: REJECT (first draft) → revised → see below

First-draft verdict was **REJECT for Part B as originally designed** (Part A approved
standalone, unconditionally). Findings, all verified independently against the actual
installed `@bengotow/slate-edit-list` package and Slate core source before adopting:

1. **Factually wrong core premise, corrected**: the claim that list nesting "has no formal
   schema" was false — `@bengotow/slate-edit-list/lib/core.js` exports both `schema` and
   `normalizeNode`, verified by reading the package directly. The real local precedent for
   multi-level nesting IS a formal Slate schema, not its absence. Adopted: Part B now
   builds an equivalent schema for tables (see "Schema — the real safety net" above).
2. **Delete key entirely unhandled** in the first draft (only Backspace was covered) —
   Slate's own `deleteForwardAtRange` has an unconditional empty-block-removal shortcut
   that would run unguarded. Adopted: symmetric Delete-key guard added.
3. **Paste, cut, expanded-selection deletion, and drag-and-drop entirely unaddressed** by
   a keydown-only design — `composer-editor.tsx`'s `onPaste` unconditionally calls
   `editor.insertFragment`, and `sanitize-transformer.ts` already whitelists table tags
   (confirmed via an existing "pasting tables from Excel" code comment — a routine,
   expected action, not an edge case). Resolved generally, not case-by-case: the schema
   normalization from finding #1 runs after every Slate operation regardless of what
   triggered it, covering all four paths uniformly.
4. **Real bug found in the Tab/Shift+Tab traversal**: `getNextBlock`/`getPreviousBlock`
   have no "stay within this table" concept, so naive traversal would tunnel into a second,
   unrelated table elsewhere in the document. Adopted: every traversal step now bounds
   itself to the same table via an ancestor-key comparison (`tableKeyForCell`).
5. **Real bug found in the empty-table-removal branch**: the first draft's pseudocode
   never called `event.preventDefault()` before `removeNodeByKey`, risking a race with
   Slate's own default empty-block-removal shortcut. Adopted: `preventDefault()` now
   explicit in every boundary-guard branch.
6. **Confirmed correct, no change**: `getNextBlock`/`getPreviousBlock` do auto-descend
   through container blocks in the single-step case (verified via direct trace of
   `getNextDeepMatchingNodeAndPath`/`findFirstDescendantAndPath`); `insertNodeByKey` is
   correct/idiomatic Slate API usage for row insertion (verified against Slate's own
   internal usage in `splitBlockAtRange`/`unwrapBlockAtRange`/`insertFragmentAtRange`).
7. **Part A**: approved as originally designed, one non-blocking style nitpick adopted
   (`event.currentTarget.querySelector` instead of the drag-resize handlers'
   `ReactDOM.findDOMNode` pattern, which exists for a different reason — global mouse-move
   listener lookup — that doesn't apply to a context-menu handler with a direct element
   reference).
8. **Recommendation to split Part A from Part B**: adopted operationally — Part A is
   implemented and can ship independently without waiting on Part B's redesign; Part B
   proceeds to implementation only with the corrections above incorporated, and gets its
   own independent code-review-gate scrutiny (in addition to this plan-review pass) before
   merge, given its risk profile.
