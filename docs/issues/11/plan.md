# Issue #11 — Compose defaults From to first account, ignoring selected thread's account

## Root cause (confirmed, re-verified against current source)

`DraftFactory._accountForNewDraft()` (`app/src/flux/stores/draft-factory.ts:407-418`):

```ts
_accountForNewDraft() {
  const defAccountId = AppEnv.config.get('core.sending.defaultAccountIdForSend');
  const account = AccountStore.accountForId(defAccountId);
  if (account) return account;

  const focusedAccountId = FocusedPerspectiveStore.current().accountIds[0];
  if (focusedAccountId) return AccountStore.accountForId(focusedAccountId);
  return AccountStore.accounts()[0];
}
```

- Step 1 (`core.sending.defaultAccountIdForSend`) is a genuine user preference ("Send new
  messages from:", default sentinel `'selected-mailbox'`, `app/internal_packages/preferences/lib/tabs/sending-section.tsx`)
  and behaves correctly today — not the bug, not touched by this fix.
- Step 2's `FocusedPerspectiveStore.current().accountIds[0]` is correct when the current
  perspective covers exactly one account (`accountIds.length === 1` — e.g. drilled into a
  single account's own Inbox section). It is **wrong** when the perspective is
  unified/multi-account (e.g. the merged "Inbox" across all accounts — Mailspring's default
  view with 2+ accounts): `accountIds[0]` is just whichever account sorts first, with zero
  relationship to which thread the user actually has selected.
- `FocusedContentStore.focused('thread')` (`app/src/flux/stores/focused-content-store.ts`)
  already tracks the currently selected/opened thread (set via `Actions.setFocus({
  collection: 'thread', item, usingClick })`, `_onFocus` at line 125) including its
  `accountId` — this is the natural source of truth for "the account of the selected email
  in the Inbox," and `DraftFactory` never consults it.

## Fix

In `_accountForNewDraft()`, when the current perspective spans more than one account, prefer
the focused thread's account (if one is focused and it's actually a member of the current
perspective's account set — guards against a stale focus left over from switching
perspectives) before falling back to today's `accountIds[0]` behavior:

```ts
_accountForNewDraft() {
  const defAccountId = AppEnv.config.get('core.sending.defaultAccountIdForSend');
  const account = AccountStore.accountForId(defAccountId);
  if (account) return account;

  const perspectiveAccountIds = FocusedPerspectiveStore.current().accountIds;

  if (perspectiveAccountIds.length > 1) {
    const focusedThread = FocusedContentStore.focused('thread');
    if (focusedThread && perspectiveAccountIds.includes(focusedThread.accountId)) {
      const focusedAccount = AccountStore.accountForId(focusedThread.accountId);
      if (focusedAccount) return focusedAccount;
    }
  }

  const focusedAccountId = perspectiveAccountIds[0];
  if (focusedAccountId) return AccountStore.accountForId(focusedAccountId);
  return AccountStore.accounts()[0];
}
```

New import: `FocusedContentStore` from `./focused-content-store` (not currently imported in
this file).

**Why gated on `perspectiveAccountIds.length > 1`, not always consulting the focused
thread:** in a single-account perspective there's no ambiguity to resolve — the account is
already fully determined, and unconditionally preferring the focused thread's account would
be a behavior change with no benefit (and a subtle risk: a focused thread from a *different*
account than the one whose single-account inbox you're now viewing, e.g. a stale focus after
switching, could otherwise leak through). Restricting the new logic to the genuinely
ambiguous case (multi-account perspective) is both the minimal fix and the safer one.

## Testing

This repo's spec harness (`app/spec/spec-runner/master-before-each.ts`) already registers
**two real accounts** on the actual `AccountStore` singleton before every spec
(`TestConstants.TEST_ACCOUNT_ID` / `'second-test-account-id'`), and resets
`FocusedPerspectiveStore._current` to `MailboxPerspective.forNothing()`. `app/spec/stores/draft-factory-spec.ts`
already exists with `account = AccountStore.accounts()[0]` and a `fakeThread` fixture. This
means the fix can be tested through the **real** Flux stores (real `AccountStore`, real
`FocusedPerspectiveStore` driven via `Actions.focusMailboxPerspective`, real
`FocusedContentStore` driven via `Actions.setFocus`) rather than mocked/stubbed — genuinely
exercising the same code path the running app uses, not a simulation of it. Add a new
`describe('_accountForNewDraft', ...)` block to the existing spec file covering:

1. Single-account perspective (construct directly via `new MailboxPerspective([account.id])`
   — the same pattern `mailbox-perspective-spec.ts` already uses, avoiding a `CategoryStore`/
   DB dependency for category-backed perspectives that this spec doesn't need) →
   returns that account, regardless of any focused thread (no regression / no new
   ambiguity-resolution in the unambiguous case).
2. Multi-account (unified) perspective, no thread focused → returns
   `accountIds[0]`'s account (today's fallback behavior, unchanged — this is the acceptance
   criteria's explicit no-regression case for "no thread selected").
3. Multi-account perspective, second account's thread focused → returns the **second**
   account (the exact bug this issue reports, now fixed) — this is the core "full flow"
   scenario, run for both possible account orderings (second-account-focused with account 1
   first in the perspective, and vice versa via a differently-ordered perspective) to rule
   out any hidden dependency on array order.
4. Multi-account perspective, focused thread belongs to an account NOT in the current
   perspective's `accountIds` (a stale/cross-account focus set directly via `Actions.setFocus`
   — see Plan Review Gate item 3 below for why this is the actual reachable trigger, not
   perspective switching itself) → falls back to `accountIds[0]`, does not throw, does not
   leak the stale account.
5. `core.sending.defaultAccountIdForSend` pinned to a specific account → always wins,
   regardless of perspective or focused thread (confirms the existing, correct precedence is
   untouched by this change).

That's 5 distinct scenario tests exercising the full real-store decision flow end-to-end,
directly satisfying the acceptance criteria's four-way precedence requirement.

### Interactive / build verification (requested explicitly)

This sandbox's Playwright e2e harness (`playwright/helpers.ts`) depends on a hardcoded
macOS-only fixture path (`FIXTURE_DIR`) for any test needing populated thread-list data
(`openThread`/`focusThread` helpers) — confirmed unavailable in this Linux sandbox in prior
work this session (identical pre-existing failure reproduced against the unmodified base
commit). A full "click a real thread in a real running app, click Compose, inspect the
resulting window's From field" flow through Playwright is therefore not executable here.

In its place: (1) `npm run build`/a full `tsc`+bundle-equivalent build pass to confirm the
change is deployable, not just `tsc --noEmit`-clean, and (2) the real-store Jasmine specs
above ARE the "full flow" in every way that doesn't require actual window/IPC rendering —
they call `DraftFactory.createDraft()` (the exact method `DraftStore._onPopoutBlankDraft`
calls when you click New Email) end-to-end against the real `AccountStore`/
`FocusedPerspectiveStore`/`FocusedContentStore` singletons, asserting on the resulting
draft's `.from`. Per the user's explicit request to exercise "the full flow" 5 times: the 5
scenario tests above each independently drive `createDraft()` start-to-finish through the
real decision path.

## Acceptance criteria mapping (from the issue)

| Issue AC | How satisfied |
|---|---|
| Single-account inbox view: no change | Test 1 |
| Unified view + thread selected: defaults to selected thread's account | Test 3 |
| Unified view + no thread selected: today's fallback, no regression | Test 2 |
| Pinned "Send new messages from" preference always wins | Test 5 |
| Regression test coverage for the precedence order | Tests 1-5 |

## Non-goals

- Changing `core.sending.defaultAccountIdForSend`'s own behavior/UI.
- Reply/forward draft creation (`createDraftForReply`/`createDraftForForward`) — those
  already correctly derive `from` from the specific message/thread being replied to via
  `_fromContactForReply`, independent of `_accountForNewDraft()`; this issue and fix are
  scoped to the **blank/new** compose path only (`createDraft()` with no thread context).

## Plan Review Gate — verdict: APPROVE WITH CHANGES

Independent reviewer findings, verified against current source before adopting (binding):

1. **Blocking, confirmed real**: `master-before-each.ts` resets `AccountStore` and
   `FocusedPerspectiveStore._current` before every spec, but never resets
   `FocusedContentStore`. No existing spec currently calls `Actions.setFocus` with a thread
   (verified via repo-wide grep), so there's no leakage TODAY — but this plan's new tests
   are the first to do so, and Jasmine runs the entire suite in one process with these
   singletons persisting across every spec file. **Required**: reset
   `FocusedContentStore`'s internal `_focused`/`_keyboardCursor` state in this spec file's
   own `afterEach` (scoped to this file only — do not modify the shared
   `master-before-each.ts` for a need only this spec has, to avoid affecting every other
   spec's timing/behavior).
2. **Confirmed real, documented not fixed (correctly out of scope)**: `createDraft()`
   (`draft-factory.ts:56-90`) uses the `account` returned by `_accountForNewDraft()` for
   `account.autoaddress` (auto-CC/BCC) at line 78, AFTER `Object.assign(defaults, fields)` —
   meaning even `createDraftForReply`/`createDraftForForward`, which override `from`/
   `accountId` via `fields`, have ALWAYS sourced auto-CC/BCC from
   `_accountForNewDraft()`'s account, not from the actual replied-to message's account. This
   is a pre-existing latent quirk, not introduced by this fix — but this fix's change to
   `_accountForNewDraft()`'s return value in the multi-account-perspective case means that
   quirk's behavior shifts too (now more often coincidentally matches the relevant thread's
   account instead of always the arbitrary first one). Net effect is neutral-to-positive,
   not a new regression, and fixing the auto-CC/BCC sourcing itself is a separate,
   pre-existing issue — explicitly noted here so it isn't mistaken for new fallout from this
   change, not fixed as part of it.
3. **Confirmed via source trace, narrative corrected**: `ThreadListStore`
   (`app/internal_packages/thread-list/lib/thread-list-store.ts`)'s
   `_onPerspectiveChanged` unconditionally calls `Actions.setFocus({collection: 'thread',
   item: null})` on every perspective change — so "stale focus after switching
   perspectives" does NOT happen via normal sidebar navigation. Test 4's actual reachable
   trigger is a direct cross-account `Actions.setFocus` call bypassing perspective-change
   machinery entirely (e.g. `chat-panel.tsx`, `sidebar-related-threads.tsx`,
   `unread-notifications/main.ts` all call `Actions.setFocus` directly with a thread that
   may belong to a different account than the current perspective). The guard in the fix
   itself is unchanged and still correct — only the test's scenario narrative needed
   correcting, which the "Testing" section above now reflects.
4. **Confirmed, no action needed**: first-launch/no-perspective case is already safe
   without any special-casing — `MailboxPerspective.forNothing()` (the empty starting
   state) has `accountIds: []`, so `perspectiveAccountIds.length > 1` is false and the new
   branch never engages.
5. **Confirmed correct**: scoping to blank/new-compose only is right — `createDraftForReply`/
   `createDraftForForward` both override `from`/`accountId` via `Object.assign(defaults,
   fields)` with `fields` applied second, so `_accountForNewDraft()`'s return value for
   those two paths only affects the auto-CC/BCC quirk in finding 2 above, not `from` itself.
