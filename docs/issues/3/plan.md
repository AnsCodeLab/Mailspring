# Issue #3 — "Could not store your password securely" despite a working secret service

## Root cause (confirmed by independently re-reading the referenced code)

- `app/src/key-manager.ts:112` (`_writeKeyHash`) throws a blocking error, surfaced via
  `_reportFatalError` as a modal dialog that quits the app, whenever
  `safeStorage.isEncryptionAvailable()` is false. The Linux hint text unconditionally reads
  as "no secret service is installed," even when one actually is.
- `app/src/browser/main.js:306-307` (inside `start()`) sets exactly two Chromium command-line
  switches (`autoplay-policy`, `js-flags`) before the `ready` event. No `--password-store`
  switch is ever set — confirmed by grepping the whole repo for
  `commandLine.appendSwitch` (this is the only call site). Chromium's Linux
  `safeStorage`/OSCrypt backend selection therefore falls back entirely to its own
  environment-variable-based auto-detection (`XDG_CURRENT_DESKTOP`/`DESKTOP_SESSION` of
  *this* process), not an actual reachability probe of a secret service.
- `start()` (`main.js:250-405`) is synchronous and calls `start();` at module bottom
  (`main.js:407`). All `app.commandLine.appendSwitch(...)` calls must complete before
  `start()` returns, because Electron's `ready` event can fire as soon as the current
  synchronous execution yields — there is nothing else gating it. This means any D-Bus probe
  added here must be **synchronous**, not the async pattern used elsewhere in this repo
  (`app/src/dnd-utils-linux.ts`'s `execAsync`/`execFile`), or the switch can lose the race
  and be silently ignored.
- Precedent already exists in this repo for exactly this kind of probe:
  `app/src/dnd-utils-linux.ts` already shells out to `dbus-send` (documented there as "part
  of the dbus package and available on virtually every Linux system with a graphical
  session") to query a freedesktop D-Bus property, with total tolerance for the binary or
  service being absent.

## Fix

1. **New file `app/src/browser/linux-password-store.js`** (plain CommonJS — `main.js`
   itself is unbuilt/untranspiled JS and runs *before*
   `setupCompileCache()`/`setupConfigDir()` are even called at `main.js:311/338`, so nothing
   `require()`d from this early code path can be a `.ts` file; TypeScript compilation isn't
   wired up yet at this point in the bootstrap). Exports `detectPasswordStoreSwitch(): string
   | null`, gated by two zero-subprocess pre-checks before ever shelling out:
   - **Gate 1** — only proceed if `process.platform === 'linux'` AND both
     `XDG_CURRENT_DESKTOP` and `DESKTOP_SESSION` are unset/empty in `process.env`. This is
     the exact condition the issue reports as broken; on a normal desktop session (the
     overwhelming majority of launches) this returns `null` immediately, with zero added
     cost or behavior change, leaving Chromium's native auto-detection (which already
     handles GNOME and native-KWallet-backend cases correctly) completely untouched.
   - **Gate 2** — only proceed if `process.env.DBUS_SESSION_BUS_ADDRESS` is already set.
     `dbus-send --session` with no bus address set can trigger libdbus's X11-based
     autolaunch, which can spawn a detached `dbus-daemon` grandchild that a timeout-kill of
     the immediate `dbus-send` child does not reach — exactly the hang risk to avoid in a
     startup-blocking synchronous call, and most likely in precisely the headless/minimal
     environments this fix targets. No bus address also means no reachable secret service
     via the standard mechanism regardless, so skipping is correct, not just safe.
   - Once both gates pass, synchronously ping each candidate service in order via
     `execFileSync('dbus-send', ['--session', '--dest=<name>', '--type=method_call',
     '--print-reply', '<path>', 'org.freedesktop.DBus.Peer.Ping'], { stdio: 'ignore',
     timeout: 600 })`, stopping at the first that succeeds:
     1. `org.freedesktop.secrets` (path `/org/freedesktop/secrets`) → `'gnome-libsecret'`.
        libsecret is a generic client for the Secret Service D-Bus API and works against
        GNOME Keyring, KWallet's secrets-service compatibility layer (when enabled), and any
        other implementation of the same spec.
     2. `org.kde.kwalletd6` (path `/modules/kwalletd6`) → `'kwallet6'`.
     3. `org.kde.kwalletd5` (path `/modules/kwalletd5`) → `'kwallet5'`.
     4. None reachable → `null` (genuinely no secret service — dialog and copy stay
        identical to today).
   - Every `execFileSync` call is wrapped in try/catch; any failure (missing binary, ENOENT,
     non-zero exit, timeout) is treated as "not reachable" and never throws out of
     `detectPasswordStoreSwitch()`.
2. **`app/src/browser/main.js`**: immediately after the two existing
   `app.commandLine.appendSwitch(...)` calls (~line 307), add:
   ```js
   if (process.platform === 'linux') {
     const passwordStore = require('./linux-password-store').detectPasswordStoreSwitch();
     if (passwordStore) {
       app.commandLine.appendSwitch('password-store', passwordStore);
     }
   }
   ```
   `null` (probe failed/no service found) means "don't touch the switch" — Chromium's
   existing auto-detection behavior is completely unchanged for every case that isn't the
   one this issue reports, including the true "no secret service at all" case (dialog and
   copy stay identical there).
3. **`app/src/key-manager.ts`**: extract the Linux hint-string construction out of
   `_writeKeyHash` into a small pure, exported function
   `buildLinuxPasswordStoreHint(secretServiceReachable: boolean): string` so it's directly
   unit-testable without mocking `@electron/remote`. `_writeKeyHash` calls
   `require('./browser/linux-password-store').detectPasswordStoreSwitch() !== null` (safe
   to `require` here — by the time any window's renderer code runs, the app has long since
   passed the point where TS compilation is set up; idempotent/side-effect-free re-query,
   same function used at startup) to pick the branch:
   - Reachable-but-still-failing (the case this issue reports, which our `main.js` fix
     should have already resolved *before* the app ever gets this far — this branch is the
     "something deeper is wrong" residual case, e.g. a libsecret backend error unrelated to
     reachability, or the gates in `detectPasswordStoreSwitch()` themselves not applying,
     e.g. `XDG_CURRENT_DESKTOP` WAS set but the backend it pointed at still failed): a
     message that does NOT tell the user to install/start a keyring they already have, and
     instead points at checking the keyring is unlocked and Mailspring restarted since it
     was set up.
   - Not reachable (genuinely no secret service, or the gates skipped the probe entirely):
     the original "please install and run one" message, unchanged.

## Testing

- `app/spec/linux-password-store-spec.ts` (new) — mirrors the `dnd-utils-linux-spec.ts`
  `proxyquire`-mocked-`child_process` convention, covering `detectPasswordStoreSwitch()`'s
  full gate + probe matrix: returns `null` without invoking `execFileSync` at all on
  non-Linux, or on Linux when `XDG_CURRENT_DESKTOP`/`DESKTOP_SESSION` are set, or when
  `DBUS_SESSION_BUS_ADDRESS` is unset; on Linux with both gates cleared, returns
  `'gnome-libsecret'`/`'kwallet6'`/`'kwallet5'` depending on which mocked `execFileSync`
  call succeeds first (asserting the exact `dbus-send` argv/order used), and `null` when
  all three throw (ENOENT / non-zero exit / timeout).
- `app/spec/key-manager-hint-spec.ts` (new) — unit tests for
  `buildLinuxPasswordStoreHint(reachable)`'s two branches (pure function, no
  `@electron/remote` mocking needed).
