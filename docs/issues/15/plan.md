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
   the actual rendered `<img>` element's natural dimensions (read via the same
   `ReactDOM.findDOMNode`/`querySelector('.file-preview img')` pattern the resize handlers
   already use — read `naturalWidth`/`naturalHeight`, falling back to current `.width`/
   `.height` if a natural size isn't available yet, e.g. still loading):
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

### Why this is materially riskier than every other composer feature added this session

Every existing block type in `BLOCK_CONFIG` is either a **void** block (`hr`, one level,
no children to manage — see `hr-plugins.tsx`) or a **leaf** block holding text/inlines
directly (`div`, `heading_one`, `blockquote`). The only existing **multi-level nested**
structure is lists (`ol_list`/`ul_list` > `list_item`), and that nesting's structural
integrity is entirely delegated to the vetted `@bengotow/slate-edit-list` npm package
already in `package.json` — this codebase has never hand-rolled multi-level block nesting
itself. A table (`table` > `table_row` > `table_cell`) is exactly that: a new 3-level
nested structure with no equivalent vetted library available, so structural integrity
(Tab/Backspace/Enter behavior at cell/row/table boundaries, preventing Slate's default
normalization from producing a malformed tree) has to be hand-built.

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
- Backspace at the very start of a cell does not merge across cell/row/table boundaries
  (structural safety) — if the ENTIRE table is empty and backspace is pressed in its first
  cell, remove the whole table (this is the "delete table" capability from the issue's
  acceptance criteria, achieved as a side effect of the safety handler already needed, not
  a separate UI affordance).
- HTML round-trip: `<table>`/`<tr>`/`<td>` in and out.
- Explicitly **deferred** (already listed as non-goals in the issue): add/remove
  row/column UI beyond the Tab-adds-row case above, cell merging, column resize handles,
  table styling presets.

### Node model

- `table` (block, NOT void — holds `table_row` children only)
- `table_row` (block, NOT void — holds `table_cell` children only)
- `table_cell` (block, NOT void, **leaf** — holds text/marks/inlines directly, exactly
  like `BLOCK_CONFIG.div` today, so bold/italic/links/images work inside cells with zero
  extra code)
- No formal Slate `schema` structural constraints (`nodes: [{match, min, max}]`) — matches
  this codebase's existing convention for `blockquote`/list nesting, which also has no
  formal schema entries and relies on careful command/keydown design instead of Slate's
  built-in schema-normalization safety net. Introducing the first-ever formal structural
  schema in this codebase for tables specifically would be a novel, higher-risk pattern
  with no local precedent to model correctness against — safety instead comes from: (a)
  `SoftBreak` intercepting Enter inside a cell so Slate's default block-split logic never
  runs there at all (see below), and (b) the explicit Backspace-boundary guard.

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
line-break within that cell's text, never splits/creates a new block — Slate's default
block-splitting/merging logic (the actual source of most cross-boundary corruption risk)
is never invoked for Enter inside a table at all. This is the single biggest risk-reduction
decision in this plan.

### Tab / Shift+Tab — use Slate's own document-order traversal, not manual row/col math

Verified available on this Slate version (`@types/slate`): `Document.getNextBlock(key:
string | Node): Block | null` and `getPreviousBlock(key: string | Node): Block | null` —
document-order traversal across the whole tree, not sibling-only. Implementation:
```ts
function nextCell(document: Document, cell: Block): Block | null {
  let next = document.getNextBlock(cell);
  while (next && next.type !== TABLE_CELL_TYPE) next = document.getNextBlock(next);
  return next && next.type === TABLE_CELL_TYPE ? next : null;
}
// mirror for previousCell() using getPreviousBlock
```
`onKeyDown` (registered on the new `table-plugins.tsx` plugin, keyed off the focused
block's type being `TABLE_CELL_TYPE`):
- **Tab**: `nextCell()`. If found, `editor.moveToStartOfNode(next).focus()`,
  `event.preventDefault()`. If `null` (we've fallen off the end of the table entirely),
  insert a new `table_row` with the same cell count as the last row, as a sibling after the
  current row (`editor.insertNodeByKey` on the table's key, at the row's index + 1 — Slate
  path-based insertion, standard API, no traversal risk since we're inserting a fully-
  formed subtree, not mutating cell text), then move into its first cell.
- **Shift+Tab**: `previousCell()`. If found, move into it, `preventDefault()`. If `null`
  (already in the very first cell), let the default Tab-out-of-editor behavor proceed
  (don't preventDefault) — matches the issue's scope (only forward auto-row-add was
  requested).

### Backspace boundary safety

`onKeyDown`, Backspace, when `value.selection.isCollapsed` and offset is 0 of the focused
cell's first text node:
- If the cell is not the table's very first cell (via `previousCell()` returning non-null):
  `event.preventDefault()`, no-op (or optionally move focus to the end of the previous
  cell without deleting — nicer UX, not required for safety). Either way, prevent Slate's
  default merge-with-previous-block behavior from ever running across a cell boundary.
- If it IS the table's first cell AND the entire table's text content is empty (walk all
  `table_cell` descendants via `table.getTexts()` — bounded, small tree — checking each is
  empty): remove the whole table via `editor.removeNodeByKey(table.key)`, matching the
  `hr` insertion's own trailing-`div` cursor-safety pattern (ensure there's still an
  adjacent editable block after removal — if the table was the only content, the base
  document-empty-recovery logic already in `composer-editor.tsx` (`getDocumentBrokenReason`)
  handles that case, don't duplicate it here).
- If it IS the table's first cell but the table has other content: `event.preventDefault()`
  (still don't let Backspace escape the table structure), no-op.

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
  logic (feed a fake `document.getNextBlock`/`getPreviousBlock` sequence), the Tab-at-
  last-cell new-row-insertion decision, the Backspace boundary decision (which of the 3
  branches: no-op-prevent, remove-whole-table, no-op-prevent-because-not-first-cell), and
  the HTML round-trip rules' `deserialize`/`serialize` functions called directly against
  fake DOM-like elements (same technique already used for `hr-plugins.tsx`/
  `base-block-plugins.tsx`'s existing rule tests).
- Given the real risk profile here, ALSO add a focused Playwright e2e test in
  `compose.spec.ts` (using the popout-compose path established this session, not
  `openThread`, which this sandbox can't run) that: clicks Insert Table, types into the
  first cell, presses Tab, types into the second cell, presses Tab again (crossing into row
  2), types, and asserts the resulting DOM has a `<table>` with the expected cell text in
  the expected cells — this is the single feature this session where e2e coverage of the
  actual keyboard-interaction behavior is worth the cost, given the Backspace/Tab
  boundary logic can't be fully trusted from pure-logic tests alone (they test the
  decision functions in isolation, not that Slate's actual `onKeyDown` wiring calls them
  correctly end-to-end).

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
