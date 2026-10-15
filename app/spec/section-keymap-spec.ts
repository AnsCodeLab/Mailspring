import fs from 'fs';
import path from 'path';

// These commands have handlers on document.body at the same time (sections and accounts
// always; calendar views whenever Calendar is showing), and KeymapManager dispatches every
// command bound to a keystroke, so sharing a keystroke would fire both.
const SIMULTANEOUS = /^(navigation:section-|window:select-account-|calendar:view-)/;

function mergedBindings(): Record<string, string[]> {
  const { resourcePath } = AppEnv.getLoadSettings();
  const merged: Record<string, string[]> = {};
  for (const relativePath of [
    'keymaps/base.json',
    'internal_packages/main-calendar/keymaps/calendar.json',
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
  let merged: Record<string, string[]>;
  beforeEach(function () {
    merged = mergedBindings();
  });

  it('binds sections to mod+1/2/3', function () {
    expect(merged['navigation:section-mail']).toEqual(['mod+1']);
    expect(merged['navigation:section-calendar']).toEqual(['mod+2']);
    expect(merged['navigation:section-contacts']).toEqual(['mod+3']);
  });

  it('never binds one keystroke to two simultaneously handled commands', function () {
    const owner: Record<string, string> = {};
    for (const [command, keys] of Object.entries(merged)) {
      if (!SIMULTANEOUS.test(command)) continue;
      for (const key of keys) {
        expect(owner[key] ? `${key}: ${owner[key]} + ${command}` : key).toBe(key);
        owner[key] = command;
      }
    }
  });
});