- No e2e test: this is a native Linux D-Bus + Electron command-line-switch interaction with
  no UI surface Playwright can drive (the switch must be set before the renderer/any window

## Acceptance criteria mapping (from the issue)

| Issue's testing note | How satisfied |
|---|---|
| Reproduce: unlocked secret service running, `XDG_CURRENT_DESKTOP`/`DESKTOP_SESSION` stripped → dialog + crash-loop | Manual repro documented in `test-results.md`, using the same technique the issue describes (spawn with a stripped environment) |
| After fix: same launch succeeds because the app explicitly selects the detected backend | Manual verification after the fix, same launch condition, confirming `--password-store=gnome-libsecret` takes effect (checked via `chrome://` internals or log evidence of the libsecret backend engaging, matching the issue's own verification method) |
| No regression for the normal case (full desktop session, `XDG_CURRENT_DESKTOP` already correct) | `detectPasswordStoreSwitch()` only ever *adds* an explicit switch when it can independently confirm a reachable secret service — it never removes Chromium's own auto-detection's ability to work, and returns `null` (no-op) whenever the D-Bus probe itself is unavailable, so the normal desktop-session case is provably unaffected by construction, not just by testing |

## Non-goals

- macOS/Windows — issue and root cause are Linux-only; `detectPasswordStoreSwitch()` no-ops
  immediately on other platforms.
- Rewriting `_reportFatalError`'s general (non-Linux-hint) dialog/quit flow.
- DE fingerprinting beyond a D-Bus reachability probe (no attempt to read
  `XDG_CURRENT_DESKTOP`'s value to guess *which* backend to prefer beyond the
  freedesktop-secrets-then-KWallet probe order below).

## Plan Review Gate — verdict: APPROVE WITH CHANGES

Independent reviewer findings, verified against upstream documentation before adopting
(binding):

1. **Confirmed correct, no change**: switches genuinely must be set synchronously before
   `start()` returns — Electron's `ready` event isn't gated on any of our JS promises, so
   an async probe can lose the race. `execFileSync` (not the async `execFile` pattern used
   elsewhere in this repo) is the right primitive.
2. **Real risk, addressed by narrowing scope, not by abandoning the approach**: shelling
   out on *every* Linux launch is unnecessary cost and risk. **Gate the entire probe
   behind the exact condition the issue reports**: only attempt anything when
   `XDG_CURRENT_DESKTOP` AND `DESKTOP_SESSION` are BOTH unset/empty in `process.env` (a
   pure, zero-subprocess check). On a normal desktop session (the overwhelming majority of
   launches), skip entirely and leave Chromium's native auto-detection — which already
   handles GNOME and native KWallet backends correctly — completely untouched. This also
   directly resolves finding 3's regression risk (preempting an already-correct KWallet
   native-backend selection).
3. **Real, verified risk**: `dbus-send --session` with no `DBUS_SESSION_BUS_ADDRESS` set
   can trigger libdbus's X11-based autolaunch (`dbus-launch --autolaunch`), which can spawn
   a detached `dbus-daemon` grandchild that a timeout-kill of the immediate `dbus-send`
   child does NOT reach (Node's `execFileSync` `timeout`/`killSignal` targets the direct
   child PID only) — and this is exactly the kind of headless/minimal/no-X11 environment
   this fix targets, where autolaunch is also most likely to hang. **Add a second
   zero-subprocess pre-check**: only shell out if `process.env.DBUS_SESSION_BUS_ADDRESS` is
   already set. If it isn't, there is no reachable session bus via the standard mechanism
   at all, so skip (return `null`) rather than invoking `dbus-send` and risking autolaunch.
4. **Verified via research (KDE Wallet documentation)**: KWallet's `org.freedesktop.secrets`
   compatibility bridge is opt-in (`apiEnabled=true` in `kwalletrc`) and disabled by default
   on most pre-Plasma-6 KDE installs — probing only `org.freedesktop.secrets` misses the
   equally-common default-KWallet variant of this exact bug that the issue's own suggested
   fix explicitly asked for (`--password-store=... kwallet/kwallet5/kwallet6 as
   appropriate`). **Extend the probe** to try, in order once the two gates above pass:
   `org.freedesktop.secrets` → `gnome-libsecret`; else `org.kde.kwalletd6` → `kwallet6`;
   else `org.kde.kwalletd5` → `kwallet5`; else `null`.
5. **Confirmed correct, no change**: `main.js` genuinely cannot `require()` a `.ts` file at
   this point in the bootstrap (`setupCompileCache()` runs later); a new plain `.js`
   CommonJS module is the only workable choice, verified via direct trace of
   `compile-cache-ts.js`'s `require.extensions` hook registration point.
6. **Timeout shortened** per the reviewer's recommendation: 1500ms → 600ms per probe call
   (now rare-path only, behind both gates, so a short timeout costs nothing in the normal
   case and bounds worst-case added startup latency in the broken case to at most
   `3 × 600ms` if all three probes are attempted and each times out at the ceiling).
