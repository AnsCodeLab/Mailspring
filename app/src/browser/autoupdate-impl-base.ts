import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import { shell } from 'electron';
import { downloadFile } from './download-file';
import { compareVersions } from './version-compare';
import {
  detectPackageFormat,
  installPackage,
  selectAssetForFormat,
} from './linux-package-installer';

// GitHub 403s API requests with no `User-Agent` header at all.
const USER_AGENT = 'Mailspring-AnsCodeLab-Fork';

export const RELEASES_PAGE_URL = 'https://github.com/AnsCodeLab/Mailspring/releases/latest';

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  body: string;
  assets: GitHubReleaseAsset[];
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export default class AutoupdateImplBase extends EventEmitter {
  feedURL: string;
  currentVersion: string;
  lastReleaseNotes = '';
  lastReleaseVersion: string | null = null;
  protected lastSelectedAsset: GitHubReleaseAsset | null = null;

  constructor(currentVersion: string) {
    super();
    this.currentVersion = currentVersion;
  }

  supportsUpdates() {
    // If we're packaged into a Snapcraft distribution, we don't need
    // autoupdates within the app because they're handled transparently.
    if (process.env.SNAP) {
      return false;
    }
    return true;
  }

  /* Public: Set the feed URL where we retrieve update information. */
  setFeedURL(feedURL: string) {
    this.feedURL = feedURL;
  }

  protected emitError = (error: Error) => {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    } else {
      console.error('Autoupdater error (unhandled):', error.message);
    }
  };

  /**
   * Picks the release asset to offer for this platform. Base/Linux
   * implementation detects the installed package format (`deb`/`rpm`) and
   * picks the matching asset; returns `null` (no one-click install
   * available — callers fall back to `shell.openExternal` to the releases
   * page) when no package format could be detected, e.g. on an
   * AppImage-only/immutable distro. Overridden by `AutoupdateImplWin32` to
   * pick the `.exe` asset instead.
   */
  protected selectAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | null {
    const format = detectPackageFormat();
    if (!format) return null;
    return selectAssetForFormat(assets, format);
  }

  /* Hits the GitHub Releases API directly and reports the parsed release
   * (or `false` for "no update available") to `successCallback`. */
  manuallyQueryUpdateServer(successCallback: (release: GitHubRelease | false) => void) {
    fetch(this.feedURL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    })
      .then(async (res) => {
        console.log(`Manual update check (${this.feedURL}) returned ${res.status}`);

        if (res.status === 404) {
          // A fresh fork/repo state where no release has ever been
          // published yet (or the `latest` tag was removed) - this is a
          // normal "no update available" case, not an error.
          successCallback(false);
          return;
        }

        if (!res.ok) {
          this.emitError(new Error(`Autoupdater server returned status ${res.status}`));
          return;
        }

        const json = (await res.json()) as GitHubRelease;
        successCallback(json);
      })
      .catch(this.emitError);
  }

  /* Public: Check for updates and emit events if an update is available. */
  checkForUpdates() {
    if (!this.feedURL) {
      return;
    }

    this.emit('checking-for-update');

    this.manuallyQueryUpdateServer((release) => {
      if (!release) {
        this.emit('update-not-available');
        return;
      }

      const latestVersion = (release.tag_name || '').replace(/^v/, '');
      if (!latestVersion || compareVersions(latestVersion, this.currentVersion) <= 0) {
        this.emit('update-not-available');
        return;
      }

      this.lastReleaseNotes = release.body || '';
      this.lastReleaseVersion = latestVersion;
      this.lastSelectedAsset = this.selectAsset(release.assets || []);

      this.emit('update-downloaded', null, this.lastReleaseNotes, latestVersion);
    });
  }

  /* Public: Download the selected release asset and hand off to the
   * platform-appropriate installer. Falls back to opening the releases page
   * in a browser when no asset could be selected (unsupported package
   * format) or the download itself fails. */
  async quitAndInstall() {
    const format = detectPackageFormat();
    const downloadUrl = safeHttpUrl(this.lastSelectedAsset?.browser_download_url);

    if (!this.lastSelectedAsset || !format || !downloadUrl) {
      shell.openExternal(RELEASES_PAGE_URL);
      return;
    }

    const destPath = path.join(os.tmpdir(), this.lastSelectedAsset.name);
    try {
      await downloadFile(downloadUrl, destPath);
    } catch (err) {
      this.emitError(err as Error);
      shell.openExternal(RELEASES_PAGE_URL);
      return;
    }

    try {
      await installPackage(destPath, format);
    } catch (err) {
      // `pkexec` always shows a visible auth prompt regardless of outcome
      // (see linux-package-installer.ts), so a rejection here means the
      // user saw and dismissed/failed that prompt - surface it as an
      // 'error' event rather than an unhandled promise rejection.
      this.emitError(err as Error);
    }
  }
}
