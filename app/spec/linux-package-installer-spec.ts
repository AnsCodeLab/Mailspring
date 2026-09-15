import proxyquire from 'proxyquire';
import { EventEmitter } from 'events';

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

let existsSyncSpy: jasmine.Spy;
let openPathSpy: jasmine.Spy;
let spawnSpy: jasmine.Spy;
let spawnedChildren: EventEmitter[];

let detectPackageFormat: () => 'deb' | 'rpm' | null;
let selectAssetForFormat: (assets: ReleaseAsset[], format: 'deb' | 'rpm') => ReleaseAsset | null;
let installPackage: (filePath: string, format: 'deb' | 'rpm') => Promise<void>;

function makeChild() {
  const child = new EventEmitter();
  spawnedChildren.push(child);
  return child;
}

function loadModule() {
  existsSyncSpy = jasmine.createSpy('existsSync').andReturn(false);
  openPathSpy = jasmine.createSpy('openPath').andReturn(Promise.resolve(''));
  spawnedChildren = [];
  spawnSpy = jasmine.createSpy('spawn').andCallFake(() => makeChild());

  const mod = proxyquire('../src/browser/linux-package-installer', {
    fs: { existsSync: existsSyncSpy, '@noCallThru': false },
    electron: { shell: { openPath: openPathSpy }, '@noCallThru': false },
    child_process: { spawn: spawnSpy, '@noCallThru': false },
  });
  detectPackageFormat = mod.detectPackageFormat;
  selectAssetForFormat = mod.selectAssetForFormat;
  installPackage = mod.installPackage;
}

function waitForSpawn(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  (function poll() {
    if (spawnedChildren.length > 0) {
      resolve();
    } else {
      setImmediate(poll);
    }
  })();
  return promise;
}

async function resolveLastSpawnSuccessfully() {
  await waitForSpawn();
  const child = spawnedChildren[spawnedChildren.length - 1];
  child.emit('close', 0);
}

async function rejectLastSpawn(code = 1) {
  await waitForSpawn();
  const child = spawnedChildren[spawnedChildren.length - 1];
  child.emit('close', code);
}

describe('linux-package-installer', () => {
  beforeEach(() => {
    loadModule();
  });

  describe('detectPackageFormat', () => {
    it('returns "deb" when /usr/bin/dpkg exists', () => {
      existsSyncSpy.andCallFake((p: string) => p === '/usr/bin/dpkg');
      expect(detectPackageFormat()).toEqual('deb');
    });

    it('returns "rpm" when dpkg is absent but /usr/bin/rpm exists', () => {
      existsSyncSpy.andCallFake((p: string) => p === '/usr/bin/rpm');
      expect(detectPackageFormat()).toEqual('rpm');
    });

    it('returns null when neither dpkg nor rpm exists (e.g. AppImage-only distros)', () => {
      existsSyncSpy.andReturn(false);
      expect(detectPackageFormat()).toBeNull();
    });

    it('prefers dpkg over rpm when both are present', () => {
      existsSyncSpy.andReturn(true);
      expect(detectPackageFormat()).toEqual('deb');
    });
  });

  describe('selectAssetForFormat', () => {
    const assets: ReleaseAsset[] = [
      { name: 'mailspring-1.24.0-amd64.deb', browser_download_url: 'https://x/deb' },
      { name: 'mailspring-1.24.0-0.1.x86_64.rpm', browser_download_url: 'https://x/rpm' },
      { name: 'MailspringSetup.exe', browser_download_url: 'https://x/exe' },
    ];

    it('picks the asset with a matching suffix, not a hardcoded filename', () => {
      expect(selectAssetForFormat(assets, 'deb').name).toEqual('mailspring-1.24.0-amd64.deb');
      expect(selectAssetForFormat(assets, 'rpm').name).toEqual('mailspring-1.24.0-0.1.x86_64.rpm');
    });

    it('is resilient to a changed build-number segment in the rpm filename', () => {
      const renamed: ReleaseAsset[] = [
        { name: 'mailspring-2.0.0-0.2.x86_64.rpm', browser_download_url: 'https://x/rpm2' },
      ];
      expect(selectAssetForFormat(renamed, 'rpm').name).toEqual('mailspring-2.0.0-0.2.x86_64.rpm');
    });

    it('returns null when no asset matches the requested format', () => {
      expect(
        selectAssetForFormat([{ name: 'foo.exe', browser_download_url: 'x' }], 'deb')
      ).toBeNull();
    });
  });

  describe('installPackage', () => {
    it('tries shell.openPath first and resolves without a pkexec fallback on success', async () => {
      openPathSpy.andReturn(Promise.resolve(''));
      await installPackage('/tmp/mailspring.deb', 'deb');
      expect(openPathSpy).toHaveBeenCalledWith('/tmp/mailspring.deb');
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it('falls back to `pkexec dpkg -i` when shell.openPath fails, for .deb', async () => {
      openPathSpy.andReturn(Promise.resolve('No application registered'));
      const promise = installPackage('/tmp/mailspring.deb', 'deb');
      await resolveLastSpawnSuccessfully();
      await promise;
      expect(spawnSpy).toHaveBeenCalledWith('pkexec', ['dpkg', '-i', '/tmp/mailspring.deb'], {
        stdio: 'ignore',
      });
    });

    it('falls back to `pkexec dnf install -y` for .rpm when dnf is present', async () => {
      openPathSpy.andReturn(Promise.resolve('No application registered'));
      existsSyncSpy.andCallFake((p: string) => p === '/usr/bin/dnf');
      const promise = installPackage('/tmp/mailspring.rpm', 'rpm');
      await resolveLastSpawnSuccessfully();
      await promise;
      expect(spawnSpy).toHaveBeenCalledWith(
        'pkexec',
        ['dnf', 'install', '-y', '/tmp/mailspring.rpm'],
        { stdio: 'ignore' }
      );
    });

    it('falls back to `pkexec zypper install -y` for .rpm when dnf is absent but zypper is present', async () => {
      openPathSpy.andReturn(Promise.resolve('No application registered'));
      existsSyncSpy.andCallFake((p: string) => p === '/usr/bin/zypper');
      const promise = installPackage('/tmp/mailspring.rpm', 'rpm');
      await resolveLastSpawnSuccessfully();
      await promise;
      expect(spawnSpy).toHaveBeenCalledWith(
        'pkexec',
        ['zypper', 'install', '-y', '/tmp/mailspring.rpm'],
        { stdio: 'ignore' }
      );
    });

    it('falls back to `pkexec rpm -Uvh` as a last resort when neither dnf nor zypper is present', async () => {
      openPathSpy.andReturn(Promise.resolve('No application registered'));
      existsSyncSpy.andReturn(false);
      const promise = installPackage('/tmp/mailspring.rpm', 'rpm');
      await resolveLastSpawnSuccessfully();
      await promise;
      expect(spawnSpy).toHaveBeenCalledWith('pkexec', ['rpm', '-Uvh', '/tmp/mailspring.rpm'], {
        stdio: 'ignore',
      });
    });

    it('surfaces (does not swallow) a failure from shell.openPath followed by a failed pkexec fallback', async () => {
      openPathSpy.andReturn(Promise.resolve('No application registered'));
      let caught: Error | null = null;
      const promise = installPackage('/tmp/mailspring.deb', 'deb').catch((err) => {
        caught = err as Error;
      });
      await rejectLastSpawn(1);
      await promise;
      expect(caught).not.toBeNull();
    });
  });
});
