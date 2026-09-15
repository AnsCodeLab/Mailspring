# Issue #14: In-app update — notify, real changelog, one-click install — Plan

## Problem (restated from the issue, verified against current code)

`AutoUpdateManager` (`app/src/browser/autoupdate-manager.ts`) points its feed at
upstream Foundry376/Mailspring's own production update server
(`updates.getmailspring.com`) and has zero knowledge of this fork's own
`AnsCodeLab/Mailspring` GitHub Releases. #18 (merged) put a hard stop on the whole
mechanism — `setupAutoUpdater()` now unconditionally sets state to `unsupported` and
returns before constructing any platform updater — as a stopgap so this fork's users
never get silently pushed onto a genuine upstream Mailspring release. This issue is the
real fix #18 explicitly deferred to: point the feed at this fork's own releases, surface
real release notes, and give Linux a genuine one-click install path instead of
`gh release download` + `sudo dnf upgrade` by hand (the exact pain from #12's thread).

## Scope

In scope, cross-platform (Linux + Windows only — see Non-goals):
1. Feed check against `AnsCodeLab/Mailspring`'s own GitHub Releases API.
2. Correct (non-lexicographic) version comparison for this repo's
   `MAJOR.MINOR.PATCH.YYYYMMDD` scheme.
3. Real release notes (the actual GitHub Release body) surfaced in the notification,
   with "View changelog" pointed at `AnsCodeLab/Mailspring`'s releases page.
4. One-click download + install:
   - **Linux**: detect installed package format (`dpkg` vs `rpm`), download the
     matching release asset, hand off to the OS's package-install GUI
     (`shell.openPath`, which typically opens GNOME Software/Discover/etc. with one
     confirmation click), with a `pkexec`-based CLI fallback if that hand-off fails —
     never a silent/invisible privileged command.
   - **Windows**: see the architecture decision below — same download +
     `shell.openPath`-the-installer pattern as Linux, not Squirrel's native
     `Update.exe --update` staging.
5. Remove #18's disable guard in `setupAutoUpdater()` as part of wiring the new feed
   (per #18's own plan doc: "#14 will replace this whole mechanism... remove this
   guard as part of that change").

Explicitly out of scope (see Non-goals below, both from the issue and one added here):
- macOS (issue's own non-goal — no `build-macos` job in `release.yaml`).
- Changing the release versioning scheme (issue's own non-goal).
- **Native Squirrel.Windows in-app staged update** (`Update.exe --update <feed>`) — see
  architecture decision #2.

## Architecture decision #1 — GitHub Releases as the feed, not a bespoke server

Replace `AutoUpdateManager.updateFeedURL()`'s upstream-host URL construction with a
single canonical endpoint:
`https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest`. This is a public,
unauthenticated, rate-limited-by-IP (60 req/hr unauthenticated) REST endpoint — plenty
for a 30-minute poll interval. Verified live shape via `gh release view` (which hits the
same underlying API): `{ tag_name: "v1.24.0.20260904", body: "<markdown changelog>",
assets: [{ name, browser_download_url }, ...] }`. GitHub requires a `User-Agent` header
on API requests or it 403s — the existing `manuallyQueryUpdateServer()`'s raw
`https.get()` call needs one added.

This fully replaces the old feed's `{ platform, arch, version, id, channel }` query-param
contract and its `{ url, version }` JSON response shape — the whole
`manuallyQueryUpdateServer`/`checkForUpdates` pair in `autoupdate-impl-base.ts` gets
rewritten around the GitHub Releases response shape instead. `identity.id` (previously
sent as an anonymous-analytics-ish id in the feed URL) is no longer meaningful — GitHub's
API doesn't accept or need it — so `updateFeedURL()` drops those query params entirely
and returns the static endpoint (still recomputed on `identity.id` config-change for
minimal disruption to the existing `onDidChange` wiring, even though the resulting URL no
longer varies with it — simpler than also ripping out that config listener for a
single-issue fix).

**Version comparison**: new pure function, `compareVersions(a: string, b: string):
-1|0|1` in a new `app/src/browser/version-compare.ts` — split each string on `.`, parse
each segment as a number (`Number.parseInt`, default `0` for a missing/non-numeric
segment), compare element-wise. Update is available iff
`compareVersions(latestFromTag, runningAppVersion) > 0`. This directly replaces the old
feed's server-side "204 = no update / 200 = update" status-code contract — GitHub's
`/releases/latest` always returns 200, so "no update available" is now determined
client-side by this comparison, not by HTTP status.

## Architecture decision #2 — Windows drops native Squirrel staging for the in-app update action

This is the one place this plan diverges from what "no regression to the existing
Windows in-app update flow" might suggest at first read, so it needs to be explicit and
is the main thing the plan-review gate should scrutinize.

**What Squirrel.Windows native updates actually require**: `WindowsUpdater.spawn(['--update',
feedUrl])` (`autoupdate-impl-win32.ts`) hands `feedUrl` to Squirrel's bundled
`Update.exe`, which expects `feedUrl` to be a *base URL* from which it can fetch a
`RELEASES` manifest file and then the referenced `.nupkg` delta/full package — not a
single installer `.exe`.

**What this fork's release pipeline actually publishes**: read
`app/build/create-signed-windows-installer.js` (`electron-winstaller`'s
`createWindowsInstaller()` — this **does** generate a `RELEASES` file and a `.nupkg` in
`app/dist/` locally, as a side effect of building the installer) and
`.github/workflows/release.yaml`'s `build-windows` job — it uploads only
`app/dist/MailspringSetup.exe` to the GitHub Release (confirmed: `gh release view
v1.24.0.20260904 --json assets` lists exactly `mailspring-*-0.1.x86_64.rpm`,
`mailspring-*-amd64.deb`, `MailspringSetup.exe` — no `RELEASES`, no `.nupkg`).

So even with today's feed pointed correctly, `Update.exe --update <url>` would 404
trying to fetch `<url>/RELEASES` — there is currently **no functioning Squirrel update
path for this fork's builds regardless of what the feed URL is**. Making native Squirrel
self-updates work would require *also* changing `release.yaml` to upload the `RELEASES`
file and `.nupkg` as additional release assets (and verifying GitHub's per-asset download
URLs satisfy Squirrel's base-URL-relative fetch pattern) — a release-pipeline change
orthogonal to `autoupdate-manager.ts`, and one this session cannot verify end-to-end at
all (no Windows runner/VM in this sandbox to actually exercise `Update.exe`).

**Decision**: `AutoupdateImplWin32` is simplified to reuse the same download +
`shell.openPath()`-the-installer flow as Linux, instead of `WindowsUpdater.spawn`.
`supportsUpdates()` becomes unconditionally `true` on Windows (no longer gated on
`WindowsUpdater.existsSync()`, since `Update.exe`'s presence is irrelevant to this new
flow). `windows-updater.js`'s Squirrel install/update/uninstall **hook handling** in
`main.js` (`handleStartupEventWithSquirrel`, wired to `--squirrel-install` etc.) is
**untouched** — that machinery fires only when the app itself was bootstrapped by a
Squirrel-produced installer (still true — `MailspringSetup.exe` is still built via
`electron-winstaller`) and is unrelated to how *later* in-app update checks fetch and
apply a new version.

This is not a regression by the plan's read: today's Windows in-app update flow does not
functionally work at all against this fork's own releases (wrong feed today; even fixed,
wrong artifact shape for Squirrel). The new flow is a net improvement — Windows gets a
real one-click update for the first time, using the same UX shape (download, then a
single native OS install-confirmation — Windows' installer's own UAC-style prompt) as
Linux. Full native Squirrel self-hosting via GitHub Releases (uploading `RELEASES` +
`.nupkg` and pointing `--update` at the releases/download/`<tag>` base path — a known
working pattern for other Electron apps) is left as a clearly-flagged future enhancement,
not attempted here.

## Design

### New modules

- `app/src/browser/version-compare.ts` — `compareVersions(a, b)`. Pure, easily
  unit-tested, no Electron/network dependency.
- `app/src/browser/linux-package-installer.ts` — Linux-only helpers:
  - `detectPackageFormat(): 'deb' | 'rpm' | null` — `fs.existsSync('/usr/bin/dpkg')` →
    `'deb'`, else `fs.existsSync('/usr/bin/rpm')` → `'rpm'`, else `null` (e.g.
    AppImage-only/immutable distros — falls back to the existing generic
    `shell.openExternal(releasePageUrl)` behavior, same as today's unsupported case).
  - `selectAssetForFormat(assets, format)` — pick the asset whose `name` ends in
    `.deb`/`.rpm`, matching this repo's actual published naming
    (`mailspring-<version>-amd64.deb`, `mailspring-<version>-0.1.x86_64.rpm`) via a
    simple suffix check, not a hardcoded filename (resilient to the `-0.1.` build-number
    segment potentially changing).
  - `installPackage(filePath, format): Promise<void>` — try `shell.openPath(filePath)`
    (Electron API — empty string return means success, non-empty string is the error);
    on failure, spawn `pkexec dpkg -i <path>` (deb) or, for rpm, `pkexec dnf install -y
    <path>` if `/usr/bin/dnf` exists, else `pkexec zypper install -y <path>` if
    `/usr/bin/zypper` exists (openSUSE), else `pkexec rpm -Uvh <path>` as the final
    lowest-common-denominator fallback (present on effectively every RPM-based distro,
    at the cost of not auto-resolving new dependencies — acceptable for a same-app point
    update). `pkexec` always shows a visible polkit authentication dialog regardless of
    which command runs underneath it — satisfies "no update action ever runs a
    privileged command silently/invisibly" even if the guessed command turns out wrong
    (visible failure, not a silent bad outcome).
- `app/src/browser/download-file.ts` — `downloadFile(url, destPath, onProgress?):
  Promise<void>`. Electron 41 (confirmed in `package.json`) bundles a Node runtime with
  a native global `fetch`, which follows redirects by default (GitHub asset
  `browser_download_url`s 302 to `objects.githubusercontent.com`) — use
  `fetch(url, { headers: { 'User-Agent': ... } })` +
  `Readable.fromWeb(response.body).pipe(fs.createWriteStream(destPath))` instead of a
  hand-rolled `https.get` redirect loop. No new dependency (confirmed no
  `node-fetch`/`axios`/`got` already in `package.json`); no manual hop-counting code to
  get wrong. There is no existing HTTPS-download-to-disk pattern elsewhere in the
  codebase to model after (`attachment-store.ts` only does local
  `fs.createReadStream`→`fs.createWriteStream` copies, not network downloads) — this is
  new territory, which is itself a reason to prefer the simpler `fetch`-based approach.

### Changed files

- `app/src/browser/autoupdate-manager.ts` — `updateFeedURL()` rewritten per decision #1;
  #18's disable guard in `setupAutoUpdater()` narrowed, not removed wholesale: win32 and
  linux now construct their real (rewritten) impls, but an explicit
  `if (process.platform === 'darwin') { this.setState(UnsupportedState); return; }`
  gate stays in force ahead of them. Pre-#18, the `else` branch of the old three-way
  platform switch wired up Electron's built-in Squirrel.Mac `autoUpdater`, which expects
  the old feed's response shape, not the new GitHub-Releases JSON — blanket-removing the
  guard would silently re-enable that broken darwin path even though this issue's own
  Non-goals exclude macOS (no `build-macos` release job exists). `getReleaseDetails()`
  extended to include the real release notes body (already partially wired —
  `releaseNotes`/`releaseVersion` fields exist, just need to actually be populated with
  real content instead of the `'manual-download'` sentinel).
- `app/src/browser/autoupdate-impl-base.ts` — `manuallyQueryUpdateServer`/
  `checkForUpdates` rewritten around the GitHub Releases response shape +
  `compareVersions`; `quitAndInstall()` rewritten to download (via `download-file.ts`)
  then `linux-package-installer.ts`'s `installPackage()` on Linux, or the equivalent
  download + `shell.openPath()` directly for the base/generic case (unsupported package
  format → falls back to today's `shell.openExternal(downloadUrl)`).
- `app/src/browser/autoupdate-impl-win32.ts` — simplified per decision #2: drop
  `WindowsUpdater.spawn`-based `checkForUpdates` override entirely, inherit the base
  impl's GitHub-Releases-based version-check logic. Keep one thin override: asset
  selection picks the `.exe` asset instead of `.deb`/`.rpm` (pure inheritance can't also
  pick a platform-specific asset extension — the base class needs an overridable
  hook, e.g. `selectAsset(assets)`, that `AutoupdateImplWin32` implements for `.exe`
  while the base/Linux path uses `linux-package-installer.ts`'s `selectAssetForFormat`).
  `quitAndInstall()` on Windows: download the `.exe` via `download-file.ts`, then
  **coordinate app exit before launching it** — `windows-updater.js`'s own comments
  document a previously-hit bug where launching a new Mailspring process while the old
  one still holds `app.requestSingleInstanceLock()` makes the new instance immediately
  exit, leaving the old version running with no visible error (exactly why
  `restartMailspring()` calls `app.quit()` first). Squirrel `Setup.exe` run standalone
  auto-launches the newly installed exe with no confirmation dialog when it finishes, so
  `shell.openPath()` while the app is still alive reproduces that same race. Call
  `app.quit()` (mirroring the existing `application:install-update` handler's
  `this.quitting = true` + `windowManager.cleanupBeforeAppQuit()` sequence in
  `application.ts`, which already runs before `autoUpdateManager.install()` is called)
  before/around `shell.openPath()`, not after. `supportsUpdates()` → `true`
  unconditionally (no longer gated on `WindowsUpdater.existsSync()`).

### Not touched

- `app/src/browser/windows-updater.js` and its `--squirrel-*` hook wiring in
  `app/src/browser/main.js` — install/uninstall/updated lifecycle hooks are unrelated to
  the in-app "check for update" action being changed here.
- `.github/workflows/release.yaml`, `create-signed-windows-installer.js` — no
  release-pipeline changes; this fix works entirely with the assets already published
  today.
- `app/src/browser/linux-password-store.js` — unrelated existing module (Secret Service
  detection, not package-manager detection); not reused despite superficial similarity
  (binary-existence probing) because the domains don't overlap.
- `app/src/browser/application.ts`'s `application:install-update` handler — reviewed,
  left as-is deliberately, not missed: it calls `this.quitting = true`,
  `windowManager.cleanupBeforeAppQuit()`, then `autoUpdateManager.install()`
  fire-and-forget (doesn't `await` today). `install()` → `quitAndInstall()` becomes
  asynchronous under the new design (must download over the network before it can hand
  off to the installer, vs. today's assumption that Windows staging already happened
  synchronously via Squirrel), which is compatible with this handler's existing
  non-blocking call style without any change.

## Test plan (red → green)

New/rewritten specs:
- `app/spec/version-compare-spec.ts` (new): numeric-safe comparison
  (`'1.9.0.20260101'` < `'1.10.0.20260101'` — the exact case a naive string compare gets
  wrong), equal versions, missing segments, non-numeric garbage segment defaults to 0
  rather than throwing.
- `app/spec/linux-package-installer-spec.ts` (new): format detection via mocked
  `fs.existsSync`; asset selection picks the right suffix; `installPackage` tries
  `shell.openPath` first, falls back to the right `pkexec` command per format, surfaces
  (doesn't swallow) a failure from both paths.
- `app/spec/autoupdate-manager-spec.ts` (rewrite the now-obsolete
  `updates.getmailspring.com`-URL assertions from #18-era code): `updateFeedURL()` now
  asserts the GitHub API endpoint; `setupAutoUpdater()` no longer short-circuits to
  `unsupported` (the #18 guard is gone) — needs a new assertion that it constructs a
  real platform impl and does NOT immediately bail, replacing the #18 spec's inverse
  assertion (that spec's own tests get superseded, not kept alongside contradictory new
  ones — the #18 guard's spec becomes this issue's own red case: today the removed guard
  would make new "does construct a real updater" tests fail, confirming red for the
  right reason before the fix).
- `app/spec/autoupdate-impl-base-spec.ts` (new — no existing coverage of this file at
  all today, confirmed by an empty glob result): `manuallyQueryUpdateServer` parses a
  GitHub-Releases-shaped response and correctly determines update-available via
  `compareVersions`; `checkForUpdates` emits `update-not-available` when the tag isn't
  newer; asset selection and download-then-install wiring (network/fs mocked).
- No test-harness coverage for `autoupdate-impl-win32.ts` exists today either (confirmed
  empty glob) — add a small spec mirroring the base spec's asset-selection/version-check
  behavior for the Windows `.exe` asset, mocking `download-file.ts` and `shell.openPath`
  rather than actually invoking them.

Given the real Electron test harness in this sandbox can make genuine outbound HTTPS
calls (demonstrated in #18's evidence), one live-network smoke test is worth doing
in addition to mocked unit tests: an interactive script (not a permanent spec) hitting
the real `https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest` endpoint
to confirm the response shape assumptions this plan is built on still hold at
implementation time, and that the `User-Agent` header requirement is correctly handled
(a request without one gets a `403`from GitHub — worth confirming that failure mode is
  handled gracefully, not just the happy path). Also cover a non-200 response from
  GitHub's API (e.g. a fresh fork state where `/releases/latest` 404s because no
  release has ever been published) as an explicit test case — must surface as a normal
  "no update available"/error state, not throw or crash the check cycle.

## Open questions for the plan-review gate

1. Is decision #2 (Windows drops native Squirrel staging, uses the same
   download+`shell.openPath` flow as Linux) the right call, or is a genuinely broken
   "existing" flow not something this issue should touch at all (i.e., leave
   `autoupdate-impl-win32.ts`'s Squirrel path completely alone, accept that Windows gets
   feed-pointing + changelog fixes but NOT one-click install, and treat true Windows
   one-click install as a separate future issue requiring release-pipeline changes)?
2. Redirect-following in `download-file.ts` — GitHub asset URLs redirect to
   `objects.githubusercontent.com`; is a bounded manual redirect loop the right call, or
   should this pull in a dependency (e.g. reuse something already in `package.json` if
   one already does robust HTTP redirect handling) instead of hand-rolling it?
3. `pkexec` fallback commands assume Fedora/RHEL-family (`dnf`) or Debian-family
   (`dpkg`/apt-adjacent) — is silently trying `rpm -Uvh` as a last-resort fallback when
   `dnf` is absent (e.g. openSUSE using `zypper`) acceptable, or should an unrecognized
   rpm-based distro without `dnf` just fall back to `shell.openPath`'s GUI handoff only
   (no CLI fallback attempt) rather than guessing a possibly-wrong package manager
   invocation?

## Plan review verdict

**Verdict: APPROVE WITH CHANGES**

Independently verified against the current tree: `autoupdate-manager.ts`,
`autoupdate-impl-base.ts`, `autoupdate-impl-win32.ts`, `windows-updater.js`, `main.js`,
`application.ts`, `window-manager.ts`/`window-launcher.ts`, `create-signed-windows-installer.js`,
`.github/workflows/release.yaml`, `update-notification.tsx`, `linux-password-store.js`,
`attachment-store.ts`, `package.json` (root + `app/`), and PR `b078e30f1` (#18/#19)'s actual diff
and plan doc. All of the plan's load-bearing factual claims about current code checked out:
the `#18` guard's exact shape and comment, the pre-#18 three-branch `setupAutoUpdater`
(win32 native Squirrel / linux `AutoupdateImplBase` / darwin `require('electron').autoUpdater`),
the `manuallyQueryUpdateServer`/`checkForUpdates`/`quitAndInstall` shapes in
`autoupdate-impl-base.ts` and `autoupdate-impl-win32.ts`, and `release.yaml` uploading exactly
`*.deb`/`*.rpm` (Linux job) and only `MailspringSetup.exe` (Windows job) — no `RELEASES`/`.nupkg`.

### Module boundary — correct, with one real gap
The new-file split (`version-compare.ts`, `linux-package-installer.ts`, `download-file.ts`) is
the right shape: pure/testable version comparison separated from platform-specific install
mechanics, mirroring the existing `autoupdate-impl-base.ts`/`-win32.ts` split. Reusing that split
for asset selection (Linux picks `.deb`/`.rpm`, Windows picks `.exe`) is correct.

**Gap:** the plan says `AutoupdateImplWin32` "drops... entirely, inherit[s] the base impl's
GitHub-Releases-based behavior" but then separately says Windows' asset selection must pick the
`.exe` asset. Those two statements conflict — pure inheritance with zero override can't also pick
a platform-specific asset extension. `AutoupdateImplWin32` needs to keep at least a thin override
(e.g. an asset-selection hook) even after dropping `WindowsUpdater.spawn`. Not a blocker, just
needs the design section tightened before implementation.

### Real issue found: guard removal silently reactivates a broken darwin path (scope leak)
The plan's Non-goals correctly exclude macOS ("no `build-macos` job in `release.yaml`"), but
"Changed files" says the `#18` guard in `setupAutoUpdater()` is removed wholesale, "restoring real
platform-impl construction." Verified against the pre-`#18` diff: that construction is a
three-way branch, and the `else` branch (covering darwin, and any platform that isn't
`win32`/`linux`) wires up **Electron's built-in `autoUpdater`** — a native Squirrel.Mac client
that expects a very specific feed response shape (`204`/`200 + {url, name, notes, pub_date}`).
`updateFeedURL()` is being rewritten to unconditionally return the GitHub Releases API endpoint
for every platform. Blanket-removing the guard therefore re-enables a live macOS code path that
will `setFeedURL()` a URL returning a GitHub release JSON object Squirrel.Mac's native parser does
not understand — precisely the class of "silently offer users something broken" risk `#18` exists
to prevent, just manifesting as parse failures/error dialogs instead of a wrong download. There is
no current macOS release channel (confirmed), so blast radius today is limited to anyone running a
non-dev-mode macOS build from source, but it's still an unintended, unaddressed side effect of a
change whose own scope statement excludes macOS. **Required change:** keep an explicit
platform gate — e.g. `if (process.platform === 'darwin') { this.setState(UnsupportedState); return; }`
ahead of the win32/linux construction — so `#18`'s protection stays in force for darwin while
win32/linux get the new mechanism. Cheap, one `if`, but must be called out explicitly since the
current plan text describes unconditional guard removal.

### Real issue found: Windows `quitAndInstall` drops single-instance-lock handling that this exact file already had to learn the hard way
`windows-updater.js`'s own comments document a previously-hit bug: launching a new Mailspring
process while the old one is still alive races `app.requestSingleInstanceLock()` — "the new
instance can start before the old one exits, hit the single-instance lock, and immediately quit —
leaving no running instance" — which is exactly why `restartMailspring()` calls `app.quit()` first
and uses `--processStartAndWait` before spawning. Verified `main.js` does call
`app.requestSingleInstanceLock()` for non-dev-mode launches. Separately verified (web search)
that Squirrel.Windows' `Setup.exe`, run with no arguments (which is what `shell.openPath()` on the
downloaded installer does), does **not** show a UAC-style confirmation dialog the way the plan's
prose implies ("Windows' installer's own UAC-style prompt") — it shows a brief loading-gif window,
installs to a new versioned folder, and **auto-launches the newly installed exe** when done. Doing
that while the current instance is still running and holding the single-instance lock reproduces
the exact documented failure mode in this same file: the newly auto-launched process hits the lock
and immediately exits, silently leaving the old version running with no visible error — a "one-click
install" that appears to succeed (installer ran, no exception) but doesn't actually switch versions.
**Required change:** the new Windows `quitAndInstall()` must call `app.quit()` (or otherwise
coordinate app exit) before/around launching the downloaded `MailspringSetup.exe`, the same way
`restartMailspring()` already does — this is not optional polish, it reproduces a bug this
codebase has already hit and fixed once. Linux does not have this hazard (Linux permits
overwriting an in-use binary's inode, and `shell.openPath`/`pkexec` package-manager flows don't
auto-relaunch the app), so this is Windows-specific.

Related, smaller: the plan should also touch `application.ts`'s `application:install-update`
handler (currently absent from "Changed files"/"Not touched"). Today it fires `quitting = true`,
`windowManager.cleanupBeforeAppQuit()` (destroys only the hidden hot-window, not visible windows —
verified in `window-manager.ts`/`window-launcher.ts`, so this isn't a hard app-quit trigger), then
calls `autoUpdateManager.install()` synchronously and fire-and-forget. Under the new design,
`install()` → `quitAndInstall()` becomes asynchronous (must download over the network first) where
it previously assumed the package was already staged on disk. That's compatible with the current
handler's non-blocking call style (it doesn't await `install()` today either), but the plan should
say so explicitly rather than leaving `application.ts` unlisted, since a reviewer diffing "files
touched" against this list would otherwise flag it as a missed file.

### Simpler path available for open question #2 — don't hand-roll redirects
Confirmed `electron: 41.7.2` in `package.json` (root). Electron 41 bundles a Node runtime with a
native global `fetch` available in the main process (confirmed no existing HTTP client dependency
like `node-fetch`/`axios`/`got` in either `package.json`). `fetch()` follows redirects by default,
which is exactly GitHub's asset-download behavior (a `browser_download_url` 302s to
`objects.githubusercontent.com`). **Recommendation: use `fetch()` + `Readable.fromWeb(response.body)`
piped to `fs.createWriteStream()` in `download-file.ts` instead of a hand-rolled bounded
`https.get` redirect loop.** No new dependency, no manual redirect/hop-counting code, less to get
wrong (this also lets `download-file.ts` set the required `User-Agent` header the same way as the
rewritten `manuallyQueryUpdateServer`). This directly answers open question #2: neither "hand-roll
it" nor "add a dependency" — the runtime already has what's needed built in. Minor correction to
the plan's own evidence: it cites `attachment-store.ts` as "the existing pattern" for this, but
that file only does local `fs.createReadStream`→`fs.createWriteStream` copies, not HTTPS downloads
or redirect-following — there is no existing HTTPS-download-to-disk pattern in the codebase to
model after either way, which is a reason to prefer the simpler `fetch`-based approach even more.

### Open question #3 — `pkexec` fallback
`rpm -Uvh` is not really "guessing a possibly-wrong package manager" the way the question frames
it — `rpm` is the lowest-common-denominator tool present on effectively every RPM-based distro
(Fedora/RHEL/openSUSE/etc.) regardless of which higher-level frontend (`dnf`/`zypper`/`yum`) is
installed, since they're all built on `librpm`. Its real weakness is that it won't auto-resolve new
dependencies the way `dnf`/`zypper install` would; for a same-app point update this is a reasonable
bet (dependencies of an already-installed app are already satisfied) but not guaranteed. Recommend
detecting `zypper` alongside the existing `dnf` check (same pattern, one more `fs.existsSync`) for
a friendlier dependency-resolving path on openSUSE, keeping `rpm -Uvh` only as the final fallback
when neither is present. Not worth making the CLI fallback opt-out entirely — `pkexec` already
guarantees the "never silent" requirement regardless of which command runs underneath it, so the
downside of a wrong guess is a visible failed `pkexec` prompt/error, not a silent bad outcome.

### Non-blocking observations
- `checkForUpdates`/`manuallyQueryUpdateServer` rewrite should keep handling a non-200 from GitHub's
  API gracefully (e.g. a fresh fork/tag state where `/releases/latest` 404s because no release
  exists yet) — the plan's design implies this falls out of the existing non-200 error path, worth
  a one-line acceptance-criterion callout in the test plan rather than assuming it's obviously covered.
- Verified `CONTRIBUTING.md:151` ("we're _extremely_ wary of adding options and preferences") — the
  plan doesn't add any new config surface, consistent with that guidance.
- Rate limit math (60 req/hr unauthenticated, 30-min poll ⇒ 2 req/hr per client) is correct and low
  risk; worth a one-line note that many users behind the same corporate/NAT egress IP share that
  budget, though at this scale it's very unlikely to matter.

### Answers to the three open questions
1. **Decision #2 (drop native Squirrel staging for Windows): yes, keep it — with the required
   fix above.** The plan's own evidence is correct and independently verified: today's Windows
   flow cannot work regardless of feed correctness (`Update.exe --update` needs a `RELEASES`
   manifest + `.nupkg` that `release.yaml` never publishes), and fixing that is a genuinely
   separate, unverifiable-in-this-sandbox release-pipeline change. Reusing the download +
   `shell.openPath` pattern is the right pragmatic call and is a net improvement over "silently
   does nothing." But it must not ship without the `app.quit()`/single-instance-lock coordination
   fix above — as designed (bare `shell.openPath()` with the app still running), it reproduces a
   documented, previously-fixed bug in this exact codebase and would likely manifest as "clicked
   Install, installer ran, nothing changed" for real users. Leaving Squirrel alone entirely (the
   question's proposed alternative) is not preferable — it would ship Windows changelog/feed fixes
   with an install action that's guaranteed to 404, which is a worse and more confusing user
   experience than a well-coordinated shell-install.
2. **Redirect-following: neither hand-roll nor add a dependency — use the runtime's native
   `fetch`.** See above; Electron 41's bundled Node already follows redirects by default with zero
   added code or dependencies.
3. **`pkexec` fallback: acceptable as designed, with the `zypper` addition recommended above.**
   `rpm -Uvh` as a last resort is not an unsafe guess given `pkexec`'s visible-prompt guarantee;
   don't narrow it to GUI-only-no-CLI-fallback, that would regress the "genuine one-click install"
   goal for openSUSE/other rpm-family users without `dnf` for no real safety benefit.

### Risk assessment
Medium risk as currently written (two real correctness gaps — the darwin re-activation and the
Windows single-instance-lock race — both silent-failure-shaped rather than crash-shaped, which
makes them easy to miss in review and easy to ship undetected), low risk once both required
changes above are incorporated. Cross-platform blast radius is otherwise well-contained to the
files the plan already lists; no evidence of scope creep beyond the two gaps identified (both of
which are the new mechanism unintentionally reaching into platforms/paths the plan explicitly
says are out of scope, not new deliberate scope). Test plan is appropriately red→green and correctly
identifies the two files with zero existing coverage; recommend adding one `autoupdate-manager-spec.ts`
case asserting `setupAutoUpdater()` still sets `UnsupportedState` specifically on a mocked
`process.platform === 'darwin'` once the required darwin gate is added, so the fix above has its
own regression test rather than shipping as an unverified follow-up.
