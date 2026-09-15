import AutoUpdateManager from '../src/browser/autoupdate-manager';

const GITHUB_FEED_URL = 'https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest';

describe('AutoUpdateManager', function () {
  beforeEach(function () {
    this.mailspringIdentityId = null;
    this.specMode = true;
    this.config = {
      set: jasmine.createSpy('config.set'),
      get: (key) => {
        if (key === 'identity.id') {
          return this.mailspringIdentityId;
        }
        if (key === 'env') {
          return 'production';
        }
      },
      onDidChange: (key, callback) => {
        return callback();
      },
    };
  });

  describe('updateFeedURL', () => {
    it("always points at this fork's own GitHub Releases API endpoint, regardless of platform/arch/version", function () {
      const m = new AutoUpdateManager('3.222.1-abc', this.config, this.specMode);
      spyOn(m, 'setupAutoUpdater');
      expect(m.feedURL).toEqual(GITHUB_FEED_URL);
    });

    it('does not vary by identity.id - the GitHub API takes no such query param', function () {
      this.mailspringIdentityId = 'test-mailspring-id';
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      spyOn(m, 'setupAutoUpdater');
      expect(m.feedURL).toEqual(GITHUB_FEED_URL);

      this.mailspringIdentityId = 'changed-id';
      m.updateFeedURL();
      expect(m.feedURL).toEqual(GITHUB_FEED_URL);
    });
  });

  describe('setupAutoUpdater', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it("sets the state to unsupported and never reaches the update-check code on darwin - there is no macOS release channel (no build-macos job in release.yaml) and the pre-#18 darwin branch wires up Electron's built-in Squirrel.Mac autoUpdater, which is incompatible with the new GitHub-Releases feed response shape", function () {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      const realSetupAutoUpdater = m.setupAutoUpdater.bind(m);
      spyOn(m, 'setupAutoUpdater'); // block the constructor's deferred setTimeout(0) auto-invoke
      spyOn(m, 'check');

      realSetupAutoUpdater();

      expect(m.getState()).toEqual('unsupported');
      expect(m.check).not.toHaveBeenCalled();
    });

    ['linux', 'win32'].forEach((platform) => {
      it(`constructs a real platform updater and proceeds to the initial check on ${platform}, instead of bailing to unsupported like #18's blanket guard did`, function () {
        Object.defineProperty(process, 'platform', { value: platform, configurable: true });
        const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
        const realSetupAutoUpdater = m.setupAutoUpdater.bind(m);
        spyOn(m, 'setupAutoUpdater');
        spyOn(m, 'check');

        realSetupAutoUpdater();

        expect(m.getState()).not.toEqual('unsupported');
        expect(m.check).toHaveBeenCalledWith({ hidePopups: true });
      });
    });
  });

  describe('check', () => {
    it('does not throw when called after setup on the current platform', function () {
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      const realSetupAutoUpdater = m.setupAutoUpdater.bind(m);
      spyOn(m, 'setupAutoUpdater');
      spyOn(m, 'check').andCallThrough();
      realSetupAutoUpdater();

      expect(() => m.check({ hidePopups: true })).not.toThrow();
    });
  });

  describe('install', () => {
    it('does not throw once the platform updater has been constructed', function () {
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      const realSetupAutoUpdater = m.setupAutoUpdater.bind(m);
      spyOn(m, 'setupAutoUpdater');
      spyOn(m, 'check');
      realSetupAutoUpdater();

      expect(() => m.install()).not.toThrow();
    });

    it('does not throw when the platform updater is unsupported (darwin)', function () {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      const realSetupAutoUpdater = m.setupAutoUpdater.bind(m);
      spyOn(m, 'setupAutoUpdater');
      realSetupAutoUpdater();

      expect(() => m.install()).not.toThrow();
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });
});
