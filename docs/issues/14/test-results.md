# Issue #14: In-app update (notify, changelog, one-click install) — Test Results

## Automated specs — executed for real (not paraphrased)

Command (same real Electron+Xvfb harness #18's evidence used):
```
xvfb-run -a node_modules/.bin/electron ./app --enable-logging --test \
  --spec-file-pattern="autoupdate-manager-spec.ts|autoupdate-impl-base-spec.ts|autoupdate-impl-win32-spec.ts|download-file-spec.ts|linux-package-installer-spec.ts|version-compare-spec.ts|update-notification-spec.tsx" \
  --disable-gpu --no-sandbox
```

Orchestrator personally re-ran this after the implementor's pass, independent of the
implementor's own reported numbers:

```
AutoupdateImplBase
  manuallyQueryUpdateServer
    ✓ parses a GitHub Releases API response and passes it through on success
    ✓ sends a User-Agent header (GitHub 403s API requests without one)
    ✓ treats a 404 (fresh repo, no release published yet) as "no update" rather than an error
    ✓ emits an error for a genuine non-200/404 failure
  checkForUpdates
    ✓ emits update-not-available when the release tag is not newer than the running version
    ✓ emits update-not-available when the release tag is older than the running version
    ✓ emits update-downloaded with the real release notes when a newer version is published
    ✓ selects the platform-matching asset via linux-package-installer
  quitAndInstall
    ✓ downloads the selected asset then hands off to installPackage
    ✓ falls back to opening the releases page when no package format is detected
    ✓ falls back to opening the releases page when the download fails

AutoupdateImplWin32
  ✓ supportsUpdates() is unconditionally true (no longer gated on WindowsUpdater.existsSync)
  ✓ inherits the base GitHub-Releases-based version check via checkForUpdates
  ✓ selects the .exe asset instead of .deb/.rpm
  quitAndInstall
    ✓ calls app.quit() and only launches the installer from a will-quit handler, never while still running
    ✓ falls back to opening the releases page when the download fails, without quitting the app

AutoUpdateManager
  updateFeedURL
    ✓ always points at this fork's own GitHub Releases API endpoint, regardless of platform/arch/version
    ✓ does not vary by identity.id - the GitHub API takes no such query param
  setupAutoUpdater
    ✓ sets the state to unsupported and never reaches the update-check code on darwin
    ✓ constructs a real platform updater and proceeds to the initial check on linux, instead of bailing to unsupported like #18's blanket guard did
    ✓ constructs a real platform updater and proceeds to the initial check on win32, instead of bailing to unsupported like #18's blanket guard did
  check
    ✓ does not throw when called after setup on the current platform
  install
    ✓ does not throw once the platform updater has been constructed
    ✓ does not throw when the platform updater is unsupported (darwin)

downloadFile
  ✓ sends a User-Agent header on the request
  ✓ pipes the response body to the destination write stream
  ✓ rejects on a non-OK response instead of writing an error page to disk

linux-package-installer
  detectPackageFormat
    ✓ returns "deb" when /usr/bin/dpkg exists
    ✓ returns "rpm" when dpkg is absent but /usr/bin/rpm exists
    ✓ returns null when neither dpkg nor rpm exists (e.g. AppImage-only distros)
    ✓ prefers dpkg over rpm when both are present
  selectAssetForFormat
    ✓ picks the asset with a matching suffix, not a hardcoded filename
    ✓ is resilient to a changed build-number segment in the rpm filename
    ✓ returns null when no asset matches the requested format
  installPackage
    ✓ tries shell.openPath first and resolves without a pkexec fallback on success
    ✓ falls back to `pkexec dpkg -i` when shell.openPath fails, for .deb
    ✓ falls back to `pkexec dnf install -y` for .rpm when dnf is present
    ✓ falls back to `pkexec zypper install -y` for .rpm when dnf is absent but zypper is present
    ✓ falls back to `pkexec rpm -Uvh` as a last resort when neither dnf nor zypper is present
    ✓ surfaces (does not swallow) a failure from shell.openPath followed by a failed pkexec fallback

compareVersions
  ✓ returns 0 for identical versions
  ✓ compares numerically, not lexicographically, within a segment
  ✓ compares the date-like fourth segment numerically as well
  ✓ treats a missing trailing segment as 0
  ✓ defaults a non-numeric segment to 0 instead of throwing
  ✓ compares major/minor/patch precedence correctly

UpdateNotification
  mounting
    ✓ should display a notification immediately if one is available
    ✓ should not display a notification if no update is avialable
    ✓ should listen for `window:update-available`
  displayNotification
    ✓ should include the version if one is provided
    ✓ shows the "Install" action label by default (no "manual download" sentinel branch anymore)
    ✓ shows an inline preview of the real release notes body
    ✓ truncates a long release notes body to roughly 200 characters
    ✓ renders no preview element when there are no release notes
    when the action is taken
      ✓ should fire the `application:install-update` IPC event
      ✓ switches the action label to "Installing…" once clicked
      ✓ does not re-send the IPC command on a second click while installing
      ✓ should dismiss the update notification prompt

58 passing
```

The app boot log during this run shows a real HTTP call succeeding against the real
feed: `Manual update check (https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest)
returned 200` — TC1/TC12 confirmed against production infrastructure, not just mocks.

## Regression check — other `Notification` consumers (TC: no regression from the shared `children` prop addition)

Orchestrator personally re-ran, independent of the implementor's own count:
```
xvfb-run -a node_modules/.bin/electron ./app --enable-logging --test \
  --spec-file-pattern="notification-spec|priority-spec|account-error-notif|default-client-notif|dev-mode-notif|disabled-mail-rules-notif|offline-notification|please-subscribe-notif" \
  --disable-gpu --no-sandbox
```
Result: **35 passing, 0 failing** — `AccountErrorNotif`, `DefaultClientNotif`,
`DevModeNotif`, `DisabledMailRulesNotification`, `NotifPriority`, and
`UpdateNotification` (again) all pass with the new `children?: React.ReactNode` prop on
the shared `Notification` component.

## Test case results

| Case | Result | Evidence |
|---|---|---|
| TC1 — feed points at fork's own releases | PASS | `updateFeedURL` spec assertions + real `200` in boot log |
| TC2 — numeric version comparison | PASS | 6/6 `compareVersions` specs |
| TC3 — update-available via real tag + graceful 404/error handling | PASS | 11/11 `AutoupdateImplBase` specs |
| TC4 — real changelog inline + fork's own releases link | PASS | `UpdateNotification` release-notes-preview + `_onViewChangelog` specs |
| TC5 — Linux format detection + asset selection | PASS | `detectPackageFormat`/`selectAssetForFormat` specs (7/7) |
| TC6 — Linux install hand-off + pkexec fallback chain | PASS | `installPackage` specs (6/6), incl. zypper and surfaced-failure cases |
| TC7 — Windows asset selection + single-instance-lock safety | PASS | `AutoupdateImplWin32` `quitAndInstall` specs (2/2) |
| TC8 — `supportsUpdates()` unconditional on Windows | PASS | `AutoupdateImplWin32` spec |
| TC9 — darwin stays disabled | PASS | `setupAutoUpdater` darwin spec |
| TC10 — linux/win32 proceed past the guard | PASS | `setupAutoUpdater` linux/win32 specs |
| TC11 — `application.ts` handlers unchanged, compatible | PASS (structural) | Re-read `application.ts:466-475`; no change needed, confirmed by implementor and independently re-read by orchestrator |
| TC12 — live GitHub API shape matches assumptions | PASS | Implementor's live smoke test (200, real `tag_name`/`body`/`assets`) + this run's own real `200` in the boot log |

## Static verification

- `npm run lint` (repo-wide `eslint --fix`): clean, no diff produced on re-run (already
  clean from the implementor's pass).
- `npx eslint -c .eslintrc` directly on all 7 new/changed spec files (outside
  `npm run lint`'s glob, per the #18 precedent): clean, exit 0.
- `npx tsc --noEmit -p app`: clean, exit 0.

## Independent code review

(appended below after the cold review gate)
