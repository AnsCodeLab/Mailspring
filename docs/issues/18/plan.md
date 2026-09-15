# Issue #18: Disable fork auto-updater — Plan (split from #17)

## Problem

`AutoUpdateManager.updateFeedURL()` (`app/src/browser/autoupdate-manager.ts:44-71`)
unconditionally builds the update-check feed against `updates.getmailspring.com`
(upstream Foundry376/Mailspring's real production update server), embedding this
fork's own `MAJOR.MINOR.PATCH.YYYYMMDD` version string in the request.

Per @bengotow (upstream maintainer, issue body): that date-suffixed version format was
causing the feed check to fail server-side (`Manual update check (...) returned 500`,
also independently observed and logged during this fork's own work on #14). Upstream
fixed their backend's auto-update routes today, which means the feed check may soon
start *succeeding* and returning a genuine "update available" response — pointing at a
real upstream Mailspring release. If that happens, `AutoUpdateManager` would offer this
fork's users an "Install"/"Download Now" action that silently replaces their AI-enabled
fork build with vanilla upstream Mailspring, dropping every fork-specific feature with
no warning that anything different happened.

This is the same root cause already diagnosed as item 1 of #14 ("no update notification
can ever fire today... "). #14 is the full fix (point the feed at this fork's own
GitHub Releases, real changelog, one-click Linux install) — a materially larger, still
open, still-undesigned piece of work. #17's own text is narrower and time-sensitive:

> "It may make sense to disable the auto-updater in this fork so users don't get pushed
> back to standard Mailspring releases." — #17

## Scope for this issue

Disable the auto-update *check* entirely, fork-wide, right now — independent of and
strictly smaller than #14. Once #14 lands (feed pointed at
`AnsCodeLab/Mailspring` releases), this disable is trivially reverted by deleting the
guard added here; #14's implementor should do that as part of its own change, not this
one.

