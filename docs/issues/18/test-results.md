# Issue #18: Disable fork auto-updater — Test Results

## Automated: `app/spec/autoupdate-manager-spec.ts`

Executed for real by the implementor subagent via the project's actual Electron test
harness under Xvfb (not a manual trace):

```
xvfb-run -a node_modules/.bin/electron ./app --enable-logging \
  --test --spec-file-pattern=autoupdate-manager-spec.ts --disable-gpu --no-sandbox
```

### Red run (before the fix, against the unmodified `autoupdate-manager.ts`)

6 passing, 1 failing.

- New `setupAutoUpdater` test **FAILED for the right reason**:
  `Expected 'idle' to equal 'unsupported'.` and
  `Expected spy check not to have been called.` — pre-fix, `setupAutoUpdater()` ran
  straight through full platform construction and reached the real `this.check(...)`
  call instead of short-circuiting.
- The two `check`/`install` no-throw tests trivially passed even pre-fix on this
  platform (linux, no `SNAP` env) because a real, working platform updater is
  successfully constructed before those methods are called — there's no pre-fix path
  where `autoUpdater` is null after `setupAutoUpdater` has run. The `setupAutoUpdater`
  test is the true red/green discriminator for the underlying bug.
- **Directly observed, concrete evidence of the bug itself during this pre-fix run:**
  - `Manual update check (updates.getmailspring.com/check/linux/x64/1.24.0.20260904-COMMIT_INSERTED_DURING_PACKAGING/anonymous/stable) returned 200`
    — a real HTTP request fired against upstream's production update server during
    app boot in test mode (this is exactly the collision #17/#18 describe).
  - `Opening in existing browser session.` — the pre-fix `install()` call reached
    `AutoupdateImplBase.quitAndInstall()` → `shell.openExternal(...)`, actually opening
    a browser tab.

### Green run (after the fix)

7 passing, 0 failing.

- All 4 pre-existing feed-URL tests (TC6) still pass unchanged.
- All 3 new tests (TC1/TC4/TC5's unit-level equivalents) pass: state becomes
  `'unsupported'` synchronously and `m.check` is never invoked; `check()`/`install()`
  log a `console.error` and return cleanly instead of throwing.
- **Critically, this run's log contains no `Manual update check ... returned 200`
  line** — no HTTP request fired against `updates.getmailspring.com` during boot
  (TC1, directly confirmed against the real production `Application` boot path, not
  just the isolated unit under test) — **and no `Opening in existing browser session`
  line** (TC5, no `shell.openExternal` side effect).
- Two expected `console.error` lines appear instead, confirming the new guard
  branches are genuinely exercised with a real (not mocked) null `autoUpdater`:
  `AutoUpdateManager.check called with no autoUpdater configured.` and
  `AutoUpdateManager.install called with no autoUpdater configured.`

## Manual/structural verification

| Test case | Result | Evidence |
|---|---|---|
| TC1 — no startup request to update feed | PASS | Green-run log has no `updates.getmailspring.com` request line (see above) |
| TC2 — update menu items never appear | PASS (structural) | Read `application-menu.ts:191-205`: `updateAutoupdateMenuItem()`'s switch already routes every state other than `idle/error/no-update-available/checking/downloading/update-available` — including `unsupported` — to a no-op `default:`, leaving all three items hidden. Unchanged by this fix; same code path already exercised by Snap builds. |
| TC3 — update notification never renders | PASS (structural) | Read `update-notification.tsx:35-44`: `getStateFromStores()` only sets `updateAvailable: true` when `getState() === 'update-available'`, unreachable once `setupAutoUpdater()` pins state to `'unsupported'`. |
| TC4 — `check()` no-throw | PASS | Green-run: `console.error('AutoUpdateManager.check called with no autoUpdater configured.')` logged, no throw |
| TC5 — `install()` no-throw | PASS | Green-run: `console.error('AutoUpdateManager.install called with no autoUpdater configured.')` logged, no throw, no `shell.openExternal` |
| TC6 — no feed-URL regression | PASS | 4/4 pre-existing tests unchanged and passing in both red and green runs |
| TC7 — no Snap/Squirrel regression | PASS (structural) | `setupAutoUpdater()` now returns before any `require('./autoupdate-impl-*')` call — those modules' own `supportsUpdates()` are never reached, made moot rather than broken |

## Verification not yet run (orchestrator to complete before push)

- `npm run lint` (repo-wide)
- `npm run tsc-watch` (single pass)
- Independent code review gate
