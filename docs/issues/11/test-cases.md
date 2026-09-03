# Issue #11 — Test Cases: `DraftFactory._accountForNewDraft` precedence

All cases exercise the fix end-to-end via `DraftFactory.createDraft()` (the public method
used by the real "New Email" compose path), asserting on the resulting `Message`'s
`accountId` and `from[0].email`, against the real `AccountStore` / `FocusedPerspectiveStore`
/ `FocusedContentStore` singletons (no mocking of the decision path itself).

Location: `app/spec/stores/draft-factory-spec.ts`, `describe('_accountForNewDraft', ...)`.

Fixtures used in every case below (set up by the file's top-level `beforeEach` and this
`describe` block's own `beforeEach`):
- `account` = `AccountStore.accounts()[0]` (`test-account-server-id` / `tester@mailspring.com`)
- `secondAccount` = `AccountStore.accounts()[1]` (`second-test-account-id` / `second@gmail.com`)
- `fakeThread` = thread fixture with `accountId: account.id`

---

## Test 1 — Single-account perspective ignores focused thread from another account

**Maps to issue AC:** "Single-account inbox view: no change."

- **Preconditions:** `FocusedPerspectiveStore._current` set to `new MailboxPerspective([account.id])`.
- **Steps:**
  1. Construct `otherAccountThread` with `accountId: secondAccount.id`.
  2. `Actions.setFocus({ collection: 'thread', item: otherAccountThread })`.
  3. `await DraftFactory.createDraft()`.
- **Expected result:** `draft.accountId === account.id` and `draft.from[0].email === account.defaultMe().email`. The focused thread belonging to a different account is ignored entirely because the perspective is single-account (`perspectiveAccountIds.length > 1` is false, so the new branch never engages).

## Test 2 — Multi-account perspective, no thread focused, falls back to `accountIds[0]`

**Maps to issue AC:** "Unified view + no thread selected: today's fallback, no regression."

- **Preconditions:** `FocusedPerspectiveStore._current` set to `new MailboxPerspective([account.id, secondAccount.id])`; `FocusedContentStore` has no focused thread (reset by this file's own `afterEach` from the previous test, and `master-before-each.ts`'s `AccountStore`/config resets don't touch it, so it starts empty for the whole run).
- **Steps:** `await DraftFactory.createDraft()`.
- **Expected result:** `draft.accountId === account.id` (i.e. `accountIds[0]`), unchanged pre-fix behavior.

## Test 3 — Multi-account perspective, second account's thread focused → uses that account (core bug fix)

**Maps to issue AC:** "Unified view + thread selected: defaults to selected thread's account."

- **Preconditions:** `FocusedPerspectiveStore._current` set to `new MailboxPerspective([account.id, secondAccount.id])`.
- **Steps:**
  1. Construct `secondAccountThread` with `accountId: secondAccount.id`.
  2. `Actions.setFocus({ collection: 'thread', item: secondAccountThread })`.
  3. `await DraftFactory.createDraft()`.
- **Expected result:** `draft.accountId === secondAccount.id` and `draft.from[0].email === secondAccount.defaultMe().email` — this is the exact bug the issue reports, now fixed.

### Test 3 (mirror) — order-independence check

- **Preconditions:** `FocusedPerspectiveStore._current` set to `new MailboxPerspective([secondAccount.id, account.id])` (accounts listed in the opposite order).
- **Steps:**
  1. `Actions.setFocus({ collection: 'thread', item: fakeThread })` (`fakeThread.accountId === account.id`, now the *second* entry in `accountIds`).
  2. `await DraftFactory.createDraft()`.
- **Expected result:** `draft.accountId === account.id` — proves the fix follows the focused thread's account, not an "always pick index 1" or other array-position artifact.

## Test 4 — Focused thread's account is not a member of the perspective → falls back, does not throw

**Maps to issue AC:** guard/no-crash behavior for the precedence order (regression coverage).

- **Preconditions:** `FocusedPerspectiveStore._current` set to `new MailboxPerspective([account.id, secondAccount.id])`.
- **Steps:**
  1. Construct `staleThread` with `accountId: 'account-id-not-in-perspective'` (simulates a cross-account focus set directly via `Actions.setFocus`, e.g. from `chat-panel.tsx`/`sidebar-related-threads.tsx`/`unread-notifications`, per Plan Review Gate finding 3 — not a perspective-switch artifact, since `ThreadListStore._onPerspectiveChanged` always clears focus on perspective change).
  2. `Actions.setFocus({ collection: 'thread', item: staleThread })`.
  3. `await DraftFactory.createDraft()`.
- **Expected result:** `draft.accountId === account.id` (falls back to `accountIds[0]`); no exception thrown; the stale account id never leaks into the draft.

## Test 5 — Pinned `core.sending.defaultAccountIdForSend` always wins

**Maps to issue AC:** "Pinned 'Send new messages from' preference always wins."

- **Preconditions:** `FocusedPerspectiveStore._current` set to `new MailboxPerspective([account.id])` (would otherwise resolve to `account`, the *first* account).
- **Steps:**
  1. `AppEnv.config.set('core.sending.defaultAccountIdForSend', secondAccount.id)`.
  2. No thread focused.
  3. `await DraftFactory.createDraft()`.
- **Expected result:** `draft.accountId === secondAccount.id` and `draft.from[0].email === secondAccount.defaultMe().email` — the pinned preference wins regardless of perspective/focus, confirming this pre-existing, correct precedence step is untouched by the fix.

---

## Cleanup / isolation

This `describe` block's own `afterEach` resets `FocusedContentStore._focused` and
`FocusedContentStore._keyboardCursor` to `{}` after every test in this block. This is
required because `app/spec/spec-runner/master-before-each.ts` resets `AccountStore` and
`FocusedPerspectiveStore._current` before every spec in the whole Jasmine process, but never
resets `FocusedContentStore` — and prior to this issue, no spec in the repo called
`Actions.setFocus` with a thread, so there was no leakage risk. These are the first tests to
do so; without this local `afterEach`, a focused thread set here would persist into whichever
spec file runs next in the same process.
