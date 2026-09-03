import { buildLinuxPasswordStoreHint } from '../src/key-manager';

describe('buildLinuxPasswordStoreHint', () => {
  it('returns a message that does not tell the user to install/start a keyring when a secret service is reachable', () => {
    const hint = buildLinuxPasswordStoreHint(true);
    expect(hint).toBe(
      ' On Linux, Mailspring detected a running secret service but could not use it to store your password. Please make sure it is unlocked, then restart Mailspring.'
    );
    expect(hint.toLowerCase()).not.toContain('install');
    expect(hint.toLowerCase()).not.toContain('download');
  });

  it('returns the original install/run message when no secret service is reachable', () => {
    const hint = buildLinuxPasswordStoreHint(false);
    expect(hint).toBe(
      ' On Linux, Mailspring requires a secret service such as GNOME Keyring or KWallet. Please ensure one is installed and running, then restart Mailspring.'
    );
    expect(hint.toLowerCase()).toContain('install');
  });

  it('returns two distinct messages for the two branches', () => {
    expect(buildLinuxPasswordStoreHint(true)).not.toBe(buildLinuxPasswordStoreHint(false));
  });
});
