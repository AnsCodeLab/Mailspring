# Issue #14: In-app update (notify, changelog, one-click install) — Test Cases

## TC1 — Feed points at this fork's own GitHub Releases, not upstream

**Preconditions:** None.

**Steps:** Inspect `AutoUpdateManager.feedURL` after construction/`updateFeedURL()`.

**Expected result:** Always
`https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest`, regardless of
platform/arch/version/`identity.id`.

## TC2 — Version comparison is numeric, not lexicographic

**Preconditions:** None (pure function).

**Steps:** `compareVersions('1.9.0.20260101', '1.10.0.20260101')`.

**Expected result:** `-1` (1.9 < 1.10 numerically — a naive string compare would get this
backwards). Also covers equal versions, missing trailing segments, and non-numeric
garbage segments (default to 0, never throw).

## TC3 — Update-available detection uses the real GitHub tag, not a status-code contract

**Preconditions:** Mocked `fetch` returning a GitHub-Releases-shaped 200 response.

**Steps:** `checkForUpdates()` with a `tag_name` newer / equal / older than the running
app's version.

**Expected result:** `update-downloaded` (with real release notes) only when strictly
newer; `update-not-available` otherwise. A 404 (fresh fork, no release published yet)
is treated as "no update," not an error. A genuine non-200/404 failure emits `error`.

## TC4 — Real changelog surfaces in the notification, linked to the fork's own releases

**Preconditions:** Update available with a real `body`.

**Steps:** Observe `UpdateNotification`'s render output and its "View changelog" click
target.

**Expected result:** An inline, truncated (~200 char) preview of the actual release
body is shown. "View changelog" opens
`https://github.com/AnsCodeLab/Mailspring/releases/latest` — the fork's own page, not
`Foundry376/Mailspring`'s.

## TC5 — Linux one-click install: format detection and asset selection

**Preconditions:** Mocked `fs.existsSync` for `/usr/bin/dpkg`/`/usr/bin/rpm`.

**Steps:** `detectPackageFormat()` under each combination; `selectAssetForFormat()`
against the real published asset-name shapes
(`mailspring-<version>-amd64.deb`, `mailspring-<version>-0.1.x86_64.rpm`).

**Expected result:** Correct format detected (dpkg preferred when both present); asset
selection matches by suffix (resilient to the `-0.1.` build-number segment changing),
not a hardcoded filename. `null` format (e.g. AppImage-only distro) falls back to
opening the releases page in a browser.

## TC6 — Linux one-click install: install hand-off and pkexec fallback chain

**Preconditions:** Mocked `shell.openPath`, mocked `child_process.spawn`.

**Steps:** `installPackage()` when `shell.openPath` succeeds; when it fails on `.deb`;
when it fails on `.rpm` with `dnf` present / with `zypper` present (no `dnf`) / with
neither (`rpm -Uvh` fallback); when the `pkexec` fallback itself fails.

**Expected result:** `shell.openPath` tried first (GUI hand-off, one confirmation
click). On failure, the correct `pkexec` command per environment. A failure from every
path is surfaced (not swallowed) as an `error` event — no unhandled rejection, no silent
privileged command.

## TC7 — Windows one-click install: asset selection and single-instance-lock safety

**Preconditions:** Mocked `download-file.ts`, `electron.app.quit`/`app.once`,
`shell.openPath`.

**Steps:** `quitAndInstall()` on the Windows impl.

**Expected result:** The `.exe` asset is selected (not `.deb`/`.rpm`). The installer is
downloaded, then `app.quit()` is called and the installer is launched (`shell.openPath`)
only from a `will-quit` handler — never while the app is still holding
`requestSingleInstanceLock()` — reproducing the fix `windows-updater.js`'s own
`restartMailspring()` already established for the same race. A download failure falls
back to opening the releases page **without** calling `app.quit()`.

## TC8 — `supportsUpdates()` no longer depends on Squirrel's `Update.exe`

**Preconditions:** None.

**Steps:** `AutoupdateImplWin32.supportsUpdates()`.

**Expected result:** Always `true` — no longer gated on `WindowsUpdater.existsSync()`,
since the new flow doesn't use `Update.exe` at all.

## TC9 — macOS stays disabled (no regression to #18's protection)

**Preconditions:** `process.platform` stubbed to `'darwin'`.

**Steps:** `AutoUpdateManager.setupAutoUpdater()`.

**Expected result:** State becomes `'unsupported'` immediately; no platform impl is
constructed; the old Squirrel.Mac `autoUpdater` path (incompatible with the new
GitHub-Releases feed shape) is never reached. This is this issue's own regression guard
for the plan-review-required darwin gate.

## TC10 — Linux/Windows actually proceed past the guard (the #18 disable is lifted for them)

**Preconditions:** `process.platform` stubbed to `'linux'` / `'win32'`.

**Steps:** `AutoUpdateManager.setupAutoUpdater()`.

**Expected result:** A real platform impl is constructed and the initial check proceeds
— state does NOT immediately become `'unsupported'` the way #18's blanket guard made it
for every platform.

## TC11 — No regression to `application:check-for-update`/`install-update` IPC handlers

**Preconditions:** None (structural).

**Steps:** Read `application.ts`'s two handlers.

**Expected result:** Both untouched; `install()` → `quitAndInstall()` becoming
asynchronous under the new design is compatible with the existing fire-and-forget call
style without any change needed.

## TC12 — Live GitHub API shape matches implementation assumptions

**Preconditions:** Real network access.

**Steps:** `GET https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest`
with a `User-Agent` header.

**Expected result:** `200`, `tag_name`/`body`/`assets[].name`/`assets[].browser_download_url`
present and shaped exactly as `manuallyQueryUpdateServer`/`selectAsset` assume. A request
against a nonexistent repo returns `404`, exercising TC3's "no release yet" path against
real GitHub behavior.
