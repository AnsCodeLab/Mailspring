import AutoUpdateManager from '../src/browser/autoupdate-manager';

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

  describe('with attached commit version', () =>
    it('correctly sets the feedURL', function () {
      const m = new AutoUpdateManager('3.222.1-abc', this.config, this.specMode);
      spyOn(m, 'setupAutoUpdater');
      expect(m.feedURL).toEqual(
        'https://updates.getmailspring.com/check/' +
          process.platform +
          '/' +
          process.arch +
          '/3.222.1-abc/anonymous/stable'
      );
    }));

  describe('with no attached commit', () =>
    it('correctly sets the feedURL', function () {
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      spyOn(m, 'setupAutoUpdater');
      expect(m.feedURL).toEqual(
        'https://updates.getmailspring.com/check/' +
          process.platform +
          '/' +
          process.arch +
          '/3.222.1/anonymous/stable'
      );
    }));

  describe('when an update identity is already set', () =>
    it('should send it and not save any changes', function () {
      this.mailspringIdentityId = 'test-mailspring-id';
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      expect(m.feedURL).toEqual(
        'https://updates.getmailspring.com/check/' +
          process.platform +
          '/' +
          process.arch +
          '/3.222.1/test-mailspring-id/stable'
      );
    }));

  describe('when an update identity is added', () =>
    it('should update the feed URL', function () {
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      spyOn(m, 'setupAutoUpdater');
      expect(m.feedURL.includes('anonymous')).toEqual(true);
      this.mailspringIdentityId = 'test-mailspring-id';
      m.updateFeedURL();
      expect(m.feedURL.includes(this.mailspringIdentityId)).toEqual(true);
    }));

  describe('setupAutoUpdater', () =>
    it("sets the state to unsupported and never reaches the update-check/interval code, since this fork points at upstream Foundry376/Mailspring's own update feed (#18)", function () {
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      const realSetupAutoUpdater = m.setupAutoUpdater.bind(m);
      spyOn(m, 'setupAutoUpdater'); // block the constructor's deferred setTimeout(0) auto-invoke
      spyOn(m, 'check');

      realSetupAutoUpdater();

      expect(m.getState()).toEqual('unsupported');
      expect(m.check).not.toHaveBeenCalled();
    }));

  describe('check', () =>
    it('does not throw once the platform updater has been disabled', function () {
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      const realSetupAutoUpdater = m.setupAutoUpdater.bind(m);
      spyOn(m, 'setupAutoUpdater');
      realSetupAutoUpdater();

      expect(() => m.check({ hidePopups: true })).not.toThrow();
    }));

  describe('install', () =>
    it('does not throw once the platform updater has been disabled', function () {
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      const realSetupAutoUpdater = m.setupAutoUpdater.bind(m);
      spyOn(m, 'setupAutoUpdater');
      realSetupAutoUpdater();

      expect(() => m.install()).not.toThrow();
    }));
});
