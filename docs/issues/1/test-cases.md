# Test Cases — Issue #1: Folder list missing unread count + missing "Mark All as Read"

## TC1 — Folder unread badge shows without touching preferences

**Preconditions:**
- Fresh Mailspring install/profile, `core.workspace.showUnreadForAllCategories` never explicitly set by the user (uses schema default).
- At least one account with a non-Inbox folder/label (e.g. a user label or "Archive") containing one or more unread threads.

**Steps:**
1. Launch Mailspring and sign in to the account.
2. Look at the account sidebar folder/label tree without opening Preferences.
3. Locate the folder/label that has unread threads.

**Expected result:**
- The folder/label row shows a numeric unread-count badge matching the number of unread threads in that category, exactly like Inbox already does — without the user ever visiting Preferences → Workspace.

---

## TC2 — "Mark All as Read" appears in a real folder's context menu and marks its unread threads read

**Preconditions:**
- Same account as TC1, with a real folder or label (e.g. "Archive", a user label, or a non-special folder) containing 1+ unread threads.

**Steps:**
1. Right-click the folder/label in the sidebar.
2. Observe the context menu.
3. Click "Mark All as Read".
4. Re-open the folder/label and look at the unread badge and the thread list.

**Expected result:**
- The context menu includes a "Mark All as Read" item as the first entry (above Rename/Delete/New Subfolder/Export, when present).
- Clicking it queues a task that marks every currently-unread thread in that category as read; the unread badge for the folder clears (or decreases to 0) and the previously-unread messages in the thread list no longer show as unread.
- The action is undoable via the standard undo mechanism (`canBeUndone: true`).
- If the folder/label has zero unread threads, clicking the item is a no-op (no task queued, nothing visibly changes).

---

## TC3 — "Mark All as Read" does NOT appear on the virtual Unread/Starred/Drafts nodes

**Preconditions:**
- Sidebar showing the virtual "Unread", "Starred", and "Drafts" nodes (not real folders/labels).

**Steps:**
1. Right-click the "Unread" node in the sidebar.
2. Observe the context menu (or lack thereof).
3. Repeat for "Starred".
4. Repeat for "Drafts".

**Expected result:**
- None of "Unread", "Starred", or "Drafts" show a "Mark All as Read" entry in their context menu. (Today these nodes have no context menu at all; that remains true — no accidental "mark this account's inbox read" side effect is introduced.)
