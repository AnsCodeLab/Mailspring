/* eslint global-require: 0*/
import { dialog, nativeImage } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { localized } from '../intl';
import type Config from '../config';

let autoUpdater = null;

const IdleState = 'idle';
const CheckingState = 'checking';
const DownloadingState = 'downloading';
const UpdateAvailableState = 'update-available';
const NoUpdateAvailableState = 'no-update-available';
const UnsupportedState = 'unsupported';
const ErrorState = 'error';

// This fork's own GitHub Releases, not upstream Foundry376/Mailspring's
// production update server. A public, unauthenticated, IP-rate-limited (60
// req/hr) REST endpoint - plenty for a 30-minute poll interval. Always
// returns 200 for the latest published release (or 404 if none has ever
// been published); "is there a newer version" is determined client-side by
// comparing `tag_name` against the running app's version, not by a
// server-side 204/200 status contract like the old feed used.
const GITHUB_RELEASES_FEED_URL =
  'https://api.github.com/repos/AnsCodeLab/Mailspring/releases/latest';

export default class AutoUpdateManager extends EventEmitter {
  state = IdleState;
  version: string;
  config: Config;
  specMode: boolean;
  feedURL: string;
  releaseNotes: string;
  releaseVersion: string;

  constructor(version: string, config: Config, specMode: boolean) {
    super();

    this.version = version;
    this.config = config;
    this.specMode = specMode;

    this.updateFeedURL();
    this.config.onDidChange('identity.id', this.updateFeedURL);

    setTimeout(() => this.setupAutoUpdater(), 0);
  }

  updateFeedURL = () => {
    // The GitHub Releases API takes no platform/arch/version/id/channel
    // query params - it's a single static endpoint that always returns the
    // latest published release. Kept as an arrow field re-invoked from
    // `config.onDidChange('identity.id', ...)` (rather than also ripping
    // out that listener wiring) even though the resulting URL no longer
    // varies with `identity.id` - simpler than touching that wiring for a
    // single-issue fix.
    this.feedURL = GITHUB_RELEASES_FEED_URL;
    if (autoUpdater) {
      autoUpdater.setFeedURL(this.feedURL);
    }
  };

  setupAutoUpdater() {
    // No macOS release channel exists for this fork (no `build-macos` job
    // in release.yaml, per this issue's own Non-goals) and the pre-#18
    // darwin branch below wires up Electron's built-in Squirrel.Mac
    // `autoUpdater`, which expects the old feed's `204`/`200 + {url, name,
    // notes, pub_date}` response shape - not the GitHub Releases JSON
    // `updateFeedURL()` now points at. Bail out before ever reaching that
    // branch so darwin stays on #18's protection while win32/linux get the
    // real fix.
    if (process.platform === 'darwin') {
      this.setState(UnsupportedState);
      return;
    }

    if (process.platform === 'win32') {
      const Impl = require('./autoupdate-impl-win32').default;
      autoUpdater = new Impl(this.version);
    } else {
      const Impl = require('./autoupdate-impl-base').default;
      autoUpdater = new Impl(this.version);
    }

    autoUpdater.on('error', (error) => {
      if (this.specMode) return;
      console.error(`Error Downloading Update: ${error.message}`);
      this.setState(ErrorState);
    });

    autoUpdater.setFeedURL(this.feedURL);

    autoUpdater.on('checking-for-update', () => {
      this.setState(CheckingState);
    });

    autoUpdater.on('update-not-available', () => {
      this.setState(NoUpdateAvailableState);
    });

    autoUpdater.on('update-available', () => {
      this.setState(DownloadingState);
    });

    autoUpdater.on(
      'update-downloaded',
      (_event: Electron.Event, releaseNotes: string, releaseVersion: string) => {
        this.releaseNotes = releaseNotes;
        this.releaseVersion = releaseVersion;
        this.setState(UpdateAvailableState);
        this.emitUpdateAvailableEvent();
      }
    );

    if (autoUpdater.supportsUpdates && !autoUpdater.supportsUpdates()) {
      this.setState(UnsupportedState);
      return;
    }

    //check immediately at startup
    this.check({ hidePopups: true });

    //check every 30 minutes
    setInterval(
      () => {
        if ([UpdateAvailableState, UnsupportedState].includes(this.state)) {
          console.log('Skipping update check... update ready to install, or updater unavailable.');
          return;
        }
        this.check({ hidePopups: true });
      },
      1000 * 60 * 30
    );
  }

  emitUpdateAvailableEvent() {
    if (!this.releaseVersion) {
      return;
    }
    global.application.windowManager.sendToAllWindows(
      'update-available',
      {},
      this.getReleaseDetails()
    );
  }

  setState(state: string) {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.emit('state-changed', this.state);
  }

  getState() {
    return this.state;
  }

  getReleaseDetails() {
    return {
      releaseVersion: this.releaseVersion,
      releaseNotes: this.releaseNotes,
    };
  }

  check({ hidePopups }: { hidePopups?: boolean } = {}) {
    this.updateFeedURL();
    if (!autoUpdater) {
      console.error('AutoUpdateManager.check called with no autoUpdater configured.');
      return;
    }
    if (!hidePopups) {
      autoUpdater.once('update-not-available', this.onUpdateNotAvailable);
      autoUpdater.once('error', this.onUpdateError);
    }
    autoUpdater.checkForUpdates();
  }

  install() {
    if (!autoUpdater) {
      console.error('AutoUpdateManager.install called with no autoUpdater configured.');
      return;
    }
    autoUpdater.quitAndInstall();
  }

  dialogIcon() {
    const iconPath = path.join(
      global.application.resourcePath,
      'static',
      'images',
      'mailspring.png'
    );
    if (!fs.existsSync(iconPath)) return undefined;
    return nativeImage.createFromPath(iconPath);
  }

  onUpdateNotAvailable = () => {
    autoUpdater.removeListener('error', this.onUpdateError);
    dialog.showMessageBox({
      type: 'info',
      buttons: [localized('OK')],
      icon: this.dialogIcon(),
      message: localized('No update available.'),
      title: localized('No update available.'),
      detail: localized(`You're running the latest version of Mailspring (%@).`, this.version),
    });
  };

  onUpdateError = (event: Electron.Event, message: string) => {
    autoUpdater.removeListener('update-not-available', this.onUpdateNotAvailable);
    dialog.showMessageBox({
      type: 'warning',
      buttons: [localized('OK')],
      icon: this.dialogIcon(),
      message: localized('There was an error checking for updates.'),
      title: localized('Update Error'),
      detail: message,
    });
  };
}
