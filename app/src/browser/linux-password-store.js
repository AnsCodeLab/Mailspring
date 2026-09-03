/**
 * Detects a reachable Linux secret service so `main.js` can explicitly set
 * Chromium's `--password-store` switch before the app's `ready` event fires.
 *
 * This module is plain CommonJS (not TypeScript): it is `require()`d from
 * `main.js` before `setupCompileCache()` wires up `.ts` `require()` support,
 * so nothing at this point in the bootstrap can be a `.ts` file.
 *
 * Two zero-subprocess gates run before any D-Bus call is attempted:
 *
 *  - Gate 1: only probe when `process.platform === 'linux'` AND both
 *    `XDG_CURRENT_DESKTOP` and `DESKTOP_SESSION` are unset/empty. This is
 *    the exact condition under which Chromium's own environment-variable
 *    based backend auto-detection has nothing to go on. On a normal desktop
 *    session (the overwhelming majority of launches) this gate fails
 *    immediately, leaving Chromium's native auto-detection - which already
 *    handles GNOME and native KWallet backends correctly - untouched.
 *  - Gate 2: only probe when `DBUS_SESSION_BUS_ADDRESS` is already set.
 *    `dbus-send --session` with no bus address set can trigger libdbus's
 *    X11-based autolaunch, which can spawn a detached `dbus-daemon`
 *    grandchild that a timeout-kill of the immediate `dbus-send` child does
 *    not reach - a hang risk that must be avoided in a startup-blocking
 *    synchronous call, and most likely in exactly the headless/minimal
 *    environments this fix targets. No bus address also means no reachable
 *    secret service via the standard mechanism regardless.
 *
 * Once both gates pass, each candidate service is pinged synchronously (the
 * switch must be set before `start()` returns, so the async `execFile`
 * pattern used elsewhere in this repo cannot be used here) in order, and the
 * first one that responds wins:
 *
 *  1. `org.freedesktop.secrets` -> 'gnome-libsecret'. libsecret is a generic
 *     Secret Service D-Bus API client and works against GNOME Keyring,
 *     KWallet's secrets-service compatibility layer (when enabled), and any
 *     other implementation of the same spec.
 *  2. `org.kde.kwalletd6` -> 'kwallet6'. KWallet's freedesktop-secrets
 *     bridge is opt-in and disabled by default on many installs, so a
 *     native KWallet6 probe is required to catch that case too.
 *  3. `org.kde.kwalletd5` -> 'kwallet5'.
 *
 * If all three throw (missing `dbus-send` binary, ENOENT, non-zero exit,
 * timeout, or any other error) this returns `null`. This function never
 * throws.
 */

const { execFileSync } = require('child_process');

const PROBE_TIMEOUT_MS = 600;

const CANDIDATES = [
  {
    dest: 'org.freedesktop.secrets',
    path: '/org/freedesktop/secrets',
    passwordStore: 'gnome-libsecret',
  },
  {
    dest: 'org.kde.kwalletd6',
    path: '/modules/kwalletd6',
    passwordStore: 'kwallet6',
  },
  {
    dest: 'org.kde.kwalletd5',
    path: '/modules/kwalletd5',
    passwordStore: 'kwallet5',
  },
];

function pingService(dest, path) {
  try {
    execFileSync(
      'dbus-send',
      [
        '--session',
        `--dest=${dest}`,
        '--type=method_call',
        '--print-reply',
        path,
        'org.freedesktop.DBus.Peer.Ping',
      ],
      { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS }
    );
    return true;
  } catch (err) {
    return false;
  }
}

function detectPasswordStoreSwitch() {
  if (process.platform !== 'linux') {
    return null;
  }
  if (process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION) {
    return null;
  }
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
    return null;
  }

  for (const candidate of CANDIDATES) {
    if (pingService(candidate.dest, candidate.path)) {
      return candidate.passwordStore;
    }
  }
  return null;
}

module.exports = { detectPasswordStoreSwitch };
