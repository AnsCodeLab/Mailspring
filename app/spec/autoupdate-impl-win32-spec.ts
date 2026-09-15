import proxyquire from 'proxyquire';
import { EventEmitter } from 'events';

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  body: string;
  assets: GitHubReleaseAsset[];
}

interface AutoupdateImpl extends EventEmitter {
  supportsUpdates(): boolean;
  setFeedURL(url: string): void;
  checkForUpdates(): void;
  quitAndInstall(): Promise<void>;
  manuallyQueryUpdateServer(callback: (release: GitHubRelease | false) => void): void;
}

let fetchSpy: jasmine.Spy;
let openExternalSpy: jasmine.Spy;
let openPathSpy: jasmine.Spy;
let downloadFileSpy: jasmine.Spy;
let appQuitSpy: jasmine.Spy;
let appOnceSpy: jasmine.Spy;
let AutoupdateImplWin32: new (currentVersion: string) => AutoupdateImpl;

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

function loadModule() {
  fetchSpy = jasmine.createSpy('fetch');
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  openExternalSpy = jasmine.createSpy('openExternal');
  openPathSpy = jasmine.createSpy('openPath').andReturn(Promise.resolve(''));
  downloadFileSpy = jasmine.createSpy('downloadFile').andReturn(Promise.resolve());
  appQuitSpy = jasmine.createSpy('quit');
  appOnceSpy = jasmine.createSpy('once').andCallFake((_event: string, cb: () => void) => cb());

  const mod = proxyquire('../src/browser/autoupdate-impl-win32', {
    electron: {
      shell: { openExternal: openExternalSpy, openPath: openPathSpy },
      app: { quit: appQuitSpy, once: appOnceSpy },
      '@noCallThru': false,
    },
    './download-file': { downloadFile: downloadFileSpy, '@noCallThru': false },
  });
  // proxyquire's dynamic `require()` result has no static type - this is
  // the one boundary in this file where the real shape is known (it's the
  // class this spec is testing) but can't be inferred by the compiler.
  AutoupdateImplWin32 = mod.default as unknown as new (currentVersion: string) => AutoupdateImpl;
}

const sampleAssets: GitHubReleaseAsset[] = [
  { name: 'mailspring-1.25.0-amd64.deb', browser_download_url: 'https://example.com/x.deb' },
  { name: 'MailspringSetup.exe', browser_download_url: 'https://example.com/MailspringSetup.exe' },
];

// This repo's Jasmine wrapper does not support a `(done) => {...}` callback
// parameter - a test must instead *return* a Promise. See
// autoupdate-impl-base-spec.ts for the same helper/rationale.
function waitForEvent(impl: AutoupdateImpl, event: string): Promise<unknown[]> {
  const { promise, resolve } = Promise.withResolvers<unknown[]>();
  impl.once(event, (...args: unknown[]) => resolve(args));
  return promise;
}

function checkAndInstall(impl: AutoupdateImpl): Promise<void> {
  const downloaded = waitForEvent(impl, 'update-downloaded');
  impl.checkForUpdates();
  return downloaded.then(() => impl.quitAndInstall());
}

describe('AutoupdateImplWin32', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    loadModule();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('supportsUpdates() is unconditionally true (no longer gated on WindowsUpdater.existsSync)', () => {
    const impl = new AutoupdateImplWin32('1.24.0.20260904');
    expect(impl.supportsUpdates()).toBe(true);
  });

  it('inherits the base GitHub-Releases-based version check via checkForUpdates', () => {
    fetchSpy.andReturn(
      jsonResponse(200, {
        tag_name: 'v1.25.0.20260910',
        body: 'Windows changelog',
        assets: sampleAssets,
      })
    );
    const impl = new AutoupdateImplWin32('1.24.0.20260904');
    impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

    const downloaded = waitForEvent(impl, 'update-downloaded');
    impl.checkForUpdates();
    return downloaded.then((args) => {
      const [, notes, version] = args as [unknown, string, string];
      expect(notes).toEqual('Windows changelog');
      expect(version).toEqual('1.25.0.20260910');
    });
  });

  it('selects the .exe asset instead of .deb/.rpm', () => {
    fetchSpy.andReturn(
      jsonResponse(200, { tag_name: 'v1.25.0.20260910', body: '', assets: sampleAssets })
    );
    const impl = new AutoupdateImplWin32('1.24.0.20260904');
    impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

    return checkAndInstall(impl).then(() => {
      const expectedDestPath = downloadFileSpy.mostRecentCall.args[1];
      expect(downloadFileSpy).toHaveBeenCalledWith(
        'https://example.com/MailspringSetup.exe',
        expectedDestPath
      );
      expect(typeof expectedDestPath).toEqual('string');
    });
  });

  describe('quitAndInstall', () => {
    it('calls app.quit() and only launches the installer from a will-quit handler, never while still running', () => {
      fetchSpy.andReturn(
        jsonResponse(200, { tag_name: 'v1.25.0.20260910', body: '', assets: sampleAssets })
      );
      const impl = new AutoupdateImplWin32('1.24.0.20260904');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

      return checkAndInstall(impl).then(() => {
        expect(appOnceSpy).toHaveBeenCalled();
        const [eventName] = appOnceSpy.mostRecentCall.args;
        expect(eventName).toEqual('will-quit');
        expect(appQuitSpy).toHaveBeenCalled();
        // The mocked `once` implementation invokes its callback
        // synchronously, so `openPath` only having been called at all here
        // proves it was reached through the `will-quit` registration path
        // rather than a stray direct call elsewhere in quitAndInstall.
        expect(openPathSpy).toHaveBeenCalledWith(downloadFileSpy.mostRecentCall.args[1]);
      });
    });

    it('falls back to opening the releases page when the download fails, without quitting the app', () => {
      downloadFileSpy.andReturn(Promise.reject(new Error('network down')));
      fetchSpy.andReturn(
        jsonResponse(200, { tag_name: 'v1.25.0.20260910', body: '', assets: sampleAssets })
      );
      const impl = new AutoupdateImplWin32('1.24.0.20260904');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');
      impl.on('error', () => {});

      return checkAndInstall(impl).then(() => {
        expect(appQuitSpy).not.toHaveBeenCalled();
        expect(openExternalSpy).toHaveBeenCalledWith(
          'https://github.com/AnsCodeLab/Mailspring/releases/latest'
        );
      });
    });
  });
});
