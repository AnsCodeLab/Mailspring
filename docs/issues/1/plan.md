# Plan — Issue #1: Folder list missing unread count + missing "Mark All as Read"

## Scope

Two independent, low-risk UI fixes in the account sidebar folder tree. No sync-engine/task-system changes beyond queuing one existing task type.

### Bug 1 — Unread counter not shown on folder name

**Root cause (confirmed by reading code, not assumed):**
`app/internal_packages/account-sidebar/lib/sidebar-item.ts` `countForItem()`:
```ts
const countForItem = function (perspective) {
  const unreadCountEnabled = AppEnv.config.get('core.workspace.showUnreadForAllCategories');
  if (perspective.isInbox() || unreadCountEnabled) {
    return perspective.unreadCount();
  }
  return 0;
};
```
`core.workspace.showUnreadForAllCategories` defaults to `false` (`app/src/config-schema.ts:71-74`), and only `Inbox` is exempted. So every folder/label except Inbox always renders `count: 0`, and `OutlineViewItem._renderItem()` only draws the badge when `item.count > 0` — the render path itself is correct, the input is deliberately zeroed. This isn't a rendering bug; it's a surprising default that suppresses the feature by default, which is what the issue reporter observed as "not shown."

**Fix:** flip the config default to `true` in `app/src/config-schema.ts` (one line: `default: false` → `default: true`). The preference toggle in Preferences → Workspace (`workspace-section.tsx:166-170`) stays as-is, so users who don't want per-folder counts can still turn it off. No other file changes needed — `unreadCount()` on `CategoryMailboxPerspective` (`app/src/mailbox-perspective.ts:412-418`) already correctly sums `ThreadCountsStore.unreadCountForCategoryId()` per category; verified it's not stale/broken.

**Files touched:** `app/src/config-schema.ts` (1 line).

### Bug 2 — Context menu missing "Mark All as Read"

**Root cause:** `OutlineViewItem` (`app/src/components/outline-view-item.tsx`) only builds a context menu when at least one of `onDelete`/`onEdited`/`onExport`/`onCreateChild` is set on the item (`_shouldShowContextMenu()`), and `_buildContextMenu()` only knows how to render those four actions. There is no "mark all as read" concept anywhere in the outline view or in `SidebarItem`.

**Fix — new callback threaded end to end:**
1. `app/src/components/outline-view.tsx` — add `onMarkAllAsRead?: (...args: any[]) => any;` to `IOutlineViewItem`.
2. `app/src/components/outline-view-item.tsx`:
   - Add `this.props.item.onMarkAllAsRead != null` to `_shouldShowContextMenu()`.
   - Add a `MenuItem` in `_buildContextMenu()` — label `localized('Mark All as Read')`, click → `() => this._runCallback('onMarkAllAsRead')`. Placed first in the menu (most common, non-destructive action).
3. `app/internal_packages/account-sidebar/lib/sidebar-item.ts`:
   - New `onMarkAllAsRead(item: ISidebarItem)` handler, following the existing `onDeleteItem`/`onExportFolder` pattern:
     ```ts
     const onMarkAllAsRead = function (item: ISidebarItem) {
       const category = item.perspective.category();
       if (!category) return;
       const matchers = [
         Thread.attributes.categories.containsAny([category.id]),
         Thread.attributes.unread.equal(true),
       ];
       if (!['spam', 'trash'].includes(category.role)) {
         matchers.push(Thread.attributes.inAllMail.equal(true));
       }
       DatabaseStore.findAll<Thread>(Thread)
         .where(matchers)
         .then((threads) => {
           if (threads.length === 0) return;
           Actions.queueTask(
             TaskFactory.taskForSettingUnread({
               threads,
               unread: false,
               source: 'Sidebar Context Menu: Mark All As Read',
               canBeUndone: true,
             })
           );
         });
     };
     ```
     Query pattern and `inAllMail` gating copied from the existing, already-tested `app/src/flux/models/unread-query-subscription.ts` and `CategoryMailboxPerspective.threads()` (`app/src/mailbox-perspective.ts:385-410`) — not invented from scratch. `TaskFactory.taskForSettingUnread` and `ChangeUnreadTask` are the existing task machinery used for the per-thread "mark as read" action elsewhere (`mail-rules-processor.ts`, `message-store.ts`), so this reuses the sync/undo path rather than adding a new one.
   - Wire it in `SidebarItem.forPerspective()`: `onMarkAllAsRead: perspective.category() ? onMarkAllAsRead : undefined`.
     Using `perspective.category()` (returns non-null only for a perspective backed by exactly one real category — `app/src/mailbox-perspective.ts:169-171`) means this naturally scopes to real folders/labels (Inbox, Sent, Trash, Spam, Archive, user folders/labels) and stays absent on the virtual Starred/Unread/Drafts/multi-account aggregate nodes, which aren't "a folder" in the sense the issue describes.
   - New imports needed in `sidebar-item.ts`: `DatabaseStore`, `Thread`, `TaskFactory` from `mailspring-exports`.

**Files touched:** `app/src/components/outline-view.tsx` (1 line), `app/src/components/outline-view-item.tsx` (~10 lines), `app/internal_packages/account-sidebar/lib/sidebar-item.ts` (~25 lines).

## Why not disable the menu item when count is 0

`item.count` reflects the *displayed* badge, which is itself gated by the (now-changed, but still user-togglable) `showUnreadForAllCategories` preference. Tying menu-item `enabled` state to `item.count` would silently break if a user turns that preference back off — the menu item would falsely disable even when unread threads exist. Instead the handler itself no-ops when the DB query returns zero threads. Simpler and correct under every config combination.

