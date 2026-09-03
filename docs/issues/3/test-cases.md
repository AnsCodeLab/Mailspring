# Issue #3 — Test Cases

One case per row of the plan's "Acceptance criteria mapping" table
(`docs/issues/3/plan.md`), plus the automated spec matrix that backs them.

## 1. Reproduce the original bug (manual)

**Scenario**: An unlocked secret service (GNOME Keyring or KWallet) is
running, but `XDG_CURRENT_DESKTOP` and `DESKTOP_SESSION` are both stripped
from the launching process's environment (the exact condition the issue
reports, e.g. some display managers / minimal session launchers / `su -`
into a login shell that doesn't re-export desktop session variables).

**Preconditions**:
- Linux desktop with a running, unlocked secret service reachable over the
  session D-Bus (e.g. `gnome-keyring-daemon --components=secrets` already
  running, or a KDE session with KWallet unlocked).
- A normal interactive session bus available (`DBUS_SESSION_BUS_ADDRESS` set
  in the ambient shell environment, since we are only stripping the two
  desktop-identifier variables, not the bus address itself).

**Steps** (pre-fix, i.e. on `master`/before this branch's changes):
1. `env -u XDG_CURRENT_DESKTOP -u DESKTOP_SESSION npm start`
2. Wait for the app to reach the point where it needs to store account
   credentials (first account setup, or any `_writeKeyHash` call).

**Expected result (pre-fix, reproducing the bug)**: Chromium's OSCrypt
backend auto-detection has no `XDG_CURRENT_DESKTOP`/`DESKTOP_SESSION` signal
to pick a Linux backend, `safeStorage.isEncryptionAvailable()` returns
`false` even though a secret service is reachable, and the app shows the
"Mailspring could not store your password securely... On Linux, Mailspring
requires a secret service such as GNOME Keyring or KWallet. Please ensure
one is installed and running, then restart Mailspring." modal, then quits.

**Actually executed in this sandbox**: NOT executed. This sandbox has no
persistent GNOME Keyring/KWallet daemon wired to a real login session (headless
xvfb test environment only used for the Jasmine suite below), so a genuine
before/after secret-service-backed repro was not run here. See §3 below for
what automated coverage substitutes for this manual step.

## 2. Verify the fix (manual)

**Scenario**: Same launch condition as case 1, but with this branch's
changes applied.

**Steps** (post-fix):
1. `env -u XDG_CURRENT_DESKTOP -u DESKTOP_SESSION npm start`
2. Inspect `chrome://internals/` or startup logs for evidence that Chromium
   engaged the libsecret/kwallet backend (matching the issue's own
   verification method), or confirm no crash-loop dialog appears and
   credentials save successfully.

**Expected result**: `detectPasswordStoreSwitch()` (Gate 1: platform is
`linux` and both desktop vars are unset — Gate 2: `DBUS_SESSION_BUS_ADDRESS`
is set) pings `org.freedesktop.secrets` (or falls back to
`org.kde.kwalletd6`/`org.kde.kwalletd5`) over D-Bus, finds it reachable, and
`main.js` calls `app.commandLine.appendSwitch('password-store',
'gnome-libsecret')` (or `'kwallet6'`/`'kwallet5'`) before the `ready` event.
Chromium now explicitly uses the detected backend instead of falling back to
its broken auto-detection, `safeStorage.isEncryptionAvailable()` returns
`true`, and the app stores the password without showing the error dialog.

**Actually executed in this sandbox**: NOT executed as a live manual
end-to-end repro (same limitation as case 1 — no real desktop secret service
daemon available to this sandbox). What *was* executed: the full gate/probe
decision logic that `main.js` relies on is covered end-to-end by the
automated spec in §3, which exercises the exact same
`detectPasswordStoreSwitch()` function `main.js` calls, with the D-Bus layer
mocked via `proxyquire`.

## 3. No regression for the normal case (automated)

**Scenario**: A full desktop session where `XDG_CURRENT_DESKTOP` (and/or
`DESKTOP_SESSION`) is already correctly set, so Chromium's own
auto-detection already works.

**Preconditions**: `app/spec/linux-password-store-spec.ts` loaded via
`proxyquire` with `child_process.execFileSync` mocked.

**Steps / expected results** (all automated, all executed — see
`test-results.md` for the actual run transcript):

| # | Case | Expected |
|---|---|---|
| 3a | `process.platform !== 'linux'` (e.g. `darwin`), `DBUS_SESSION_BUS_ADDRESS` set | Returns `null`; `execFileSync` never invoked (0 calls) |
| 3b | Linux, `XDG_CURRENT_DESKTOP` set, `DBUS_SESSION_BUS_ADDRESS` set | Returns `null`; `execFileSync` never invoked |
| 3c | Linux, `DESKTOP_SESSION` set (`XDG_CURRENT_DESKTOP` unset), `DBUS_SESSION_BUS_ADDRESS` set | Returns `null`; `execFileSync` never invoked |
| 3d | Linux, both desktop vars unset, `DBUS_SESSION_BUS_ADDRESS` unset | Returns `null`; `execFileSync` never invoked |
| 3e | Linux, both gates cleared, first probe (`org.freedesktop.secrets` / `/org/freedesktop/secrets`) succeeds | Returns `'gnome-libsecret'`; `execFileSync` called exactly once with `dbus-send ['--session', '--dest=org.freedesktop.secrets', '--type=method_call', '--print-reply', '/org/freedesktop/secrets', 'org.freedesktop.DBus.Peer.Ping']`, `{ stdio: 'ignore', timeout: 600 }` |
| 3f | Both gates cleared, probe 1 throws, probe 2 (`org.kde.kwalletd6` / `/modules/kwalletd6`) succeeds | Returns `'kwallet6'`; `execFileSync` called exactly twice, second call uses the kwalletd6 dest/path |
| 3g | Both gates cleared, probes 1–2 throw, probe 3 (`org.kde.kwalletd5` / `/modules/kwalletd5`) succeeds | Returns `'kwallet5'`; `execFileSync` called exactly three times, third call uses the kwalletd5 dest/path |
| 3h | Both gates cleared, all three probes throw | Returns `null`; `execFileSync` called exactly three times; no exception escapes `detectPasswordStoreSwitch()` |

Cases 3a–3d directly demonstrate the "no regression for the normal case"
acceptance criterion by construction: the moment either desktop-identifier
env var is present, zero subprocess calls happen and Chromium's own
auto-detection is left completely untouched.

## 4. `buildLinuxPasswordStoreHint` branch coverage (automated)

**Scenario**: The residual-error hint text shown when
`safeStorage.isEncryptionAvailable()` is still `false` on Linux, after the
`main.js` fix has already had a chance to select a working backend.

**Preconditions**: `app/spec/key-manager-hint-spec.ts`, pure function test,
no mocking required.

| # | Input | Expected |
|---|---|---|
| 4a | `buildLinuxPasswordStoreHint(true)` | Exact string `' On Linux, Mailspring detected a running secret service but could not use it to store your password. Please make sure it is unlocked, then restart Mailspring.'`; does not contain "install" or "download" |
| 4b | `buildLinuxPasswordStoreHint(false)` | Exact original string `' On Linux, Mailspring requires a secret service such as GNOME Keyring or KWallet. Please ensure one is installed and running, then restart Mailspring.'`; contains "install" |
| 4c | Both branches | Return values are different strings |
