# Issue #18: Disable fork auto-updater — Test Cases

## TC1 — Startup makes no request to upstream's update feed

**Preconditions:** Fresh app boot (dev or test mode), no SNAP env, any platform.

**Steps:**
1. Launch the app (or, for automated coverage, construct `AutoUpdateManager` and let the deferred `setupAutoUpdater()` run, or call it directly).

**Expected result:** No HTTP request is made to `updates.getmailspring.com` (or any `*.getmailspring.com` host). `AutoUpdateManager.getState()` reads `'unsupported'` immediately, synchronously, without ever transitioning through `'checking'`.

## TC2 — "Check for Updates" / "Restart and Install Update" menu items never appear

**Preconditions:** App running with the fix applied.

**Steps:**
1. Open the application menu (macOS) or window menu (Windows/Linux).

**Expected result:** Neither "Check for Updates" nor "Restart and Install Update" nor "Downloading Update" is visible — `ApplicationMenu.updateAutoupdateMenuItem('unsupported')` routes to the existing `default:` branch, which leaves all three items hidden (same code path already exercised by Snap builds today; unchanged by this fix).

## TC3 — In-app update notification never renders

**Preconditions:** App running with the fix applied.

**Steps:**
1. Observe the notification area during and after startup.

**Expected result:** `UpdateNotification` never renders (`getStateFromStores()` reads `updater.getState() === 'update-available'`, which can never become true since state is pinned to `'unsupported'` at the first and only `setupAutoUpdater()` call).

## TC4 — Manually invoking `application:check-for-update` does not throw

**Preconditions:** App running with the fix applied; `autoUpdater` module-level var is `null` (never constructed).

**Steps:**
1. Fire the `application:check-for-update` IPC command directly (bypassing the hidden menu item), e.g. via `Actions`/IPC in devtools, or unit-test equivalent: call `AutoUpdateManager.check()` directly after `setupAutoUpdater()` has run.

**Expected result:** No `TypeError`. A `console.error('AutoUpdateManager.check called with no autoUpdater configured.')` is logged instead, and the call returns cleanly.

## TC5 — Manually invoking `application:install-update` does not throw

**Preconditions:** Same as TC4.

**Steps:**
1. Fire the `application:install-update` IPC command directly, or call `AutoUpdateManager.install()` directly after `setupAutoUpdater()` has run.

**Expected result:** No `TypeError`, no `shell.openExternal(...)` side effect. A `console.error('AutoUpdateManager.install called with no autoUpdater configured.')` is logged instead.

## TC6 — No regression to `updateFeedURL()` / existing feed-URL tests

**Preconditions:** None.

**Steps:**
1. Run the 4 pre-existing `autoupdate-manager-spec.ts` cases (feed URL construction with/without commit suffix, with/without a saved identity id).

**Expected result:** All 4 continue to pass unchanged — `updateFeedURL()` itself is untouched by this fix; only `setupAutoUpdater()`, `check()`, and `install()` changed.

## TC7 — No regression to existing Snap-build / Windows-missing-Squirrel `supportsUpdates()` behavior

**Preconditions:** N/A (structural — the old `autoUpdater.supportsUpdates()` per-impl kill-switch is now unreachable code, since `setupAutoUpdater()` returns before any platform impl is ever constructed).

**Expected result:** No platform impl (`AutoupdateImplBase`, `AutoupdateImplWin32`, Electron's built-in `autoUpdater`) is ever instantiated in this build, so their own `supportsUpdates()` logic is moot — confirmed by reading the fixed `setupAutoUpdater()`, which returns before the `require(...)` calls that used to construct them.
