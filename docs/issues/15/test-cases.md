## Part A

### TC-A1: Right-click image → "Original" resets to natural size

- **Preconditions**: A composer draft with an inline image attachment that has previously
  been resized (drag-resize or a different preset), so `imgProps.width`/`.height` are set.
- **Steps**: Right-click the image. Open the "Size" submenu. Click "Original".
- **Expected result**: `computeImagePresetSize('original', naturalWidth, naturalHeight)`
  returns `undefined`, so `onResized(undefined, undefined)` is called — the exact same call
  `inline-attachment-plugins.tsx`'s `ImageNode` already wires into
  `newN.data.set('imgProps', { width: undefined, height: undefined })`. `renderImage()`'s
  existing `if (imgProps.height)` / `if (imgProps.width)` truthy guards mean no inline
  `px` CSS is applied, so the `<img>` renders at its natural browser-default size — zero
  new rendering code needed for this case.
- **Automated coverage**: `computeImagePresetSize` "returns undefined for 'original'
  (clears imgProps, falls back to natural size)".

### TC-A2: Right-click image → "Large" resizes to max 600px wide, preserving aspect ratio

- **Preconditions**: An inline image wider than 600px natural width.
- **Steps**: Right-click the image. Open the "Size" submenu. Click "Large".
- **Expected result**: `computeImagePresetSize('large', naturalWidth, naturalHeight)`
  returns `{ width: min(naturalWidth, 600), height: width * naturalHeight / naturalWidth }`.
  `onResized(width, height)` is called with that exact result — the same call the
  drag-resize handler (`_resizeEnd`) already makes, so persistence (`imgProps` on the Slate
  node, HTML `width`/`height` attrs on send) reuses the existing, unchanged path.
- **Automated coverage**: `computeImagePresetSize` "scales 'large' down to 600 wide,
  preserving aspect ratio" (landscape) and "scales 'large' to 600 wide / 1200 tall"
  (portrait, confirms height-side aspect-ratio math).

### TC-A3: Right-click image → "Medium" resizes to max 320px wide, preserving aspect ratio

- **Preconditions**: An inline image wider than 320px natural width.
- **Steps**: Right-click the image. Open the "Size" submenu. Click "Medium".
- **Expected result**: `computeImagePresetSize('medium', naturalWidth, naturalHeight)`
  returns `{ width: min(naturalWidth, 320), height: width * naturalHeight / naturalWidth }`,
  wired to `onResized` exactly as TC-A2.
- **Automated coverage**: `computeImagePresetSize` "scales 'medium' down to 320 wide,
  preserving aspect ratio" and "scales 'medium' to 320 wide / 640 tall".

### TC-A4: Right-click image → "Small" resizes to max 160px wide, preserving aspect ratio

- **Preconditions**: An inline image wider than 160px natural width.
- **Steps**: Right-click the image. Open the "Size" submenu. Click "Small".
- **Expected result**: `computeImagePresetSize('small', naturalWidth, naturalHeight)`
  returns `{ width: min(naturalWidth, 160), height: width * naturalHeight / naturalWidth }`,
  wired to `onResized` exactly as TC-A2.
- **Automated coverage**: `computeImagePresetSize` "scales 'small' down to 160 wide,
  preserving aspect ratio" and "scales 'small' to 160 wide / 320 tall".

### TC-A5: Presets never upscale an image already smaller than the preset target

- **Preconditions**: An inline image whose natural width (e.g. 100px) is smaller than
  every preset's max width (160/320/600).
- **Steps**: Right-click the image. Click "Large", then "Medium", then "Small" in turn.
- **Expected result**: Every preset resolves to `{ width: naturalWidth, height:
  naturalHeight }` (the `Math.min(naturalWidth, presetMax)` clamp never exceeds the
  natural width) — the image is never stretched larger than its real size.
- **Automated coverage**: `computeImagePresetSize` "never upscales 'large'/'medium'/
  'small' beyond the natural size" (all three preset cases against a 100x50 image).

### TC-A6: "Size" submenu shows a radio-checked state for the currently active preset

- **Preconditions**: An inline image currently resized to the "Medium" preset's width
  (`imgProps.width === computeImagePresetSize('medium', naturalWidth, naturalHeight).width`).
- **Steps**: Right-click the image. Open the "Size" submenu.
- **Expected result**: The "Medium" entry shows Electron's native radio-checked state
  (`type: 'radio'`, `checked: true`); the other three entries are unchecked. This is a
  manual/visual check only — Electron's native context menu isn't inspectable from the
  Jasmine or Playwright suites in this sandbox (no existing precedent), so it isn't
  automated; the `active` boolean fed into each preset's menu-item config is exercised
  indirectly by `computeImagePresetSize`'s exact-`{width,height}` assertions, which is
  what the `active` comparison is keyed off of.

### TC-A7: No regression to the existing Open/Save context-menu items on plain (non-image)
attachments

- **Preconditions**: A non-image file attachment (`AttachmentItem`, not
  `ImageAttachmentItem`).
- **Steps**: Right-click the attachment.
- **Expected result**: The context menu still shows exactly Open / Remove / Preview / Save
  Into..., with no "Size" submenu — `buildContextMenu`'s new `sizePresets` param is
  optional, and `AttachmentItem`'s call site never passes it, so `if (fns.sizePresets)`
  never pushes the new menu entry for this caller. Zero behavior change.
