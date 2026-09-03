# Issue #11 — Test Results

Environment: this sandbox requires `xvfb-run -a` in front of Electron (no real display).
Command used to scope the run to this spec file only:

```
xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test -f "draft-factory-spec"
```

## 1. RED — before the fix (spec written first, `_accountForNewDraft()` unmodified)

Same command, run against the repo with the new `describe('_accountForNewDraft', ...)` block
already added to `app/spec/stores/draft-factory-spec.ts` but `_accountForNewDraft()` in
`app/src/flux/stores/draft-factory.ts` still the original (buggy) implementation.

Result: **63 passing, 2 failing** — exactly the two scenarios that require the fix (focused
thread's account should win in a multi-account perspective); the other 3 new scenarios
(single-account ignores focus, multi-account-no-focus fallback, stale-account fallback,
pinned-preference-wins) already passed because the old code happens to coincide with them
(it never even looks at `FocusedContentStore`).

```
    _accountForNewDraft
      ✓ uses the perspective account when the perspective is single-account, ignoring any focused thread from another account
      ✓ falls back to the perspective's first account when the perspective is multi-account and no thread is focused
      ✗ prefers the focused thread account over the perspective order when the perspective is multi-account
      ✗ prefers the focused thread account regardless of account ordering in the perspective (mirror case)
      ✓ falls back to the perspective's first account, without throwing, when the focused thread's account is not in the perspective
      ✓ always uses the pinned core.sending.defaultAccountIdForSend account, regardless of perspective or focused thread


  63 passing
  2 failing

  1) DraftFactory _accountForNewDraft prefers the focused thread account over the perspective order when the perspective is multi-account.
     Expected 'test-account-server-id' to equal 'second-test-account-id'.
     at app/spec/stores/draft-factory-spec.ts:843:37

     Expected 'tester@mailspring.com' to equal 'second@gmail.com'.
     at app/spec/stores/draft-factory-spec.ts:844:41

  2) DraftFactory _accountForNewDraft prefers the focused thread account regardless of account ordering in the perspective (mirror case).
     Expected 'second-test-account-id' to equal 'test-account-server-id'.
     at app/spec/stores/draft-factory-spec.ts:850:37

     Expected 'second@gmail.com' to equal 'tester@mailspring.com'.
     at app/spec/stores/draft-factory-spec.ts:851:41

Wall time: 6.14 seconds
```

This confirms the failures were for the right reason: the old `_accountForNewDraft()` never
consulted `FocusedContentStore`, so it always fell through to `accountIds[0]` regardless of
which thread was focused — the exact bug reported in the issue.

## 2. GREEN — after the fix (`_accountForNewDraft()` updated per plan's "Fix" section)

Full captured output (Electron/Wayland/GPU startup noise omitted; test tree shown in full):

```
  DraftFactory
    creating drafts
      createDraftForReply
        ✓ should include a quoted text block
        ✓ should address the message to the previous message's sender
        ✓ should set the replyToHeaderMessageId to the previous message's ids
        ✓ should set the accountId and from address based on the message
        when the email is TO an alias
          ✓ should use the alias as the from address
        when the email is CC'd to an alias
          ✓ should use the alias as the from address
        ✓ should make the subject the subject of the message, not the thread
        ✓ should change the subject from Fwd: back to Re: if necessary
      type: reply
        when the message provided as context has one or more 'ReplyTo' recipients
          ✓ addresses the draft to all of the message's 'ReplyTo' recipients
          ✓ addresses the draft to all of the message's 'ReplyTo' recipients, even if the message is 'From' you
        when the message provided as context was sent by the current user
          ✓ addresses the draft to all of the last messages's 'To' recipients
      type: reply-all
        ✓ should include people in the cc field
        ✓ should not include people who were bcc'd on the previous message
        ✓ should not include you when you were cc'd on the previous message
        when the message provided as context has one or more 'ReplyTo' recipients
          ✓ addresses the draft to all of the message's 'ReplyTo' recipients
          ✓ addresses the draft to all of the message's 'ReplyTo' recipients, even if the message is 'From' you
          ✓ should not include the message's 'From' recipient in any field
        when the message provided has one or more 'ReplyTo' recipients and duplicates in the To/Cc fields
          ✓ should unique the to/cc fields
        when the message provided as context was sent by the current user
          ✓ addresses the draft to all of the last messages's recipients
      onComposeForward
        ✓ should include forwarded message text, in a div rather than a blockquote
        ✓ should not mention BCC'd recipients in the forwarded message header
        ✓ should not address the message to anyone
        ✓ should not set the replyToHeaderMessageId
        ✓ should sanitize the HTML
        ✓ should include the attached files as files
        ✓ should make the subject the subject of the message, not the thread
        ✓ should change the subject from Re: back to Fwd: if necessary
    createOrUpdateDraftForReply
      ✓ should throw an exception unless you provide `reply` or `reply-all`
      when there is already a draft in reply to the same message the thread
        when reply-all is passed
          ✓ should add missing participants
          ✓ should not blow away other participants who have been added to the draft
        when reply is passed
          ✓ should remove participants present in the reply-all participant set and not in the reply set
          ✓ should not blow away other participants who have been added to the draft
      when there is not an existing draft at the bottom of the thread
        ✓ should call through to createDraftForReply
    _fromContactForReply
      ✓ should work correctly in a range of test cases
    createDraftForMailto
      parameters in the URL
        ✓ works for lowercase
        ✓ works for title case
        ✓ works for uppercase
        ✓ rejects gracefully on super mangled mailto link: mailto
        ✓ rejects gracefully on super mangled mailto link: mail
        ✓ rejects gracefully on super mangled mailto link:
      should correctly instantiate drafts for a wide range of mailto URLs
        ✓ works for mailto:
        ✓ works for mailto://bengotow@gmail.com
        ✓ works for mailto:bengotow@gmail.com
        ✓ works for mailto:mg%40mailspring.com
        ✓ works for mailto:?subject=%1z2a
        ✓ works for mailto:?subject=%52z2a
        ✓ works for mailto:?subject=Martha Stewart
        ✓ works for mailto:?subject=Martha Stewart&cc=cc@mailspring.com
        ✓ works for mailto:?subject=Martha Stewart&cc=cc@mailspring.com;bengotow@gmail.com
        ✓ works for mailto:bengotow@gmail.com&subject=Martha Stewart&cc=cc@mailspring.com
        ✓ works for mailto:bengotow@gmail.com?subject=Martha%20Stewart&cc=cc@mailspring.com&bcc=bcc@mailspring.com
        ✓ works for mailto:bengotow@gmail.com?subject=Martha%20Stewart&cc=cc@mailspring.com&bcc=Ben <bcc@mailspring.com>
        ✓ works for mailto:bengotow@gmail.com?subject=Martha%20Stewart&cc=cc@mailspring.com&bcc=Ben <bcc@mailspring.com>;Shawn <shawn@mailspring.com>
        ✓ works for mailto:Ben Gotow <bengotow@gmail.com>,Shawn <shawn@mailspring.com>?subject=Yes this is really valid
        ✓ works for mailto:Ben%20Gotow%20<bengotow@gmail.com>,Shawn%20<shawn@mailspring.com>?subject=Yes%20this%20is%20really%20valid
        ✓ works for mailto:Reply <d+AORGpRdj0KXKUPBE1LoI0a30F10Ahj3wu3olS-aDk5_7K5Wu6WqqqG8t1HxxhlZ4KEEw3WmrSdtobgUq57SkwsYAH6tG57IrNqcQR0K6XaqLM2nGNZ22D2k@docs.google.com>?subject=Nilas%20Message%20to%20Customers
        ✓ works for mailto:email@address.com?&subject=test&body=type%20your%0Amessage%20here
        ✓ works for mailto:?body=type%20your%0D%0Amessage%0D%0Ahere
        ✓ works for mailto:?subject=Issues%20%C2%B7%20atom/electron%20%C2%B7%20GitHub&body=https://github.com/atom/electron/issues?utf8=&q=is%253Aissue+is%253Aopen+123%0A%0A
    _accountForNewDraft
      ✓ uses the perspective account when the perspective is single-account, ignoring any focused thread from another account
      ✓ falls back to the perspective's first account when the perspective is multi-account and no thread is focused
      ✓ prefers the focused thread account over the perspective order when the perspective is multi-account
      ✓ prefers the focused thread account regardless of account ordering in the perspective (mirror case)
      ✓ falls back to the perspective's first account, without throwing, when the focused thread's account is not in the perspective
      ✓ always uses the pinned core.sending.defaultAccountIdForSend account, regardless of perspective or focused thread


  65 passing

Wall time: 5.91 seconds
```

**65 passing, 0 failing.** This is the full `draft-factory-spec.ts` file: the 60 pre-existing
tests (`creating drafts` × 33, `createOrUpdateDraftForReply` × 6, `_fromContactForReply` × 1,
`createDraftForMailto` × 20) plus the 6 new `_accountForNewDraft` tests (5 scenarios from the
plan, with scenario 3 split into a base case + an order-independence mirror case) — zero
regressions, all new scenarios green.

Process exit code: `0`.

## 3. ESLint

```
npx eslint -c .eslintrc "app/src/flux/stores/draft-factory.ts" "app/spec/stores/draft-factory-spec.ts"
```

Result: no output, exit code `0` — no lint errors or warnings in either modified file.

## 4. Not run (per assignment scope)

- Full `npm test` suite (project-wide) — left to the orchestrator's final full-repo verification pass.
- `npm run typecheck` / repo-wide `tsc` — left to the orchestrator.
- Playwright e2e suite — not executable in this sandbox for this issue; see plan.md's
  "Interactive / build verification" section for the confirmed root cause (macOS-only
  hardcoded `FIXTURE_DIR` fixture path in `playwright/helpers.ts`).
