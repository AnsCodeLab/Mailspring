import proxyquire from 'proxyquire';

// ---------------------------------------------------------------------------
// Per-test spy and lazily-loaded module (proxyquire injects the mock before
// the module is evaluated, so the destructured `execFileSync` binding used
// inside `linux-password-store.js` is mocked).
// ---------------------------------------------------------------------------

let execFileSyncSpy: jasmine.Spy;
let detectPasswordStoreSwitch: () => string | null;

function loadModule() {
  execFileSyncSpy = jasmine.createSpy('execFileSync');
  const mod = proxyquire('../src/browser/linux-password-store', {
    child_process: { execFileSync: execFileSyncSpy, '@noCallThru': false },
  });
  detectPasswordStoreSwitch = mod.detectPasswordStoreSwitch;
}

function mockProbeSuccess() {
  execFileSyncSpy.andReturn(Buffer.from(''));
}

function mockProbeFailure() {
  // andThrow is a real runtime API on this repo's bundled Jasmine (see
  // spec-runner/jasmine.js's own JSDoc) but isn't declared by the
  // @types/jasmine@1.3.x package installed here (andReturn/andCallFake/
  // andCallThrough are) - use andCallFake to the same effect instead of
  // reaching for an undeclared method.
  execFileSyncSpy.andCallFake(() => {
    throw new Error('probe failed');
  });
}

function mockProbeSequence(results: Array<'success' | 'failure'>) {
  let call = 0;
  execFileSyncSpy.andCallFake(() => {
    const result = results[call];
    call += 1;
    if (result === 'failure') {
      throw new Error('probe failed');
    }
    return Buffer.from('');
  });
}

describe('Linux password store detection', () => {
  const originalPlatform = process.platform;
  const originalXdgCurrentDesktop = process.env.XDG_CURRENT_DESKTOP;
  const originalDesktopSession = process.env.DESKTOP_SESSION;
  const originalDbusSessionBusAddress = process.env.DBUS_SESSION_BUS_ADDRESS;

  beforeEach(() => {
    loadModule();
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env.XDG_CURRENT_DESKTOP;
    delete process.env.DESKTOP_SESSION;
    delete process.env.DBUS_SESSION_BUS_ADDRESS;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    if (originalXdgCurrentDesktop === undefined) {
      delete process.env.XDG_CURRENT_DESKTOP;
    } else {
      process.env.XDG_CURRENT_DESKTOP = originalXdgCurrentDesktop;
    }
    if (originalDesktopSession === undefined) {
      delete process.env.DESKTOP_SESSION;
    } else {
      process.env.DESKTOP_SESSION = originalDesktopSession;
    }
    if (originalDbusSessionBusAddress === undefined) {
      delete process.env.DBUS_SESSION_BUS_ADDRESS;
    } else {
      process.env.DBUS_SESSION_BUS_ADDRESS = originalDbusSessionBusAddress;
    }
  });

  describe('Gate 1: platform + desktop environment variables', () => {
    it('returns null and never shells out on a non-Linux platform', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/run/user/1000/bus';
      expect(detectPasswordStoreSwitch()).toBe(null);
      expect(execFileSyncSpy.calls.length).toBe(0);
    });

    it('returns null and never shells out when XDG_CURRENT_DESKTOP is set', () => {
      process.env.XDG_CURRENT_DESKTOP = 'GNOME';
      process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/run/user/1000/bus';
      expect(detectPasswordStoreSwitch()).toBe(null);
      expect(execFileSyncSpy.calls.length).toBe(0);
    });

    it('returns null and never shells out when DESKTOP_SESSION is set', () => {
      process.env.DESKTOP_SESSION = 'plasma';
      process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/run/user/1000/bus';
      expect(detectPasswordStoreSwitch()).toBe(null);
      expect(execFileSyncSpy.calls.length).toBe(0);
    });
  });

  describe('Gate 2: DBUS_SESSION_BUS_ADDRESS', () => {
    it('returns null and never shells out when the session bus address is unset', () => {
      expect(detectPasswordStoreSwitch()).toBe(null);
      expect(execFileSyncSpy.calls.length).toBe(0);
    });
  });

  describe('probe matrix once both gates are cleared', () => {
    beforeEach(() => {
      process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/run/user/1000/bus';
    });

    it('returns gnome-libsecret when the freedesktop secrets service answers', () => {
      mockProbeSuccess();
      expect(detectPasswordStoreSwitch()).toBe('gnome-libsecret');
      expect(execFileSyncSpy.calls.length).toBe(1);
      const [cmd, args, opts] = execFileSyncSpy.calls[0].args;
      expect(cmd).toBe('dbus-send');
      expect(args).toEqual([
        '--session',
        '--dest=org.freedesktop.secrets',
        '--type=method_call',
        '--print-reply',
        '/org/freedesktop/secrets',
        'org.freedesktop.DBus.Peer.Ping',
      ]);
      expect(opts.stdio).toBe('ignore');
      expect(opts.timeout).toBe(600);
    });

    it('falls back to kwallet6 when the freedesktop probe fails but kwalletd6 answers', () => {
      mockProbeSequence(['failure', 'success']);
      expect(detectPasswordStoreSwitch()).toBe('kwallet6');
      expect(execFileSyncSpy.calls.length).toBe(2);
      const [cmd, args] = execFileSyncSpy.calls[1].args;
      expect(cmd).toBe('dbus-send');
      expect(args).toEqual([
        '--session',
        '--dest=org.kde.kwalletd6',
        '--type=method_call',
        '--print-reply',
        '/modules/kwalletd6',
        'org.freedesktop.DBus.Peer.Ping',
      ]);
    });

    it('falls back to kwallet5 when both prior probes fail but kwalletd5 answers', () => {
      mockProbeSequence(['failure', 'failure', 'success']);
      expect(detectPasswordStoreSwitch()).toBe('kwallet5');
      expect(execFileSyncSpy.calls.length).toBe(3);
      const [cmd, args] = execFileSyncSpy.calls[2].args;
      expect(cmd).toBe('dbus-send');
      expect(args).toEqual([
        '--session',
        '--dest=org.kde.kwalletd5',
        '--type=method_call',
        '--print-reply',
        '/modules/kwalletd5',
        'org.freedesktop.DBus.Peer.Ping',
      ]);
    });

    it('returns null without throwing when all three probes fail', () => {
      mockProbeFailure();
      expect(() => {
        expect(detectPasswordStoreSwitch()).toBe(null);
      }).not.toThrow();
      expect(execFileSyncSpy.calls.length).toBe(3);
    });
  });
});
