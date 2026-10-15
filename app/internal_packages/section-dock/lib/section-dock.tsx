import React from 'react';
import { ipcRenderer } from 'electron';
import { Actions, localized } from 'mailspring-exports';
import type { SectionDeclaration } from 'mailspring-exports';
import { MoreIcon } from 'mailspring-component-kit';

const SHORTCUT_COMMANDS: Record<string, string> = {
  mail: 'navigation:section-mail',
  calendar: 'navigation:section-calendar',
  contacts: 'navigation:section-contacts',
};

const MAC_MODIFIERS: Record<string, string> = { mod: '⌘', shift: '⇧', alt: '⌥' };
const OTHER_MODIFIERS: Record<string, string> = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' };

// The preferences keymap formatter is private to its component, so the dock maps the
// few modifiers its own bindings use: macOS glyphs (⌘2), spelled-out elsewhere (Ctrl+2).
export function formatKeystroke(keystroke: string, platform: string = process.platform) {
  const isMac = platform === 'darwin';
  const modifiers = isMac ? MAC_MODIFIERS : OTHER_MODIFIERS;
  const parts = keystroke
    .split('+')
    .map((part) => modifiers[part] || part.charAt(0).toUpperCase() + part.slice(1));
  return parts.join(isMac ? '' : '+');
}

function tooltip(section: SectionDeclaration) {
  const command = SHORTCUT_COMMANDS[section.id];
  const keys: string[] = command ? AppEnv.keymaps.getBindingsForCommand(command) : [];
  return keys.length ? `${section.title} (${formatKeystroke(keys[0])})` : section.title;
}

function showContextMenu(section: SectionDeclaration) {
  if (!section.openInNewWindowCommand) {
    return;
  }
  const { Menu, MenuItem } = require('@electron/remote');
  const menu = new Menu();
  menu.append(
    new MenuItem({
      label: localized('Open in New Window'),
      click: () => ipcRenderer.send('command', section.openInNewWindowCommand),
    })
  );
  menu.popup({});
}

function showOverflowMenu(sections: SectionDeclaration[]) {
  const { Menu, MenuItem } = require('@electron/remote');
  const menu = new Menu();
  for (const section of sections) {
    menu.append(
      new MenuItem({ label: section.title, click: () => Actions.selectSection(section.id) })
    );
  }
  menu.popup({});
}

export function SectionDock({
  sections,
  current,
}: {
  sections: SectionDeclaration[];
  current: string;
}) {
  const docked = sections.filter((s) => !s.overflow);
  const overflow = sections.filter((s) => s.overflow);

  return (
    <nav className="section-dock" role="tablist" aria-label={localized('Sections')}>
      {docked.map((section) => {
        const Icon = section.icon;
        const active = section.id === current;
        return (
          <button
            key={section.id}
            role="tab"
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            className={`section-dock-item${active ? ' active' : ''}`}
            title={tooltip(section)}
            onClick={() => Actions.selectSection(section.id)}
            onContextMenu={() => showContextMenu(section)}
          >
            <Icon />
          </button>
        );
      })}
      {overflow.length > 0 && (
        <button
          className="section-dock-item section-dock-more"
          title={localized('More')}
          aria-haspopup="menu"
          onClick={() => showOverflowMenu(overflow)}
        >
          <MoreIcon />
        </button>
      )}
    </nav>
  );
}
