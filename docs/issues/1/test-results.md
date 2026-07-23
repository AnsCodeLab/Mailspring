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
