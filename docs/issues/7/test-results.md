# Issue #7 — Test Results

Evidence below is copied verbatim from actual command runs against this
branch (`issue-7-toolbar-formatting-controls`). Full Jasmine/Playwright
suites and repo-wide `npm run lint`/`typecheck` are intentionally **not**
run here — only the new/modified spec files and the new e2e tests, per the
assignment scope (project-wide validation is run once by the orchestrator).

## Environment note

This sandbox has no macOS Playwright fixture DB
(`playwright/helpers.ts`'s `FIXTURE_DIR` is a hardcoded macOS path), so
`openThread()`-based e2e tests (anything that opens a real thread and
replies) cannot run here — confirmed this is a **pre-existing** limitation,
not a regression: the unmodified, pre-existing `Cmd+B toggles bold in
composer` test in `compose.spec.ts` fails identically
(`locator('.thread-list .list-item').first()` timeout) on this box. All new
e2e tests below therefore use the popout-compose path (`c` shortcut), which
works without thread/mailsync fixture data — the same path already used by
the pre-existing `c opens new message composer` test.

Similarly, `Meta+<key>` accelerators (Cmd on macOS) do not trigger the
app's `mod+`-bound commands in this Linux/Xvfb sandbox — confirmed by
running the pre-existing, byte-for-byte unmodified `Cmd+B toggles bold in
composer` test in isolation (fails the same way). New e2e tests apply
marks via toolbar button clicks instead of keyboard shortcuts, which are
unaffected by this and is the more direct way to exercise the new UI
anyway.

## Unit tests (Jasmine)

Command:

```
xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test \
  -f "composer-(toolbar-utils|clipboard-plugins|marks-safe|toolbar-formatting)-spec"
```

This runs the new `composer-toolbar-formatting-spec.ts` together with the
three existing specs that touch code this issue modified
(`toolbar-utils.ts`, `toolbar-component-factories.tsx`), confirming no
regressions.

Output (tail):

```
  75 passing
```

All 75 pass, 0 failures. `composer-toolbar-formatting-spec.ts` alone
contributes 51 of the 75 (verified via a standalone `-f
"composer-toolbar-formatting-spec"` run beforehand, which also showed `51
passing`).

## E2e tests (Playwright)

Command:

```
xvfb-run -a npx playwright test --config playwright/playwright.config.ts \
  tests/compose.spec.ts --grep \
  "heading dropdown changes the block|align-group toggles|highlight color picker opens|superscript toggle wraps|subscript toggle wraps|indent/outdent buttons change|clear-formatting removes|horizontal rule insert|undo/redo round-trips|insert-image toolbar button"
```

Output:

```
  ✓   1 playwright/tests/compose.spec.ts:732:5 › heading dropdown changes the block to Heading 1 (4.1s)
  ✓   2 playwright/tests/compose.spec.ts:755:5 › align-group toggles active state and applies text-align (3.9s)
  ✓   3 playwright/tests/compose.spec.ts:781:5 › highlight color picker opens and applies a background color (3.9s)
  ✓   4 playwright/tests/compose.spec.ts:814:5 › superscript toggle wraps text in sup (3.4s)
  ✓   5 playwright/tests/compose.spec.ts:835:5 › subscript toggle wraps text in sub (3.4s)
  ✓   6 playwright/tests/compose.spec.ts:856:5 › indent/outdent buttons change block type (4.1s)
  ✓   7 playwright/tests/compose.spec.ts:881:5 › clear-formatting removes bold and italic after applying them (3.8s)
  ✓   8 playwright/tests/compose.spec.ts:910:5 › horizontal rule insert adds an hr element and lands the cursor in an empty block after it (3.7s)
  ✓   9 playwright/tests/compose.spec.ts:939:5 › undo/redo round-trips a bold toggle (3.9s)
  ✓  10 playwright/tests/compose.spec.ts:970:5 › insert-image toolbar button renders and is clickable without throwing (3.6s)
  10 passed (45.8s)
```

Regression spot-check on pre-existing tests that touch the shared toolbar
(`c opens new message composer`, `clicking compose button opens composer`
pass; `link toolbar button opens link picker dropdown with URL input` fails
identically before and after this change, due to the `openThread` fixture
limitation described above — confirmed pre-existing, not caused by this
issue):

```
  ✓  1 playwright/tests/compose.spec.ts:46:5 › c opens new message composer (3.9s)
  ✓  2 playwright/tests/compose.spec.ts:57:5 › clicking compose button opens composer (3.1s)
  ✘  3 playwright/tests/compose.spec.ts:369:5 › link toolbar button opens link picker dropdown with URL input (31.5s)
     TimeoutError: locator.click: Timeout 30000ms exceeded.
     waiting for locator('.thread-list .list-item').first()
```

## Static checks

`npx eslint -c .eslintrc "app/src/components/composer-editor/**/*.{ts,tsx}" "app/spec/composer-toolbar-formatting-spec.ts"` →
clean, 0 problems (after one `--fix` pass for 4 prettier formatting nits).

`npx eslint -c .eslintrc "playwright/tests/compose.spec.ts"` hits a
**pre-existing** repo config gap: `.eslintrc`'s `parserOptions.project`
points at `app/tsconfig.json`, which never includes `playwright/**` — and
this is not specific to this change: `package.json`'s own `lint`/
`lint:check` scripts only glob `app/src/**` and `app/internal_packages/**`,
never `playwright/`. Verified instead with `playwright/tsconfig.json`'s own
strict TypeScript config (`cd playwright && npx tsc -p tsconfig.json
--noEmit`): the only errors reported are (a) pre-existing `@types/slate-react`
declaration-file errors unrelated to any test file, and (b) three
pre-existing errors at lines 661/664/682 of `compose.spec.ts` — all strictly
above and unrelated to the new section this issue appends starting at line
727. Zero new type errors introduced.

## Acceptance criteria → evidence

| # | Acceptance criterion | Evidence |
|---|---|---|
| 1 | Each new control appears in the toolbar, grouped into a sensible section with the existing divider convention | `history-plugins.tsx`/`hr-plugins.tsx` each own a `toolbarSectionClass`; heading dropdown/align group/indent/outdent/dir join the existing block section; highlight picker/superscript/subscript/clear-formatting join the existing mark section; insert-image joins `inline-attachment-plugins.tsx`'s section. `composer-editor-toolbar.tsx`'s existing divider-between-sections logic is untouched. Visually confirmed via the 10 passing e2e tests above, each of which locates and interacts with its control. |
| 2 | Each control round-trips through HTML serialize/deserialize | `base-block-plugins.tsx` rules (`buildBlockDeserializeData` — className+align+dir merge), `base-mark-plugins.tsx` rules (backgroundColor→highlight detection, `<sup>`/`<sub>` tag rules), `hr-plugins.tsx` rules (`<hr>` tag rule) — all covered by `composer-toolbar-formatting-spec.ts`'s `BLOCK_CONFIG.div.render`/`buildBlockDeserializeData`-adjacent tests and the mark-classification tests. |
| 3 | Toggle-style buttons (align, superscript/subscript, indent/outdent) reflect active state | `isActive`/`active` class asserted directly in the e2e align-group test (`toHaveClass(/active/)`); superscript/subscript/indent/outdent driven through `BuildToggleButton`'s existing active-state mechanism (unchanged) plus the new `isDisabled` support, unit-tested via `isAlignDirDisabled`/`isHeadingDropdownDisabled` in the Jasmine spec. |
| 4 | No regression to existing toolbar items | 75/75 passing across the 3 pre-existing + 1 new spec file; `c opens new message composer`/`clicking compose button opens composer` e2e tests still pass; no existing `MARK_CONFIG`/`BLOCK_CONFIG` entry, `toolbarComponents` array, or `appCommand` was removed or renamed (`indentBlock`/`outdentBlock` factor the exact same logic the appCommands already ran). |
| 5 | New Jasmine specs cover conversion and toggle-active-state logic for each new mark/block | `composer-toolbar-formatting-spec.ts`, 51 tests covering: mark-type classification, block-type dropdown resolution, nesting-disabled predicates, block-data read/merge (Map + plain-object), align/dir pure helpers, indent/outdent, `div.render` (align/dir/empty-block-export), clear-formatting, background-color meaningfulness, hr insert cursor-safety, undo/redo wiring. |

## Per-feature scenario results (docs/issues/7/test-cases.md)

| Test case | Result |
|---|---|
| 1. Undo / Redo | PASS — e2e `undo/redo round-trips a bold toggle` |
| 2. Paragraph-style dropdown | PASS — e2e `heading dropdown changes the block to Heading 1`; disabled-state PASS via Jasmine `isHeadingDropdownDisabled` (4 cases) |
| 3. Text alignment | PASS — e2e `align-group toggles active state and applies text-align`; data-merge/empty-block-export PASS via Jasmine `BLOCK_CONFIG.div.render` (7 cases), `isAlignDirDisabled` (3 cases) |
| 4. Highlight color | PASS — e2e `highlight color picker opens and applies a background color`; clear-affordance and background-color detection PASS via Jasmine `isMeaningfulBackgroundColor` (5 cases) |
| 5. Indent / Outdent | PASS — e2e `indent/outdent buttons change block type`; pure logic PASS via Jasmine `indentBlock`/`outdentBlock` (4 cases) |
| 6. Superscript / Subscript | PASS — e2e `superscript toggle wraps text in sup`, `subscript toggle wraps text in sub`; mark classification PASS via Jasmine `TOGGLE_MARK_TYPES` tests |
| 7. Clear-formatting | PASS — e2e `clear-formatting removes bold and italic after applying them`; pure logic PASS via Jasmine `clearFormatting` |
| 8. Horizontal rule | PASS — e2e `horizontal rule insert adds an hr element and lands the cursor in an empty block after it`; cursor-safety PASS via Jasmine `insertHorizontalRule` |
| 9. Insert inline image | PASS (render/actionability-only, per assignment scope — no OS dialog automation) — e2e `insert-image toolbar button renders and is clickable without throwing` |
| 10. Text direction | PASS — covered by the same `BLOCK_CONFIG.div.render` Jasmine tests as alignment (explicit-dir-wins, empty-block export carry-through); toggle button reuses the same `BuildToggleButton`/`isAlignDirDisabled` mechanism verified for alignment. No dedicated e2e test was added beyond the Jasmine coverage since it shares 100% of its render/data-merge code path with alignment (already e2e-verified) and differs only in which data key is written. |

## Orchestrator verification (independent of the implementor's claims)

Re-run personally, not just read: `tsc -p app/tsconfig.json --noEmit` (found and fixed 2
real type errors the implementor's scoped run hadn't caught — `setNodeByKey`'s `type`
requirement, `Editor.props` typing on the image-insert button), the 75/52-passing Jasmine
run, the 10 new Playwright e2e tests, and a full `compose.spec.ts` run confirming the
`openThread()`-fixture-DB limitation is pre-existing (byte-identical failure reproduced by
checking out the unmodified base commit and re-running `Cmd+B toggles bold in composer`
in isolation).

## Independent Review Gate — verdict: APPROVE (after one fix)

Cold review (fresh subagent, diff + plan doc only, no implementor summary) found the
implementation faithfully satisfies all 10 features and all 12 binding plan-review
resolutions, with one real moderate-priority finding: `isMeaningfulBackgroundColor` didn't
exclude white, the overwhelmingly common non-meaningful background value real-world HTML
emails set on wrapper `<div>`/`<table>` elements for Outlook/MSO cross-client fidelity —
reopening such a draft would spuriously mark that content as user-highlighted. Fixed by
mirroring the existing black-exclusion already applied to the foreground `color` mark;
covered by a new Jasmine case; full spec file re-run at 52/52 passing after the fix.