## Open questions
None — both root causes were confirmed by reading the actual implementation, not inferred from the bug description.

## Test plan (step 7/9)
- Existing spec file: `app/internal_packages/account-sidebar/specs/sidebar-item-spec.es6.ts` — extend with cases for `countForItem`-adjacent behavior (via config default) and a new spec for `onMarkAllAsRead` (mock `DatabaseStore.findAll`, assert `Actions.queueTask` called with a `ChangeUnreadTask`-producing call for the right thread set, and a no-op when no unread threads).
- Manual test case (recorded in `test-cases.md`): open app, unread folder shows count without touching preferences; right-click folder → "Mark All as Read" → count clears, messages marked read in list.

## Plan Review Verdict (Gate, step 4)

**Model:** `anthropic/claude-fable-5`, cold review (plan doc only, no implementer reasoning shown).

**Verdict:** APPROVE WITH CHANGES.

**Required change (accepted):** `perspective.category()` is non-null for `UnreadMailboxPerspective` too when scoped to a single account (`UnreadMailboxPerspective extends CategoryMailboxPerspective`, built from a single inbox category in `SidebarItem.forUnread`). Gating `onMarkAllAsRead` purely on `perspective.category()` would wrongly attach "Mark All as Read" to the virtual "Unread" node (which currently has no context menu at all) and — worse — clicking it would silently mark the account's Inbox category read, not just the Unread view.

**Resolution:** switch from structural inference to an explicit opt-in flag, matching the existing `deletable`/`editable`/`exportable` convention already used in `SidebarItem`:
- `forCategories()` defaults `opts.markableAllRead = true` when unset (mirrors how it already defaults `opts.exportable`) — this is the only place real folders/labels are constructed (`forUserCategories`, `standardSectionForAccount`, `standardSectionForAccounts`).
- `forPerspective()` sets `onMarkAllAsRead: opts.markableAllRead && perspective.category() ? onMarkAllAsRead : undefined` — the `perspective.category()` check stays as defense-in-depth (handler needs a real category to query), the `opts.markableAllRead` check is what actually scopes it away from `forUnread`/`forStarred`/`forDrafts`, none of which set that opt.

**Accepted risks (from review, no code change needed):**
- Unbounded `DatabaseStore.findAll(Thread)` with no `.limit()` — verified default `QueryRange.infinite()` (`app/src/flux/models/query-range.ts:2-4`) already means "no limit" when `.limit()` is never called, so this isn't a truncation bug. Materializing all matching threads for a bulk mark-read is inherent to correctness (can't mark-all-read without touching all matches); adding `.limit(0)` anyway for clarity/consistency with `unread-query-subscription.ts`, no functional change.
- Config default flip (`false` → `true`) changes behavior for every existing install that never touched the preference. This is the intended fix for the reported bug (folders were supposed to show counts) — named explicitly here, not silently absorbed. Users who explicitly set the pref to `false` keep their choice (config values are stored as set, not stripped when they match the old default).

## Independent Review Verdict (Gate, step 11)

**Model:** `anthropic/claude-fable-5`, cold review (diff only, no implementer summary shown).

**Verdict:** APPROVE WITH CHANGES. Overall correctness: correct. Both acceptance criteria confirmed met by the diff alone.

**Findings addressed:**
- **No `.catch()` on the `DatabaseStore.findAll(...).where(...).then(...)` chain in `onMarkAllAsRead`** — a query failure would surface only as an unhandled promise rejection. Fixed: added `.catch(AppEnv.reportError)`, matching this codebase's established error-reporting convention (`account-store.ts`, `draft-store.ts`, `message-body-processor.ts`, etc.). Required updating the two spec mocks' `then()` to return a real `Promise` (`Promise.resolve(callback(...))`) instead of a synchronous plain-object return, so `.catch()` on the mock's return value doesn't throw — the previous mock wasn't Promise-shaped.
- **New `onMarkAllAsRead` spec block didn't reset `AppEnv.savedState.sidebarKeysCollapsed`** — passed only because two earlier tests in the same file happened to run first and left it initialized; would throw if run in isolation. Fixed: added a `beforeEach` inside the `describe('onMarkAllAsRead', ...)` block.

**Findings accepted, not changed (documented, not blocking):**
- **Top-level unified multi-account folder rows don't get "Mark All as Read."** `perspective.category()` returns `null` when a perspective spans more than one category, which is true for the aggregate parent row built in `SidebarSection.standardSectionForAccounts()` (one category per account, several accounts). The **per-account child rows** under that aggregate (`sidebar-section.ts:117-120`, single category each) *do* get the menu item and work correctly — so the feature is fully usable in multi-account setups via the per-account rows, just not at the aggregate parent. Extending to fan out one `ChangeUnreadTask` per account at the aggregate level (via `TaskFactory.tasksForThreadsByAccountId` + `Actions.queueTasks`) is a reasonable follow-up but changes the task-queueing shape (single task → task array) for what's a secondary path; deferred as a known, scoped limitation rather than expanding this fix's surface, per `CONTRIBUTING.md`'s explicit caution against adding complexity for behavior the maintainers haven't asked for.
- **Unbounded `DatabaseStore.findAll` with no `.limit()`.** Already addressed in the step-4 gate: `QueryRange.infinite()` is the default when `.limit()` is never called, so this isn't a truncation bug; materializing all matching threads is inherent to a correct bulk "mark all as read."
- **Config default flip is a behavior change for all existing installs.** Intentional — it's the entire fix for acceptance criterion 1. The opt-out toggle in Preferences → Workspace remains available.
