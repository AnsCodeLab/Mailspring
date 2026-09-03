# Issue #3 — Test Results

All commands below were actually executed in this sandbox on 2026-09-03
(Fedora 44, xvfb, Electron from `node_modules/.bin/electron`). Exit codes
were checked with `echo $?` immediately after each run.

## 1. Red step (before implementation)

Both new spec files were written first and run against the not-yet-created
implementation to confirm they fail for the *right* reason.

```
$ xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test -f "linux-password-store-spec"
```

Result: 8 failures, all `Cannot find module '../src/browser/linux-password-store'`
/ `TypeError: detectPasswordStoreSwitch is not a function` — i.e. failing
because the module under test didn't exist yet, not because of a logic bug
in the spec.

```
$ xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test -f "key-manager-hint-spec"
```

Result: 3 failures, all `TypeError: (0 , key_manager_1.buildLinuxPasswordStoreHint) is not a function`
— failing because the export didn't exist yet.

## 2. Green step (after implementation)

### `linux-password-store-spec.ts`

Command:
```
xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test -f "linux-password-store-spec"
```

Exit code: `0`

Output (Electron/Chromium startup noise elided; full Jasmine result block
kept verbatim):

```
  Linux password store detection
    Gate 1: platform + desktop environment variables
      ✓ returns null and never shells out on a non-Linux platform
      ✓ returns null and never shells out when XDG_CURRENT_DESKTOP is set
      ✓ returns null and never shells out when DESKTOP_SESSION is set
    Gate 2: DBUS_SESSION_BUS_ADDRESS
      ✓ returns null and never shells out when the session bus address is unset
    probe matrix once both gates are cleared
      ✓ returns gnome-libsecret when the freedesktop secrets service answers
      ✓ falls back to kwallet6 when the freedesktop probe fails but kwalletd6 answers
      ✓ falls back to kwallet5 when both prior probes fail but kwalletd5 answers
      ✓ returns null without throwing when all three probes fail

  8 passing
```

### `key-manager-hint-spec.ts`

Command:
```
xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test -f "key-manager-hint-spec"
```

Exit code: `0`

Output:

```
  buildLinuxPasswordStoreHint
    ✓ returns a message that does not tell the user to install/start a keyring when a secret service is reachable
    ✓ returns the original install/run message when no secret service is reachable
    ✓ returns two distinct messages for the two branches

  3 passing
```

## 3. Lint

Command:
```
npx eslint -c .eslintrc "app/src/key-manager.ts" "app/spec/linux-password-store-spec.ts" "app/spec/key-manager-hint-spec.ts"
```

Exit code: `0`, no output (no warnings/errors).

`app/src/browser/main.js` and `app/src/browser/linux-password-store.js` are
plain CommonJS and intentionally excluded from this command: `package.json`'s
`lint`/`lint:check` scripts only target `app/src/**/*.{ts,tsx}` and
`app/internal_packages/**/*.{ts,tsx}`, and `.eslintrc`'s `parserOptions.project`
points at `app/tsconfig.json` (a TypeScript-project-aware parse), which is
not the right tool for a plain untranspiled `.js` bootstrap file. Both files
were checked instead with `node --check` (verifies syntax only):

```
$ node --check app/src/browser/linux-password-store.js && node --check app/src/browser/main.js && echo OK
OK
```

`npx prettier --check` was also run against every touched/new file to
confirm style consistency with the rest of the codebase:

```
$ npx prettier --check app/src/browser/linux-password-store.js app/src/key-manager.ts \
    app/spec/linux-password-store-spec.ts app/spec/key-manager-hint-spec.ts
Checking formatting...
All matched files use Prettier code style!
```

(`app/src/browser/main.js` was separately confirmed via `git stash` to
already fail `prettier --check` on `master`/before this change, i.e. this is
a pre-existing formatting gap unrelated to the one line-group inserted by
this fix, not something introduced here.)

## 4. Orchestrator manual verification (real D-Bus session, not mocked)

The implementor's sandbox reported no persistent secret-service daemon available for a
live repro. This orchestrator's sandbox does have one (a real GNOME session, confirmed via
`dbus-send --session --dest=org.freedesktop.secrets --type=method_call --print-reply
/org/freedesktop/secrets org.freedesktop.DBus.Peer.Ping` succeeding directly), so the
actual production code path — `detectPasswordStoreSwitch()`, unmocked, real
`execFileSync`/`dbus-send` — was run end-to-end against it, reproducing the issue's exact
scenario:

```
$ node -e "console.log(require('./app/src/browser/linux-password-store').detectPasswordStoreSwitch())"
null                                                    # normal session (XDG_CURRENT_DESKTOP=GNOME set) — Gate 1 defers to Chromium, as designed

$ env -u XDG_CURRENT_DESKTOP -u DESKTOP_SESSION node -e "console.log(require('./app/src/browser/linux-password-store').detectPasswordStoreSwitch())"
gnome-libsecret                                          # issue's exact repro (env vars stripped, real session bus + real secret service still reachable) — correctly detected, 12ms elapsed

$ env -u XDG_CURRENT_DESKTOP -u DESKTOP_SESSION -u DBUS_SESSION_BUS_ADDRESS node -e "console.log(require('./app/src/browser/linux-password-store').detectPasswordStoreSwitch())"
null                                                    # no session bus at all — Gate 2 defers, as designed
```

This directly confirms the fix resolves the reported bug against a real secret service, not
just the proxyquire-mocked unit tests: with the exact environment shape the issue describes
(desktop-session env vars absent, secret service reachable), `detectPasswordStoreSwitch()`
now returns `'gnome-libsecret'` — the switch `main.js` would pass to Chromium — where it
previously (pre-fix, no `--password-store` switch at all) would have left Chromium's
auto-detection to fail exactly as the issue reports. The normal-session case measured
6ms (zero subprocess calls, Gate 1 short-circuits), confirming the "no cost/no behavior
change on a healthy desktop launch" design goal.

What a full end-to-end repro of the *original bug* (pre-fix behavior: the blocking dialog
and `mailsync` crash-loop) would still require beyond this sandbox: launching the full
packaged Mailspring app (not just this one pure module) with a stripped environment and
observing the actual dialog/log output pre- and post-fix — not performed here, since it
needs a full account-configured Mailspring profile, which is out of scope for a unit-level
fix verification.

## 5. What was NOT executed

- The full `npm test` suite and `npm run typecheck` were intentionally **not**
  run in this task (per instructions — the orchestrating agent runs those
  once at the end).
- A full packaged-app repro of the original dialog/crash-loop (see §4 above for exactly
  what was and wasn't verified in its place).
