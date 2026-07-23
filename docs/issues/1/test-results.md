# Test Results — Issue #1: Folder list missing unread count + missing "Mark All as Read"

## Automated tests

**Command run:**

```
xvfb-run -a npx electron ./app --enable-logging --test \
  --spec-directory="$(pwd)/app/internal_packages/account-sidebar/specs" \
  --spec-file-pattern='-spec\.(js|jsx|es6(\.ts)?|es|ts|tsx)$'
```

Note: the default spec-file regex baked into `app/spec/spec-runner/spec-loader.ts`
(`/-spec\.(js|jsx|es6|es|ts|tsx)$/`) does not match this suite's pre-existing
filename `sidebar-item-spec.es6.ts` (its extension is `.es6.ts`, not `.es6` or
`.ts` alone), so it is never picked up by a plain `npm test`/CI run today. This
is a pre-existing naming quirk, out of scope for this change (not listed in the
approved plan's file list) — worked around here for verification purposes only
via `--spec-file-pattern`, without touching the spec loader or renaming the file.

**Actual output (red phase, before implementation — tests added, no implementation yet):**

```
  sidebar-item
    ✓ preserves nested labels on rename
    ✓ preserves labels on rename
    onMarkAllAsRead
      ✗ queues a ChangeUnreadTask for unread threads in the category
      ✗ is a no-op when there are no unread threads
      ✗ is present on items built via forCategories
      ✓ is not present on items built via forUnread
      ✓ is not present on items built via forStarred
      ✓ is not present on items built via forDrafts

  5 passing
  3 failing

  1) sidebar-item onMarkAllAsRead queues a ChangeUnreadTask for unread threads in the category.
     TypeError: item.onMarkAllAsRead is not a function
  2) sidebar-item onMarkAllAsRead is a no-op when there are no unread threads.
     TypeError: item.onMarkAllAsRead is not a function
  3) sidebar-item onMarkAllAsRead is present on items built via forCategories.
     Expected undefined to be defined.
```

The three failures are genuine missing-behavior failures (`onMarkAllAsRead` did
not exist on `SidebarItem`-built items yet), not typos in the test file. The
"is not present on ..." tests for `forUnread`/`forStarred`/`forDrafts` passed
even before implementation, since `undefined` was already the value for a
field that didn't exist — expected, and re-confirmed to still hold after
implementation below.

**Actual output (green phase, after implementation):**

```
  sidebar-item
    ✓ preserves nested labels on rename
    ✓ preserves labels on rename
    onMarkAllAsRead
      ✓ queues a ChangeUnreadTask for unread threads in the category
      ✓ is a no-op when there are no unread threads
      ✓ is present on items built via forCategories
      ✓ is not present on items built via forUnread
      ✓ is not present on items built via forStarred
      ✓ is not present on items built via forDrafts

  8 passing
```

**Typecheck:** `./node_modules/.bin/tsc -p app/tsconfig.json --noEmit` — exit code 0, no errors.

## What automated tests cover vs. what they don't

- **Covered by the spec above:** `SidebarItem.onMarkAllAsRead` queries for
  unread threads in a category via `DatabaseStore.findAll`, queues a
  `ChangeUnreadTask` (via `TaskFactory.taskForSettingUnread`) with the right
  thread ids/`unread: false`/`source` when unread threads exist, no-ops when
  there are none, and is present only on items built through
  `SidebarItem.forCategories` (real folders/labels) — not on `forUnread`,
  `forStarred`, or `forDrafts`.
- **NOT covered / not verifiable headlessly in this environment:**
  - TC1's visual unread-count badge rendering in the actual sidebar UI — the
    config default flip (`showUnreadForAllCategories: false → true`) and the
    existing `OutlineViewItem` badge-render path were read and confirmed
    correct by code inspection, but the app was not driven interactively
    end-to-end in a running window to visually confirm the badge appears. Not
    claimed as visually verified.
  - TC2's actual context-menu popup (`Menu`/`MenuItem` from `@electron/remote`,
    native OS context menu) — the `_shouldShowContextMenu()` gating and
    `_buildContextMenu()` menu-item construction were read and updated per the
    plan, but rendering/clicking a real native context menu is Electron-native
    UI not exercised by the Jasmine spec suite run here.
  - End-to-end effect of "Mark All as Read" on the rendered thread list (badge
    clearing, message rows updating) — this depends on the sync engine and
    `ChangeUnreadTask` performing local + remote changes, which is exercised
    elsewhere by that task's own existing tests, not re-verified here.

