import fs from 'fs';
import { spawn } from 'child_process';
import { shell } from 'electron';

export type PackageFormat = 'deb' | 'rpm';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/**
 * Detects which package format this Linux install uses by probing for the
 * package manager binary each format's release asset expects. Returns
 * `null` on AppImage-only/immutable distros with neither — callers should
 * fall back to `shell.openExternal` to the releases page in that case.
 */
export function detectPackageFormat(): PackageFormat | null {
  if (fs.existsSync('/usr/bin/dpkg')) return 'deb';
  if (fs.existsSync('/usr/bin/rpm')) return 'rpm';
  return null;
}

/**
 * Picks the release asset matching `format` by filename suffix (not a
 * hardcoded filename), so a changed build-number segment in this repo's
 * published rpm naming (e.g. `mailspring-<version>-0.1.x86_64.rpm`) can't
 * break asset selection.
 */
export function selectAssetForFormat(
  assets: ReleaseAsset[],
  format: PackageFormat
): ReleaseAsset | null {
  const suffix = `.${format}`;
  return assets.find((asset) => asset.name.toLowerCase().endsWith(suffix)) ?? null;
}

function runPkexec(args: string[]): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn('pkexec', args, { stdio: 'ignore' });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`pkexec ${args.join(' ')} exited with code ${code}`));
    }
  });
  return promise;
}

// `pkexec` always shows a visible polkit authentication dialog regardless of
// which command runs underneath it, so even a wrong guess here fails
// visibly rather than silently — the invariant that matters is "never run a
// privileged command invisibly", not "always guess the right one".
async function installViaPkexec(filePath: string, format: PackageFormat): Promise<void> {
  if (format === 'deb') {
    await runPkexec(['dpkg', '-i', filePath]);
    return;
  }
  if (fs.existsSync('/usr/bin/dnf')) {
    await runPkexec(['dnf', 'install', '-y', filePath]);
  } else if (fs.existsSync('/usr/bin/zypper')) {
    await runPkexec(['zypper', 'install', '-y', filePath]);
  } else {
    await runPkexec(['rpm', '-Uvh', filePath]);
  }
}

/**
 * Installs a downloaded package. Tries handing it off to the OS's package
 * install GUI first (`shell.openPath` — typically opens GNOME
 * Software/Discover/etc. with one confirmation click); if that hand-off
 * fails (a non-empty error string return, per Electron's API), falls back
 * to a `pkexec`-driven CLI install so the user still gets a one-click
 * (well, one-`pkexec`-prompt) install path.
 */
export async function installPackage(filePath: string, format: PackageFormat): Promise<void> {
  const openError = await shell.openPath(filePath);
  if (!openError) {
    return;
  }
  await installViaPkexec(filePath, format);
}
