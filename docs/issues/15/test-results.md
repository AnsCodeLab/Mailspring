## Part A

### Red (before implementation)

Command:
```
xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test -f "attachment-image-size"
```

Result: all 10 specs failed with `TypeError: (0 , attachment_items_1.computeImagePresetSize)
is not a function` (the export didn't exist yet), confirming the tests fail for the right
reason before any implementation:

```
  1) computeImagePresetSize a large landscape image (1200x600, 2:1 ratio) returns undefined for "original" (clears imgProps, falls back to natural size).
     TypeError: (0 , attachment_items_1.computeImagePresetSize) is not a function
  ...
  10) computeImagePresetSize a portrait image (900x1800, 1:2 ratio) confirms height-side aspect-ratio math scales "small" to 160 wide / 320 tall.
     TypeError: (0 , attachment_items_1.computeImagePresetSize) is not a function
```

### Green (after implementation)

Command:
```
xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test -f "attachment-image-size"
```

Result: all 10 specs pass.

```
  computeImagePresetSize
    a large landscape image (1200x600, 2:1 ratio)
      ✓ returns undefined for "original" (clears imgProps, falls back to natural size)
      ✓ scales "large" down to 600 wide, preserving aspect ratio
      ✓ scales "medium" down to 320 wide, preserving aspect ratio
      ✓ scales "small" down to 160 wide, preserving aspect ratio
    an image already smaller than every preset (100x50)
      ✓ never upscales "large" beyond the natural size
      ✓ never upscales "medium" beyond the natural size
      ✓ never upscales "small" beyond the natural size
    a portrait image (900x1800, 1:2 ratio) confirms height-side aspect-ratio math
      ✓ scales "large" to 600 wide / 1200 tall
      ✓ scales "medium" to 320 wide / 640 tall
      ✓ scales "small" to 160 wide / 320 tall

  10 passing
```

### Lint

Command:
```
npx eslint -c .eslintrc app/src/components/attachment-items.tsx app/spec/attachment-image-size-spec.ts
```

Result: no output — clean, zero warnings/errors.

### Manual/visual verification

Not performed in this pass: no Playwright precedent in this repo for triggering/reading a
native Electron context menu's contents (confirmed by the plan's own search), and this is
UI/DOM logic (reading a live `<img>` element's natural size, building an `Electron.Menu`)
that isn't practically unit-testable without a full React+DOM mount — matching the plan's
explicit testing decision to extract and exhaustively unit-test only the pure
`computeImagePresetSize` size-computation logic, and record the "Size" submenu's manual
behavior (TC-A6 in `test-cases.md`) as a manual/visual check.

### Acceptance criteria verification

- `buildContextMenu`'s extension is additive-only: read both other call sites
  (`AttachmentItem`'s `onContextMenu` at what is now line ~250, and the pre-existing image
  `onContextMenu` this change replaces) — `AttachmentItem`'s call site never passes
  `sizePresets`, so `if (fns.sizePresets)` never fires for it; behavior unchanged.
- The 4 presets are wired to the real `onResized` callback: `_onImageContextMenu` calls
  `onResized(target?.width, target?.height)` for Large/Medium/Small (using
  `computeImagePresetSize`'s result) and `onResized(undefined, undefined)` for Original
  (via `target` being `undefined`) — the exact same prop/call path
  `_resizeEnd` (drag-resize) already uses, with no new persistence code.
- `computeImagePresetSize` is unit-tested (10 passing specs above) and exported as a
  standalone, DOM-free function per the plan's testability requirement.
- `npx eslint -c .eslintrc app/src/components/attachment-items.tsx
  app/spec/attachment-image-size-spec.ts` is clean.

## Part B

### Red (before implementation)

Writing the schema-normalization tests first against a stub/empty `table-plugins.tsx`
failed with import errors (module had no such exports), confirming the tests exercise
real, not-yet-existing code before implementation began.

### Green (Jasmine, after implementation)

Command:
```
xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test -f "composer-table-plugins-spec"
```

Result: all 31 specs pass.

```
  tableKeyForCell (2), nextCell (4), previousCell (3), decideTabForward (2),
  decideTabBackward (2), decideBoundaryRemoval (3), table HTML round-trip rules (10),
  TABLE_SCHEMA normalization (3), excel table paste fixture (1), insertTable (1)

  31 passing
```

During development, red-green TDD surfaced two real bugs in the schema code as
originally transcribed from the plan (both fixed, both covered by the passing tests
above; verified with standalone Node reproductions against the installed Slate runtime
before touching production code):

1. **`moveNodeByKey(childKey, table.key, index)` hoisted an alien child to be a sibling
   of the ROW inside the table's own child list, not a sibling of the TABLE itself.**
   This re-triggered the table's own `child_type_invalid` rule, which wrapped it into a
   fresh row, whose `child_type_invalid` rule hoisted it right back — an infinite
   normalize loop, confirmed via a minimal Node reproduction. Fixed with a
   `hoistToSiblingOfTable` helper that targets the table's own *parent* (e.g. the
   document), one level further out than the plan's literal code.
2. **`TABLE_CELL_TYPE`'s `parent_type_invalid` fired before `TABLE_TYPE`'s own
   `child_type_invalid` for the "cell directly under table" malformed case**, and an
   unconditional `unwrapBlockByKey` there dissolved the enclosing table (or, in an
   intermediate fix attempt, lost the cell's own text content) instead of leaving the
   repair to the table-level fixer. Fixed: when the cell's immediate parent already IS
   the enclosing `TABLE_TYPE`, wrap the cell into a fresh row directly (self-contained,
   not dependent on cross-rule firing order).

Also discovered and fixed while writing the required real-fixture paste test: `<table>`
was listed in `uneditable-plugins.tsx`'s `UNEDITABLE_TAGS`, so **every** incoming
`<table>` (paste, drag-drop, or a received email) was being swallowed whole into an
opaque, non-editable HTML blob by an earlier-registered plugin, before `table-plugins.tsx`'s
own deserialize rules ever ran. Removed `'table'` from `UNEDITABLE_TAGS`
(`app/src/components/composer-editor/uneditable-plugins.tsx`) — without this, the "round
trip through send/receive" acceptance criterion for pasted/received tables cannot be
met at all; verified no test or other call site depends on tables being uneditable.

### TypeScript / lint

Commands:
```
./node_modules/.bin/tsc -p app/tsconfig.json --noEmit
npx eslint -c .eslintrc app/src/components/composer-editor/table-plugins.tsx app/src/components/composer-editor/conversion.tsx app/src/components/composer-editor/uneditable-plugins.tsx app/spec/composer-table-plugins-spec.ts
```
Result: both clean, zero errors/warnings.

### Playwright e2e — FAILING, flagged for triage

Command:
```
xvfb-run -a npx playwright test --config playwright/playwright.config.ts tests/compose.spec.ts -g "insert-table toolbar button"
```

The table itself inserts correctly and the first cell's typed text lands correctly
(`cells.nth(0)` contains "R1C1"). The test then fails on the second cell after pressing
Tab:

```
Error: expect(locator).toContainText(expected) failed
Locator: ...locator('table td').nth(1)
Expected substring: "R1C2"
Received string:    "﻿"
```

The second cell stays empty (renders Slate's empty-leaf placeholder character) after
Tab + typing, in the real browser/DOM environment, even though the exact same
`nextCell`/`decideTabForward` decision logic driving `onKeyDown`'s Tab branch is
independently unit-tested and passing (see `decideTabForward` specs above), and adding
a 200ms wait after each Tab press to rule out a React-commit race did not change the
result. This means the pure decision logic is verified correct, but something in how
`onKeyDown`'s `editor.moveToStartOfNode(next).focus()` interacts with slate-react's real
DOM selection restoration in this environment is not landing focus/typed input in the
next cell as the unit tests predict. **This is an honest, unresolved failure** — not
silently dropped or claimed as a pass. It needs further live-browser investigation
(most likely stepping through slate-react's `focus()`/selection-restoration path with
the debugger against the real render tree) that I was not able to complete. All other
required test categories (pure-logic traversal/decisions, HTML round-trip, real-`Editor`
schema normalization including both confirmed-bug regression tests, and the real Excel
fixture) pass.

### Acceptance criteria verification

- `TABLE_SCHEMA` implements the plan's parent/child repair shape for all three block
  types, with the two corrections above (both required for the plan's own mandated
  tests to pass truthfully, not left as literal-but-broken code).
- Cross-table-bounded Tab/Shift+Tab traversal: proven via `nextCell`/`previousCell`
  cross-table tests.
- Backspace/Delete explicit cursor repositioning in both empty-table-removal branches:
  implemented in `onKeyDown`, captured via `document.getPreviousBlock`/`getNextBlock`
  before `removeNodeByKey`.
- Toolbar button seeds real text nodes (not empty `nodes: []`): verified by the
  `insertTable` spec.
- HTML round-trip including `<th>`/`<tbody>` tolerance: verified.
- Insert-table + Tab-across-rows Playwright e2e: **not passing**, see above.