Explicitly **not** in scope here (deferred to #14):
- Pointing the feed at this fork's own release infrastructure.
- Real changelog / release-notes surfacing.
- Any in-app Linux install path.

## Root cause / call graph

- `AutoUpdateManager` constructor (`autoupdate-manager.ts:30-42`) schedules
  `setupAutoUpdater()` via `setTimeout(..., 0)`.
- `setupAutoUpdater()` (`autoupdate-manager.ts:73-133`) today: constructs the
  platform-specific updater impl (win32 native / linux `AutoupdateImplBase` / darwin
  Electron built-in `autoUpdater`), wires `setFeedURL`, wires all event listeners, then
  runs a startup check (`this.check({ hidePopups: true })`) and schedules a 30-minute
  polling `setInterval`. The only existing kill-switch
  (`autoUpdater.supportsUpdates && !autoUpdater.supportsUpdates()`, line 114) is
  per-impl and runs *after* the platform impl is already constructed and wired: today
  it only returns `false` for Snapcraft builds on Linux
  (`AutoupdateImplBase.supportsUpdates()`) or when Squirrel isn't installed on Windows
  (`AutoupdateImplWin32.supportsUpdates()` → `WindowsUpdater.existsSync()`) — neither
  condition covers the general case this issue needs to disable.
- `check()` (line 165) and `install()` (line 174) both assume a live `autoUpdater`
  instance and call straight into it (`autoUpdater.checkForUpdates()` /
  `autoUpdater.quitAndInstall()`).
- UI reachability of `check()`/`install()`: both are wired from
  `app/src/browser/application.ts`'s `application:check-for-update` /
  `application:install-update` IPC command handlers. Those commands are only fired from
  (a) the "Check for Updates"/"Restart and Install Update" menu items
  (`menus/darwin.js`, `menus/win32.js`), whose visibility is exclusively controlled by
  `ApplicationMenu.updateAutoupdateMenuItem()` — every state other than
  `idle`/`error`/`no-update-available`/`checking`/`downloading`/`update-available` (i.e.
  including `unsupported`, the existing Snap/no-Squirrel state) falls through to `default:`
  and leaves every update menu item hidden — and (b)
  `update-notification.tsx`'s `_onUpdate`, which only renders at all when
  `updater.getState() === 'update-available'`. Neither path is reachable if the manager
  never leaves its initial `idle` state.

## Fix

Single choke point in `AutoUpdateManager`, ahead of the platform-specific branching, so
it covers win32/linux/darwin uniformly with one change instead of three:

1. In `setupAutoUpdater()`, before constructing any platform impl: set state to the
   existing `unsupported` state (same terminal state already used for Snap builds — no
   new UI state to teach the menu/notification code) and return immediately. Leave a
   comment explaining why, referencing both #18 and #14 so a future reader (implementing
   #14) knows this guard is the thing to remove.
2. Defensively guard `check()` and `install()` against a null `autoUpdater` (log and
   no-op) rather than relying solely on "the menu item happens to be hidden today" to
   prevent a `TypeError`. This is a one-line-each addition directly required by
   disabling `setupAutoUpdater` cleanly — not scope creep — since the module-level
   `autoUpdater` variable will now permanently stay `null` in this build.
3. No new config option, no fork-detection heuristic, no env var. Per `CONTRIBUTING.md`
   ("we're extremely wary of adding options and preferences for niche behaviors"), an
   unconditional disable matches the issue's literal ask and avoids inventing a
   conditional that only ever evaluates one way until #14 replaces the whole mechanism.

## Files touched

- `app/src/browser/autoupdate-manager.ts` — the guard.
- `app/spec/autoupdate-manager-spec.ts` — new tests (existing tests already spy past
  `setupAutoUpdater`, so they're unaffected by this change; confirmed by reading the
  file).

## Test plan (red → green)

New spec cases in `app/spec/autoupdate-manager-spec.ts`:
- `setupAutoUpdater()` sets state to `'unsupported'` and never touches
  `checkForUpdates`/schedules an interval (assert via a spy that would fail today
  because `setupAutoUpdater` currently reaches the platform-construction/interval code
  first).
- `check()` and `install()` do not throw when called after `setupAutoUpdater()` has run
  (i.e. `autoUpdater` is `null`).

These fail today (before the guard exists, `setupAutoUpdater()` will throw or hang
attempting a real network call / `setInterval`, or `check()`/`install()` throw
`TypeError: Cannot read properties of null`) and pass once the guard is added.

## Open questions

None — this is a straightforward, literal implementation of the issue's own suggested
fix, scoped narrower than #14 by design.

## Plan review verdict

**Verdict: APPROVE WITH CHANGES**

Independently verified against the current tree (`autoupdate-manager.ts`, `application.ts`,
`application-menu.ts`, `update-notification.tsx`, `autoupdate-impl-base.ts`,
`autoupdate-impl-win32.ts`, `menus/darwin.js`/`win32.js`/`linux.js`, both spec files, issue
#18/#17 bodies, `CONTRIBUTING.md`). Findings below.

### Module boundary — correct
Grepped every reference to `autoUpdateManager`/`AutoUpdateManager` repo-wide: the only
consumers are `application.ts` (construct + two IPC handlers), `application-menu.ts` (state
switch), and `update-notification.tsx` (reads `getState()`/`getReleaseDetails()`). None of
them need to change — `application-menu.ts`'s switch already has a `default:` fallthrough
that leaves every update menu item hidden for `unsupported`, and
`update-notification.tsx` only renders when state is exactly `'update-available'`. A single
guard inside `autoupdate-manager.ts` is the right and complete boundary; touching the menu
or notification files would be unnecessary scope expansion. Confirmed `linux.js` has no
update menu entries at all (only darwin/win32 do), so the notification-bar path is the only
one Linux ever had — the plan's single choke point still covers it.

### No unintended surface touched
Files touched are exactly `autoupdate-manager.ts` + its spec, matching the issue's own
"Suggested fix" text almost verbatim (this is the issue author's prescribed approach, not
the planner inventing scope). Nothing in `application.ts`'s `quitting`/`cleanupBeforeAppQuit`
pre-install side effects is touched — correctly out of scope, since that logic isn't new and
the null-guard's job is only "don't throw," which is what the issue's acceptance criteria ask.

### Simpler path considered and correctly rejected
A smaller-looking alternative — just skip scheduling `setupAutoUpdater()` from the
constructor instead of guarding inside it — was checked and is actually *wrong*: it would
leave `state` at `'idle'` forever, which the `application-menu.ts` switch maps to
`checkForUpdateItem.visible = true`, re-exposing a "Check for Updates" menu item wired to a
`check()` that would throw on the null `autoUpdater`. The plan's chosen placement (explicit
`setState(UnsupportedState)` + return, inside `setupAutoUpdater`) is the minimal correct fix,
not just the minimal-looking one.

### Verified correctness of state reuse
Grepped all uses of the `'unsupported'` state string — only `application-menu.ts`'s switch
and the manager's own 30-min-interval skip check reference it, both already handled
correctly for the reused state. No hidden consumer needs a new/distinct state.

### Required change (fix before merging the plan)
"Root cause / call graph" overstates the existing kill-switch: `AutoupdateImplBase.
supportsUpdates()` returns `false` only for Snapcraft builds, but
`AutoupdateImplWin32.supportsUpdates()` *overrides* it and returns
`WindowsUpdater.existsSync()` — i.e. it already returns `false` on Windows machines without
Squirrel installed, not just "Snapcraft builds." This doesn't change the fix (the new guard
preempts this branch on every platform regardless), but the plan's narrative should say
"per-impl, e.g. Snap on Linux or missing Squirrel on Windows" rather than implying Snap is
the only case — a future reader relying on this doc to understand the old kill-switch would
be misled.

### Non-blocking observations
- Existing spec's third test (`'when an update identity is already set'`, line 49-60) is the
  only one of the four that does **not** `spyOn(m, 'setupAutoUpdater')` before the
  constructor's `setTimeout(..., 0)` fires — today that means a real `setupAutoUpdater()`
  (real network call + 30-minute `setInterval`) actually fires asynchronously after that
  test's synchronous assertions complete, leaking into the rest of the suite. This plan's fix
  incidentally neutralizes that leak (post-fix, that same call becomes a no-op state
  transition). Worth a one-line callout in the PR description as a bonus side-effect, not a
  new test to write — not this issue's job to fix pre-existing spec hygiene, but good to flag
  so reviewers don't mistake the now-silent interval/network call for something the fix broke.
- "Log and no-op" for `check()`/`install()` doesn't specify `console.warn` vs `console.error`;
  match the existing `console.error` convention already used in `setupAutoUpdater`'s `error`
  listener for consistency. Implementer discretion, not blocking.
- Confirmed the acceptance criterion "no HTTP request to `updates.getmailspring.com`" is
  satisfied structurally (the guard returns before any platform impl — the only thing capable
  of making that request — is ever constructed), even though the described test plan
  verifies it indirectly (via the `checkForUpdates`/`setInterval` spy) rather than with a
  network-call assertion; that's an acceptable and appropriately-scoped unit-test substitute
  for an integration-level network check.

### Risk assessment
Low risk, single-file blast radius, reversible-by-deletion as designed for #14, no new
config surface, no cross-platform divergence. No missed edge case found that would cause a
throw, a hang, or a leaked update prompt.
