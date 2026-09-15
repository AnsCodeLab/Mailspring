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
  setFeedURL(url: string): void;
  checkForUpdates(): void;
  quitAndInstall(): Promise<void>;
  manuallyQueryUpdateServer(callback: (release: GitHubRelease | false) => void): void;
}

let fetchSpy: jasmine.Spy;
let openExternalSpy: jasmine.Spy;
let downloadFileSpy: jasmine.Spy;
let detectPackageFormatSpy: jasmine.Spy;
let selectAssetForFormatSpy: jasmine.Spy;
let installPackageSpy: jasmine.Spy;
let AutoupdateImplBase: new (currentVersion: string) => AutoupdateImpl;

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
  downloadFileSpy = jasmine.createSpy('downloadFile').andReturn(Promise.resolve());
  detectPackageFormatSpy = jasmine.createSpy('detectPackageFormat').andReturn('deb');
  selectAssetForFormatSpy = jasmine
    .createSpy('selectAssetForFormat')
    .andCallFake(
      (assets: GitHubReleaseAsset[], format: string) =>
        assets.find((a) => a.name.endsWith(`.${format}`)) ?? null
    );
  installPackageSpy = jasmine.createSpy('installPackage').andReturn(Promise.resolve());

  const mod = proxyquire('../src/browser/autoupdate-impl-base', {
    electron: { shell: { openExternal: openExternalSpy }, '@noCallThru': false },
    './download-file': { downloadFile: downloadFileSpy, '@noCallThru': false },
    './linux-package-installer': {
      detectPackageFormat: detectPackageFormatSpy,
      selectAssetForFormat: selectAssetForFormatSpy,
      installPackage: installPackageSpy,
      '@noCallThru': false,
    },
  });
  // proxyquire's dynamic `require()` result has no static type - this is
  // the one boundary in this file where the real shape is known (it's the
  // class this spec is testing) but can't be inferred by the compiler.
  AutoupdateImplBase = mod.default as unknown as new (currentVersion: string) => AutoupdateImpl;
}

const sampleAssets: GitHubReleaseAsset[] = [
  { name: 'mailspring-1.25.0-amd64.deb', browser_download_url: 'https://example.com/x.deb' },
  { name: 'mailspring-1.25.0-0.1.x86_64.rpm', browser_download_url: 'https://example.com/x.rpm' },
];

// This repo's Jasmine wrapper (`spec-runner.ts`'s `_runAsync`) does not
// support a Mocha/Jest-style `(done) => {...}` callback parameter — an
// `it()`/`waitsForPromise`-style test must instead *return* a Promise that
// resolves/rejects to indicate completion. This helper bridges an
// event-driven callback into a returned Promise.
function waitForEvent(impl: AutoupdateImpl, event: string): Promise<unknown[]> {
  const { promise, resolve } = Promise.withResolvers<unknown[]>();
  impl.once(event, (...args: unknown[]) => resolve(args));
  return promise;
}

