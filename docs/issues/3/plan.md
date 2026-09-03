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
   wired up yet at this point in the bootstrap). Exports:
   - `isSecretServiceReachable(): boolean` — synchronously pings
     `org.freedesktop.secrets` via `execFileSync('dbus-send', [...], { stdio: 'ignore',
     timeout: 1500 })` (`org.freedesktop.DBus.Peer.Ping`); any failure (missing binary,
     ENOENT, non-zero exit, timeout, no session bus) is caught and returns `false`. Never
     throws.
   - `detectPasswordStoreSwitch(): string | null` — returns `null` immediately on
     non-Linux platforms (no probe at all — zero behavior change elsewhere); on Linux,
     returns `'gnome-libsecret'` when `isSecretServiceReachable()` is true, else `null`.
     libsecret is a generic client for the `org.freedesktop.secrets` D-Bus API and works
     against GNOME Keyring, KWallet (via its secrets-service compatibility layer), and any
     other implementation of the same spec — so "a secret service answered the ping" is
     sufficient justification to prefer it over Chromium's environment-variable guess,
     without needing to distinguish which keyring implementation is actually running.
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
   `_writeKeyHash` into a small pure, exported function (e.g.
   `buildLinuxPasswordStoreHint(secretServiceReachable: boolean): string`) so it's directly
   unit-testable without mocking `@electron/remote`. `_writeKeyHash` calls
   `require('./browser/linux-password-store').isSecretServiceReachable()` (safe to
   `require` here — by the time any window's renderer code runs, the app has long since
   passed the point where TS compilation is set up) to pick the branch:
   - Reachable-but-still-failing (the case this issue reports, which our `main.js` fix
     should have already resolved *before* the app ever gets this far — this branch is the
     "something deeper is wrong" residual case, e.g. `dbus-send` missing, keyring locked,
     or a libsecret backend error unrelated to reachability): a message that does NOT tell
     the user to install/start a keyring they already have, and instead points at checking
     the `dbus-send` utility is installed and the keyring is unlocked.
   - Not reachable (genuinely no secret service): the original "please install and run
     one" message, unchanged.

## Testing

- `app/spec/linux-password-store-spec.ts` (new) — mirrors the `dnd-utils-linux-spec.ts`
  `proxyquire`-mocked-`child_process` convention: `detectPasswordStoreSwitch()` returns
  `null` on non-Linux without invoking `execFileSync` at all; on Linux, returns
  `'gnome-libsecret'` when the mocked `execFileSync` succeeds, `null` when it throws
  (ENOENT / non-zero exit / timeout) — plus a direct `isSecretServiceReachable()` spec
  covering the same success/failure matrix and asserting the exact `dbus-send` argv used.
- `app/spec/key-manager-hint-spec.ts` (new) — unit tests for
  `buildLinuxPasswordStoreHint(reachable)`'s two branches (pure function, no
  `@electron/remote` mocking needed).
- No e2e test: this is a native Linux D-Bus + Electron command-line-switch interaction with
  no UI surface Playwright can drive (the switch must be set before the renderer/any window
  exists), and this repo's e2e suite has no existing convention for synthesizing D-Bus
  session state. Manual verification (documented in `test-results.md`, matching the issue's
  own "Testing Notes" reproduction recipe) is the right-sized check for the startup-switch
  behavior itself; the two new spec files pin the actual decision logic.

## Acceptance criteria mapping (from the issue)

| Issue's testing note | How satisfied |
|---|---|
| Reproduce: unlocked secret service running, `XDG_CURRENT_DESKTOP`/`DESKTOP_SESSION` stripped → dialog + crash-loop | Manual repro documented in `test-results.md`, using the same technique the issue describes (spawn with a stripped environment) |
| After fix: same launch succeeds because the app explicitly selects the detected backend | Manual verification after the fix, same launch condition, confirming `--password-store=gnome-libsecret` takes effect (checked via `chrome://` internals or log evidence of the libsecret backend engaging, matching the issue's own verification method) |
| No regression for the normal case (full desktop session, `XDG_CURRENT_DESKTOP` already correct) | `detectPasswordStoreSwitch()` only ever *adds* an explicit switch when it can independently confirm a reachable secret service — it never removes Chromium's own auto-detection's ability to work, and returns `null` (no-op) whenever the D-Bus probe itself is unavailable, so the normal desktop-session case is provably unaffected by construction, not just by testing |

## Non-goals

- KWallet-specific `--password-store=kwallet`/`kwallet5`/`kwallet6` selection — libsecret's
  cross-backend compatibility makes a KWallet-specific value unnecessary for this fix; not
  attempting DE fingerprinting.
- macOS/Windows — issue and root cause are Linux-only; `detectPasswordStoreSwitch()` no-ops
  immediately on other platforms.
- Rewriting `_reportFatalError`'s general (non-Linux-hint) dialog/quit flow.
