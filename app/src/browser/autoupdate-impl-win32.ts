import { app, shell } from 'electron';
import os from 'os';
import path from 'path';
import AutoupdateImplBase, {
  GitHubReleaseAsset,
  RELEASES_PAGE_URL,
  safeHttpUrl,
} from './autoupdate-impl-base';
import { downloadFile } from './download-file';

export default class AutoupdateImplWin32 extends AutoupdateImplBase {
  // No longer gated on WindowsUpdater.existsSync(): this fork's
  // release.yaml never publishes the RELEASES manifest + .nupkg that
  // Squirrel's Update.exe needs (only MailspringSetup.exe), so
  // Update.exe's presence is irrelevant to the download+shell.openPath
  // install flow used below.
  supportsUpdates() {
    return true;
  }

  protected selectAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | null {
    return assets.find((asset) => asset.name.toLowerCase().endsWith('.exe')) ?? null;
  }

  /* Public: Download the installer, then coordinate app exit before
   * launching it. Squirrel.Windows' Setup.exe, run standalone, auto-launches
   * the newly installed exe with no confirmation dialog when it finishes -
   * doing that while this process is still alive and holding
   * app.requestSingleInstanceLock() reproduces a bug this codebase has
   * already hit and fixed once (see windows-updater.js's restartMailspring,
   * which calls app.quit() before spawning the next instance for exactly
   * this reason): the newly auto-launched process would hit the lock and
   * immediately exit, silently leaving the old version running. Mirror that
   * fix - only launch the installer from a `will-quit` handler, once
   * app.quit() has begun releasing the lock. */
  async quitAndInstall() {
    const downloadUrl = safeHttpUrl(this.lastSelectedAsset?.browser_download_url);
    if (!this.lastSelectedAsset || !downloadUrl) {
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

    app.once('will-quit', () => {
      // The app is already tearing down at this point - there's no
      // meaningful way to surface a rejection back to the user, but avoid
      // leaving a dangling unhandled promise rejection during shutdown.
      shell.openPath(destPath).catch(() => {});
    });
    app.quit();
  }
}