Per the assignment, the full `npm test` suite and project-wide lint were
intentionally not run; only the `account-sidebar` specs directory above was
executed, as scoped.

## Post-review fixes (independent review gate, step 11)

Two review findings required code/test changes (see `plan.md` § Independent Review Verdict): added `.catch(AppEnv.reportError)` to the DB query in `onMarkAllAsRead`, and fixed a test-isolation gap (`beforeEach` resetting `AppEnv.savedState.sidebarKeysCollapsed` in the `onMarkAllAsRead` describe block, plus making the spec's `DatabaseStore.findAll` mock `then()` return a real `Promise` so `.catch()` on it doesn't throw).

**Re-verified independently by the orchestrator (not just the implementor) after these fixes**, same command as above:

```
  sidebar-item
    ✓ preserves nested labels on rename
    ✓ preserves labels on rename
    onMarkAllAsRead
      ✓ queues a ChangeUnreadTask for unread threads in the category
      ✓ is a no-op when there are no unread threads
      ✓ is present on items built via forCategories
      ✓ is not present on items built via forUnread
      ✓ is not present on items built via forStarred
      ✓ is not present on items built via forDrafts

  8 passing
```

`./node_modules/.bin/tsc -p app/tsconfig.json --noEmit` — exit code 0, no errors.

## Interactive verification against the real local mail cache (post-close, in response to "no test?")

Automated specs (above) don't exercise the actual rendered UI or the native OS context
menu. Ran the built dev app (`electron ./app --enable-logging --dev`) headlessly under
Xvfb (`:99`), attached via CDP (`--remote-debugging-port`), against the real local
`~/.config/Mailspring-dev` cache for `annguyen209@gmail.com` (3475k threads across
Inbox/Important/Spam/Trash/All Mail + 10 user labels, already synced from a prior
session — live IMAP sync itself is broken in this sandbox due to keychain access, but
the local read-only cache the sidebar renders from is real and unaffected by that).

**Criterion 1 — unread badge on non-Inbox folders**, confirmed twice:
- `SidebarStore.standardSection()`/`.userSections()` queried live via `tab.evaluate`:
  `Spam.count = 67`, `Trash.count = 31`, `Important.count = 982`, label `HSBC.count = 3`
  — all non-Inbox, all previously forced to `0` before this fix.
- Same numbers visually present in a real screenshot of the rendered sidebar (Inbox
  4599, Important 982, All Mail 4708, Spam 67, Trash 31, HSBC 3, all rendered as
  badges next to their folder/label names).

**Criterion 2 — "Mark All as Read" in the folder context menu**, confirmed by actually
triggering it: dispatched a real right-click (`ElementHandle.click({button:'right'})`,
routes through the same `contextmenu` DOM event the app listens for) on the "HSBC"
label row, then captured the **native OS-level Electron menu** via an X11 root-window
screenshot (`import -window root`, not a page/CDP screenshot — a `Menu.popup()` native
menu isn't part of the page's render tree and won't show up in a CDP page capture).
Result, saved at `docs/issues/1/evidence/context-menu-mark-all-as-read.png`:

```
Mark All as Read      <- new, first item, as designed
Rename Label
Delete Label
New Sublabel...
Export folder as .eml files...
```

Dismissed the menu (OS-level Escape via `xdotool`, page-level `Escape` didn't reach
the native menu) **without clicking any item** — re-queried `HSBC.count` afterward,
still `3`, confirming no mutation was made to the real account during verification
(didn't want to fire a real mark-read task against someone's actual mailbox, and the
sync engine is non-functional in this sandbox anyway so a "before/after count" test
of the actual mutation wouldn't have been clean evidence either way).

This supersedes the "not verified headlessly in this environment" caveats in the
Automated tests section above for the visual badge rendering and the context-menu
popup specifically — both are now directly, interactively confirmed against real data,
not just code-inspected.
