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
   * already hit and fixed once (see windows-updater.js's restartMailspring).
   *
   * restartMailspring's fix isn't just "do it in a will-quit handler" -
   * it specifically uses a synchronous, detached, stdio-ignored spawn
   * (spawnDetached), because that file's own comment documents that
   * async/piped operations started during `will-quit` can be cut off
   * mid-flight when the event loop tears down; Electron does not wait for
   * a `will-quit` listener's returned promise before proceeding to exit.
   * `shell.openPath()` is async and Promise-returning, so the same risk
   * applies here unless quitting is explicitly held open: call
   * `event.preventDefault()` inside the handler to cancel the default
   * quit-now behavior, launch the installer, and only force-terminate via
   * `app.exit()` once that promise has actually settled - never relying on
   * `shell.openPath()` merely being *called* before teardown completes. */
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

    app.once('will-quit', (event) => {
      event.preventDefault();
      shell
        .openPath(destPath)
        .catch(() => {})
        .finally(() => app.exit());
    });
    app.quit();
  }
}