- **Automated coverage**: None needed beyond code review (per the plan, this is UI/DOM
  logic with no existing spec convention for asserting native `Menu` contents) — verified
  by reading `AttachmentItem`'s `onContextMenu` call site directly: it does not pass
  `sizePresets`, so the new code path is unreachable for it.

### TC-A8: No regression to the existing drag-resize handle

- **Preconditions**: An inline image.
- **Steps**: Drag the resize handle in the bottom-right corner of the image.
- **Expected result**: `_resizeStart`/`_resizeImage`/`_resizeEnd` behave exactly as before
  — unmodified by this change. `_resizeEnd` still calls `this.props.onResized(img.width,
  img.height)` directly from the live DOM element's rendered size, entirely independent of
  the new `computeImagePresetSize`/context-menu code path.
- **Automated coverage**: None needed — no lines in `_resizeStart`/`_resizeImage`/
  `_resizeEnd` were touched by this change; verified by code review/diff.

## Part B

### TC-B1: Bounded Tab/Shift+Tab traversal, including the cross-table bug fix

- **Preconditions**: A document containing two separate tables.
- **Steps**: Place the cursor in the last cell of the first table; press Tab.
- **Expected result**: A new row is inserted in the FIRST table (never jumps into the
  second table). `nextCell`/`previousCell` bound every traversal step to the same table
  via `tableKeyForCell`; `decideTabForward` reports `insertRow` (not `moveToCell` into an
  unrelated table) once `nextCell` returns `null`.
- **Automated coverage**: `nextCell`/`previousCell` "returns null instead of tunneling
  into a second, unrelated table" (both directions); `decideTabForward` "requests a new
  row when at the last cell of the last row".

### TC-B2: Insert table (2x2), type, Tab across rows (e2e)

- **Preconditions**: A popout composer window.
- **Steps**: Click the Insert Table toolbar button. Type into the first cell. Press Tab.
  Type into the second cell. Press Tab again (crosses into row 2). Type into the third
  cell.
- **Expected result**: A `<table>` appears with the three typed strings landing in cells
  1, 2, and 3 in document order.
- **Automated coverage**: Playwright `compose.spec.ts` "insert-table toolbar button
  inserts a table and Tab navigates between cells" — **currently failing**; see
  `test-results.md`.

### TC-B3: Backspace/Delete at table boundaries

- **Preconditions**: A table with either all-empty cells or some non-empty content.
- **Steps**: Place the cursor at the very start of the first cell and press Backspace (or
  the very end of the last cell and press Delete).
- **Expected result**: If an adjacent cell exists, focus moves there (or a same-table
  boundary is a no-op) instead of corrupting the tree. If the table is the boundary cell
  and entirely empty, the whole table is removed and the cursor explicitly lands in the
  adjacent block (previous for Backspace, next for Delete) — never left stranded. If the
  table has other content, the keystroke is swallowed with no structural change.
- **Automated coverage**: `decideBoundaryRemoval` covers all three branches.

### TC-B4: Malformed table fragment (paste/drag-drop/undo) self-repairs via schema

- **Preconditions**: A `table` node whose direct child is a `table_cell` (skipping
  `table_row`) is loaded into a real, schema-backed `Editor`.
- **Expected result**: Normalization repairs the tree into `table > table_row >
  table_cell` with the cell's original text content preserved, with no user action
  required — the schema runs on every Slate operation (paste, cut, drag-drop, undo),
  not just keydown-intercepted ones.
- **Automated coverage**: `TABLE_SCHEMA normalization` "repairs a table_cell that is a
  direct child of table (skipping table_row)".

### TC-B5: Valid table content is never churned by the schema

- **Expected result**: A well-formed `table > table_row > table_cell` tree produces
  **zero** normalize operations on load — no spurious undo-history pollution.
- **Automated coverage**: `TABLE_SCHEMA normalization` "does not modify an already-valid
  table > table_row > table_cell tree".

### TC-B6: Pasting a table while the cursor is inside another table's cell does not nest
tables

- **Preconditions**: An existing table; cursor inside one of its cells.
- **Steps**: Paste (insert a fragment containing) a second, multi-row table.
- **Expected result**: The pasted table ends up as a sibling of the first table (two
  separate top-level tables), never nested inside a `table_cell`.
- **Automated coverage**: `TABLE_SCHEMA normalization` "hoists a pasted table out to a
  sibling instead of nesting it inside an existing cell"; `excel table paste fixture`
  "parses a real Excel-clipboard table and, pasted into an existing cell, does not nest a
  table inside it" (using the real `app/spec/fixtures/paste/excel-paste-in.html`
  fixture).

### TC-B7: HTML round-trip, including `<th>` and `<tbody>` tolerance

- **Expected result**: `<table>`/`<tr>`/`<td>` deserialize to `table`/`table_row`/
  `table_cell`; `<th>` also deserializes to `table_cell` (no header-row data loss); a
  `<tbody>` wrapper is transparently skipped. Serialize emits `<table><tbody>...`.
- **Automated coverage**: `table HTML round-trip rules` (10 specs).
