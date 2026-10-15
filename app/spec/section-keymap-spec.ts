import fs from 'fs';
import path from 'path';

// These commands have handlers on document.body at the same time (sections and accounts
// always; calendar views whenever Calendar is showing), and KeymapManager dispatches every
// command bound to a keystroke, so sharing a keystroke would fire both.
const SIMULTANEOUS = /^(navigation:section-|window:select-account-|calendar:view-)/;

const PLATFORMS = ['darwin', 'linux', 'win32'];

function mergedBindings(platform: string): Record<string, string[]> {
  const { resourcePath } = AppEnv.getLoadSettings();
  const merged: Record<string, string[]> = {};
  for (const relativePath of [
    'keymaps/base.json',
    `keymaps/base-${platform}.json`,
    'internal_packages/main-calendar/keymaps/calendar.json',
    `internal_packages/main-calendar/keymaps/calendar-${platform}.json`,
  ]) {
    const file = fs.readFileSync(path.join(resourcePath, relativePath), 'utf8');
    const bindings: Record<string, string | string[]> = JSON.parse(file);
    for (const [command, keys] of Object.entries(bindings)) {
      merged[command] = (merged[command] || []).concat(keys);
    }
  }
  return merged;
}

describe('section keymaps', function () {
  it('binds sections to mod+1/2/3', function () {
    for (const platform of PLATFORMS) {
      const merged = mergedBindings(platform);
      expect(merged['navigation:section-mail']).toEqual(['mod+1']);
      expect(merged['navigation:section-calendar']).toEqual(['mod+2']);
      expect(merged['navigation:section-contacts']).toEqual(['mod+3']);
    }
  });

  // cmd+shift+3/4 are the macOS screenshot shortcuts.
  it('binds calendar views to ctrl+cmd+1..4 on macOS and mod+shift+1..4 elsewhere', function () {
    const views = ['day', 'week', 'month', 'agenda'];
    for (const platform of PLATFORMS) {
      const merged = mergedBindings(platform);
      views.forEach((view, idx) => {
        const expected = platform === 'darwin' ? `ctrl+command+${idx + 1}` : `mod+shift+${idx + 1}`;
        expect(merged[`calendar:view-${view}`]).toEqual([expected]);
      });
    }
  });

  it('never binds one keystroke to two simultaneously handled commands', function () {
    for (const platform of PLATFORMS) {
      const owner: Record<string, string> = {};
      const mod = platform === 'darwin' ? 'command' : 'ctrl';
      for (const [command, keys] of Object.entries(mergedBindings(platform))) {
        if (!SIMULTANEOUS.test(command)) continue;
        // Keystrokes as KeymapManager registers them on this platform.
        for (const key of keys.map((k) => k.replace(/\bmod\b/g, mod))) {
          const label = `${platform} ${key}`;
          expect(owner[key] ? `${label}: ${owner[key]} + ${command}` : label).toBe(label);
          owner[key] = command;
        }
      }
    }
  });
});
