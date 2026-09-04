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

### Playwright e2e — root-caused and fixed by the orchestrator, now PASSING

The implementor's report above ("known_failure" section) was honest and accurate about the
symptom, but the root cause was findable with live debugging, which the implementor wasn't
able to complete within budget. Investigated directly:

1. Wrote a throwaway diagnostic Playwright script (not committed) reproducing the exact
   failing scenario with `page.on('console')`/`page.on('pageerror')` listeners attached to
   the composer window (Playwright's `page.evaluate` doesn't work in this app —
   `window.eval` is blocked for security — so DOM state was inspected via
   `locator.innerHTML()` instead, and console/page-error listeners caught what
   `evaluate`-based introspection couldn't).
2. Confirmed the table HTML is **byte-identical** before and after pressing Tab — the
   `onKeyDown` handler's Tab branch was doing nothing visible at all, not producing a wrong
   result.
3. The console/pageerror listeners caught the real cause: an uncaught exception, thrown
   synchronously inside the Tab handler, aborting the entire pending Slate change before it
   ever flushed to React/the DOM:
   ```
   Error: Paths can only be created from arrays or lists, but you passed: Block { ... "type": "table_cell" }
       at Document.resolvePath (.../interfaces/node.js:209:5)
       at nextCell (table-plugins.tsx:91:25)
       at decideTabForward (table-plugins.tsx:106:18)
       at onKeyDown (table-plugins.tsx:145:26)
   ```
4. Root cause: `nextCell`/`previousCell` called `document.getNextBlock(cell)`/
   `document.getPreviousBlock(previous)`, passing the `Block` object directly.
   `@types/slate` declares these methods as accepting `string | Node`, but the **installed
   Slate runtime does not accept a bare Node** — verified by grepping every internal call
   site of `getNextBlock`/`getPreviousBlock` inside `slate.js` itself: every single one
   passes `.key` (a string), never a Node/Block object; the parameter is literally named
   `path` in the implementation. This is the same category of `@types/slate` inaccuracy
   already hit twice earlier in this session (`BlockProperties.type`, Jasmine's
   `andThrow`) — a real, now well-precedented gap in the installed type package, not a
   logic bug in the plan or a Slate quirk to work around with a different API.
5. **Fix**: changed all 6 call sites in `table-plugins.tsx`
   (`nextCell`/`previousCell`'s loop bodies, and the Backspace/Delete empty-table-removal
   branches' adjacent-block capture) to pass `.key` instead of the Block object.
   `editor.moveToStartOfNode`/`moveToEndOfNode` were confirmed correct as-is (their actual
   implementation parameter is literally named `node`, accepting the Node directly — this
   is the opposite convention from `getNextBlock`/`getPreviousBlock`, which is presumably
   exactly why the mistake was easy to make in the first place).
6. Re-ran the existing Jasmine unit tests (they were written robustly enough to accept
   either a key string or a Node-shaped fake via a `keyOf()` normalizer already present in
   the spec's test doubles — no test changes needed) — still 31/31 passing.
7. Re-ran the e2e test twice in a row to confirm it isn't flaky:
   ```
   xvfb-run -a npx playwright test --config playwright/playwright.config.ts tests/compose.spec.ts -g "insert-table toolbar button"
   ✓ 1 playwright/tests/compose.spec.ts:993:5 › insert-table toolbar button inserts a table and Tab navigates between cells (8.8s)
   1 passed (36.9s)
   ```
   (second run: `(7.2s)`, `1 passed (31.2s)` — both green, no flake.)

### Acceptance criteria verification

- `TABLE_SCHEMA` implements the plan's parent/child repair shape for all three block
  types, with the two corrections above (both required for the plan's own mandated
  tests to pass truthfully, not left as literal-but-broken code).
- Cross-table-bounded Tab/Shift+Tab traversal: proven via `nextCell`/`previousCell`
  cross-table tests, AND now genuinely functional in the real running app (root-caused
  `.key`-vs-Node bug fixed, see above).
- Backspace/Delete explicit cursor repositioning in both empty-table-removal branches:
  implemented in `onKeyDown`, captured via `document.getPreviousBlock`/`getNextBlock`
  before `removeNodeByKey` — using the corrected `.key`-based calls.
- Toolbar button seeds real text nodes (not empty `nodes: []`): verified by the
  `insertTable` spec.
- HTML round-trip including `<th>`/`<tbody>` tolerance: verified.
- Insert-table + Tab-across-rows Playwright e2e: **passing**, confirmed stable across two
  consecutive runs.

### Final orchestrator-level full verification

- `tsc -p app/tsconfig.json --noEmit` — clean, re-run after the fix.
- `eslint` on every touched file (`table-plugins.tsx`, `conversion.tsx`,
  `uneditable-plugins.tsx`, `composer-table-plugins-spec.ts`,
  `attachment-items.tsx`, `attachment-image-size-spec.ts`) — clean.
- Full project-wide Jasmine suite: **1787 passing, 0 failing** (up from the 1746-test
  baseline confirmed clean immediately before this issue's work began — +41 new tests: 31
  table specs + 10 image-size-preset specs — zero regressions).

## Independent Code Review Gate (on the full diff, cold, no implementer summary)

Verdict: APPROVE WITH CHANGES. Two findings, both addressed:

1. **Severe, priority 1, confirmed via real fixtures**: the implementor's
   `uneditable-plugins.tsx` fix (removing `'table'` from `UNEDITABLE_TAGS` unconditionally
   to let the toolbar-inserted table reach `TablePlugins`' deserialize rule) had a much
   larger blast radius than intended — it would reparse EVERY `<table>` in EVERY incoming
   HTML source (quoted replies, forwards, paste, signatures) into the new editable model,
   not just tables the user explicitly inserts. Real-world layout tables (marketing/
   newsletter/invoice HTML routinely nests tables-in-`<td>`s-in-tables for cross-client
   layout — confirmed directly against this repo's own `app/spec/fixtures/emails/
   email_16.html`, 42 `<table>` occurrences with divs/nested tables inside cells) would
   trip `TABLE_SCHEMA`'s alien-child hoisting, scrambling content order and silently
   dropping every table/cell HTML attribute (width, bgcolor, colspan, rowspan, style).
   **Fixed**: added `isSimpleTableElement()` — a table is only treated as editable if
   every cell's direct children are inline-level tags and no `<table>` is nested anywhere
   inside it. `uneditable-plugins.tsx` only falls through to `TablePlugins` for simple
   tables; the same guard is duplicated in `TablePlugins`' own deserialize rule as defense
   in depth. Regression-tested against the real `email_16.html` fixture (confirms it still
   becomes a single uneditable block) plus targeted `isSimpleTableElement` unit cases —
   4 new tests, all passing.
2. **Lower priority, non-blocking, adopted anyway**: the existing `fakeDocument` test
   double's `getNextBlock`/`getPreviousBlock`/`getClosest` mocks were more permissive than
   the real Slate API they guard (accepted either a string key or a Node-shaped object;
   the real runtime only accepts a string, as the root-cause investigation above already
   proved). This meant the unit tests alone would not have caught the `.key`-vs-Node
   regression — only the e2e test would have. **Fixed**: tightened the fakes to require a
   string, matching the real API exactly, and updated the 3 test call sites that used the
   fake's convenience API with a Node object to pass `.key` directly.

Both fixes verified: full table-plugins spec 35/35 passing (up from 31), full project-wide
Jasmine suite **1791 passing, 0 failing**, `tsc`/`eslint` clean, and the e2e
insert-table-and-Tab-navigate test re-confirmed still passing after both fixes.

## Final Confirmatory Review Pass (verifying the two fixes above are actually correct)

Verdict: found 2 more real, previously-uncaught gaps in `isSimpleTableElement` itself —
both silently *corrupting* content on round-trip rather than correctly rejecting it (the
exact failure mode the function exists to prevent):

1. **Confirmed via this PR's own fixture**: `isSimpleTableElement` never checked
   `colspan`/`rowspan`. The editable `table_cell` deserialize rule and its render/serialize
   path capture no HTML attributes at all, so a colspan/rowspan cell would silently,
   permanently lose its span once round-tripped. Directly demonstrated: this issue's own
   `excel-paste-in.html` fixture has a real `colspan="2"` cell — before this fix, that exact
   fixture would have been (wrongly) classified as "simple" and lost its column span on
   save. Merged cells are an explicit non-goal for this minimal model — fixed by rejecting
   colspan/rowspan > 1, falling through to the pre-existing frozen-HTML treatment instead.
2. **Confirmed via the HTML5 content model**: `isSimpleTableElement` only checked a cell's
   *direct* children against the inline allow-list. `<a>` is HTML5-transparent and may
   legally wrap block-level content — a routine "clickable card" pattern in marketing/
   product emails (`<td><a href="..."><h3>Title</h3><p>Body</p></a></td>`) — which a
   direct-children-only check missed entirely (the cell's only direct child, `<a>`, is
   allowed; its `<h3>`/`<p>` grandchildren were never inspected). Fixed by checking every
   descendant element (`querySelectorAll('*')`), not just direct children.

**Rewrote** the "excel table paste fixture" test to assert the corrected classification —
the fixture's colspan cell now correctly keeps it in the pre-existing uneditable treatment.
The schema's own paste-into-cell hoisting mechanism (this test's original subject) is
independently covered above it via a synthetic, colspan-free table
(`tableJSON`/`rowJSON` helpers), so no test coverage was lost in the rewrite — only the
real-fixture test's own assertion changed to match the corrected, safer behavior.

Added targeted unit cases for colspan, rowspan, and the transparent-`<a>`-wrapper scenario.

Re-verified after both fixes: table-plugins spec **40/40 passing** (up from 35), full
project-wide Jasmine suite **1796 passing, 0 failing**, `tsc`/`eslint` clean (one non-null-
assertion lint warning fixed along the way), and the e2e insert-table-and-Tab-navigate test
re-confirmed passing when run in isolation (a transient failure when run concurrently with
the full Jasmine suite was reproduced as pure resource contention — both spin up separate
Electron instances simultaneously in this sandbox — and resolved by re-running alone; not a
regression from this fix).