describe('AutoupdateImplBase', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    loadModule();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('manuallyQueryUpdateServer', () => {
    it('parses a GitHub Releases API response and passes it through on success', () => {
      fetchSpy.andReturn(
        jsonResponse(200, {
          tag_name: 'v1.25.0.20260910',
          body: 'Release notes here',
          assets: sampleAssets,
        })
      );
      const impl = new AutoupdateImplBase('1.24.0.20260904');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

      const { promise, resolve } = Promise.withResolvers<void>();
      impl.manuallyQueryUpdateServer((release) => {
        expect(release).toBeTruthy();
        expect(release && release.tag_name).toEqual('v1.25.0.20260910');
        resolve();
      });
      return promise;
    });

    it('sends a User-Agent header (GitHub 403s API requests without one)', () => {
      fetchSpy.andReturn(jsonResponse(200, { tag_name: 'v1.0.0.1', body: '', assets: [] }));
      const impl = new AutoupdateImplBase('1.0.0.0');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

      const { promise, resolve } = Promise.withResolvers<void>();
      impl.manuallyQueryUpdateServer(() => {
        const [, options] = fetchSpy.mostRecentCall.args;
        expect(options.headers['User-Agent']).toBeTruthy();
        resolve();
      });
      return promise;
    });

    it('treats a 404 (fresh repo, no release published yet) as "no update" rather than an error', () => {
      fetchSpy.andReturn(jsonResponse(404, {}));
      const impl = new AutoupdateImplBase('1.0.0.0');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

      let errored = false;
      impl.on('error', () => {
        errored = true;
      });

      const { promise, resolve } = Promise.withResolvers<void>();
      impl.manuallyQueryUpdateServer((release) => {
        expect(release).toBe(false);
        expect(errored).toBe(false);
        resolve();
      });
      return promise;
    });

    it('emits an error for a genuine non-200/404 failure', () => {
      fetchSpy.andReturn(jsonResponse(500, {}));
      const impl = new AutoupdateImplBase('1.0.0.0');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

      const { promise, resolve } = Promise.withResolvers<void>();
      impl.on('error', (err: Error) => {
        expect(err.message.includes('500')).toBe(true);
        resolve();
      });

      impl.manuallyQueryUpdateServer(() => {
        expect('successCallback invoked').toEqual(
          'successCallback must not be invoked on a genuine server error'
        );
      });
      return promise;
    });
  });

  describe('checkForUpdates', () => {
    it('emits update-not-available when the release tag is not newer than the running version', () => {
      fetchSpy.andReturn(
        jsonResponse(200, { tag_name: 'v1.24.0.20260904', body: '', assets: sampleAssets })
      );
      const impl = new AutoupdateImplBase('1.24.0.20260904');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

      impl.on('update-downloaded', () =>
        expect('update-downloaded emitted').toEqual(
          'update-downloaded must not be emitted when no update is available'
        )
      );
      const notAvailable = waitForEvent(impl, 'update-not-available');
      impl.checkForUpdates();
      return notAvailable;
    });

    it('emits update-not-available when the release tag is older than the running version', () => {
      fetchSpy.andReturn(
        jsonResponse(200, { tag_name: 'v1.9.0.20260101', body: '', assets: sampleAssets })
      );
      const impl = new AutoupdateImplBase('1.10.0.20260101');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

      const notAvailable = waitForEvent(impl, 'update-not-available');
      impl.checkForUpdates();
      return notAvailable;
    });

    it('emits update-downloaded with the real release notes when a newer version is published', () => {
      fetchSpy.andReturn(
        jsonResponse(200, {
          tag_name: 'v1.25.0.20260910',
          body: 'Real changelog body',
          assets: sampleAssets,
        })
      );
      const impl = new AutoupdateImplBase('1.24.0.20260904');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

      const downloaded = waitForEvent(impl, 'update-downloaded');
      impl.checkForUpdates();
      return downloaded.then((args) => {
        const [, notes, version] = args as [unknown, string, string];
        expect(notes).toEqual('Real changelog body');
        expect(version).toEqual('1.25.0.20260910');
      });
    });

    it('selects the platform-matching asset via linux-package-installer', () => {
      fetchSpy.andReturn(
        jsonResponse(200, { tag_name: 'v1.25.0.20260910', body: '', assets: sampleAssets })
      );
      const impl = new AutoupdateImplBase('1.24.0.20260904');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

      const downloaded = waitForEvent(impl, 'update-downloaded');
      impl.checkForUpdates();
      return downloaded.then(() => {
        expect(detectPackageFormatSpy).toHaveBeenCalled();
        expect(selectAssetForFormatSpy).toHaveBeenCalledWith(sampleAssets, 'deb');
      });
    });
  });

  describe('quitAndInstall', () => {
    function checkAndInstall(impl: AutoupdateImpl): Promise<void> {
      const downloaded = waitForEvent(impl, 'update-downloaded');
      impl.checkForUpdates();
      return downloaded.then(() => impl.quitAndInstall());
    }

    it('downloads the selected asset then hands off to installPackage', () => {
      fetchSpy.andReturn(
        jsonResponse(200, { tag_name: 'v1.25.0.20260910', body: '', assets: sampleAssets })
      );
      const impl = new AutoupdateImplBase('1.24.0.20260904');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

      return checkAndInstall(impl).then(() => {
        const expectedDestPath = downloadFileSpy.mostRecentCall.args[1];
        expect(downloadFileSpy).toHaveBeenCalledWith('https://example.com/x.deb', expectedDestPath);
        expect(typeof expectedDestPath).toEqual('string');
        expect(installPackageSpy).toHaveBeenCalledWith(expectedDestPath, 'deb');
        expect(openExternalSpy).not.toHaveBeenCalled();
      });
    });

    it('falls back to opening the releases page when no package format is detected', () => {
      detectPackageFormatSpy.andReturn(null);
      fetchSpy.andReturn(
        jsonResponse(200, { tag_name: 'v1.25.0.20260910', body: '', assets: sampleAssets })
      );
      const impl = new AutoupdateImplBase('1.24.0.20260904');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');

      return checkAndInstall(impl).then(() => {
        expect(downloadFileSpy).not.toHaveBeenCalled();
        expect(openExternalSpy).toHaveBeenCalledWith(
          'https://github.com/AnsCodeLab/Mailspring/releases/latest'
        );
      });
    });

    it('falls back to opening the releases page when the download fails', () => {
      downloadFileSpy.andReturn(Promise.reject(new Error('network down')));
      fetchSpy.andReturn(
        jsonResponse(200, { tag_name: 'v1.25.0.20260910', body: '', assets: sampleAssets })
      );
      const impl = new AutoupdateImplBase('1.24.0.20260904');
      impl.setFeedURL('https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest');
      impl.on('error', () => {});

      return checkAndInstall(impl).then(() => {
        expect(installPackageSpy).not.toHaveBeenCalled();
        expect(openExternalSpy).toHaveBeenCalledWith(
          'https://github.com/AnsCodeLab/Mailspring/releases/latest'
        );
      });
    });
  });
});
