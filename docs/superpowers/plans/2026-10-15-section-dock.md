# Section Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dock (Mail / Calendar / Contacts / ⋯) at the bottom of the main window's left column switches the whole window between sections in place.

**Architecture:** A new `SectionStore` owns the active section. Switching selects that section's root sheet, swaps its top-level menus, and runs the section's `onEnter`. Calendar and Contacts load in the main window as root sheets that share the `RootSidebar` column. A `SectionSidebar` component in that column renders the active section's panel, with the `SectionDock` pinned below it. Inactive sections are unmounted, so their `document.body` command handlers detach.

**Tech Stack:** Electron, TypeScript, React 16 class components, Reflux-style `MailspringStore`, Jasmine 1.x specs run by `npm test` (Electron).

**Spec:** `docs/superpowers/specs/2026-10-15-section-dock-design.md` (issue #30)

## Global Constraints

- Section shortcuts: `mod+1` Mail, `mod+2` Calendar, `mod+3` Contacts.
- Account selection `window:select-account-0..8`: `mod+alt+1..9`.
- Calendar views `calendar:view-day/week/month/agenda`: `mod+shift+1..4`.
- The app always starts in Mail; the section is not persisted.
- The separate Calendar and Contacts windows keep working (`application:show-calendar-window`, `application:show-contacts-window`).
- No `any`; all new user-facing strings go through `localized()`.
- Comment style per `CLAUDE.md`: current behaviour and rationale only.
- Run specs with `npm test` from the repo root. Run `npm run typecheck` and `npm run lint:check` before every commit.

## Deviations from the spec (found while planning)

1. **Menus.** `account-commands.ts:registerMenuItems` rewrites the Window submenu at runtime, so the spec's "snapshot base template once" would drop account items. `SectionStore` instead *stashes* the section's hidden top-level menus (with their indexes) and splices the section menu in after `Edit`. On return to Mail it removes the section menu and re-inserts the stashed menus. `Window` is never hidden, so account edits survive.
2. **Keymap conflicts.** `KeymapManager` dispatches every command bound to a keystroke (`keymap-manager.ts:283-289`), and calendar/contacts handlers exist only while mounted. Shared keys like `up`/`down`, `mod+shift+r` and `mod+t` therefore don't collide across sections. The overlap test covers only commands handled at the same time: section switching, account selection, and calendar views.
3. **Contacts sync.** No sync-engine contacts message exists, and `run-contact-sync` (`application.ts:459`) has no receiver. The sender is deleted. Contacts has no `onEnter` sync; the engine syncs contacts on its own schedule.

---

## File Structure

| File | Responsibility |
|---|---|
| Create `app/src/flux/stores/section-store.ts` | Section registry, the active section, root-sheet switching, menu stash, section commands, `select-section` IPC |
| Modify `app/src/flux/actions.ts` | `selectSection` action |
| Modify `app/src/global/mailspring-exports.{js,d.ts}` | Export `SectionStore` and its types |
| Modify `app/src/flux/stores/focused-perspective-store.ts` | Root-sheet switching only in Mail; `g c` goes to Contacts |
| Create `app/internal_packages/section-dock/` | `SectionSidebar` (at `RootSidebar`), `SectionDock`, styles |
| Modify `account-sidebar/lib/main.ts`, `notifications/lib/main.ts` | Register under role `SectionSidebar:mail` |
| Create `main-calendar/lib/calendar-view-store.ts` | Shared `focusedMoment` between the sidebar panel and the calendar view |
| Create `main-calendar/lib/core/calendar-sidebar-panel.tsx` | Calendar list plus mini-month for the shared column |
| Modify `main-calendar/lib/main.tsx`, `core/mailspring-calendar.tsx`, `package.json`, `keymaps/calendar.json` | Main-window activation; panel extraction; view keys |
| Modify `contacts/lib/main.tsx`, `contacts/lib/Store.ts`, `package.json` | Main-window activation; `displayWindow` moved to the contacts window |
| Modify `app/keymaps/base.json`, `account-sidebar/lib/account-commands.ts` | Section and account keys |
| Modify `app/src/browser/application.ts`, `app/menus/{darwin,linux,win32}.js` | Entry points; Window menu items |
| Create specs: `app/spec/stores/section-store-spec.ts`, `app/spec/section-keymap-spec.ts` | Behaviour tests |
| Modify `app/spec/stores/focused-perspective-store-spec.ts` | Perspective guard test |
| Modify `CHANGELOG.md` | Shortcut changes and the in-place sections |

---

### Task 1: `SectionStore` and `Actions.selectSection`

**Files:**
- Create: `app/src/flux/stores/section-store.ts`
- Modify: `app/src/flux/actions.ts` (after `selectRootSheet`, ~line 206)
- Modify: `app/src/global/mailspring-exports.js:157`, `app/src/global/mailspring-exports.d.ts:145`
- Test: `app/spec/stores/section-store-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SectionId = string; // 'mail' | 'calendar' | 'contacts' | overflow ids
  export interface SectionDeclaration {
    id: SectionId;
    title: string;                 // localized
    icon: React.ComponentType;     // dock icon
    rootSheet: () => SheetDeclaration; // resolved lazily; mail returns the remembered sheet
    menu?: IMenuItem;              // top-level menu shown while active
    hiddenMenuIds?: string[];      // top-level menu ids removed while active
    onEnter?: () => void;
    overflow?: boolean;            // listed under ⋯ instead of as an icon
    openInNewWindowCommand?: string; // e.g. 'application:show-calendar-window'
  }
  SectionStore.registerSection(decl: SectionDeclaration): { dispose(): void }
  SectionStore.sections(): SectionDeclaration[]   // registration order, mail first
  SectionStore.current(): SectionId
  Actions.selectSection(id: SectionId): void
  ```

- [ ] **Step 1: Write the failing spec** `app/spec/stores/section-store-spec.ts`

```ts
import { Actions, WorkspaceStore } from 'mailspring-exports';
import SectionStore from '../../src/flux/stores/section-store';

describe('SectionStore', function () {
  let disposables: { dispose(): void }[];
  let calendarSheet;
  let savedTemplate;

  beforeEach(function () {
    disposables = [];
    savedTemplate = AppEnv.menu.template;
    AppEnv.menu.template = [
      { id: 'Edit', label: 'Edit', submenu: [] },
      { id: 'View', label: 'View', submenu: [] },
      { id: 'Thread', label: 'Thread', submenu: [] },
      { id: 'Window', label: 'Window', submenu: [{ label: 'Account A', account: true }] },
    ];
    spyOn(AppEnv.menu, 'update');
    WorkspaceStore.defineSheet('SectionSpecCalendar', { root: true, silent: true } as any, {
      list: ['RootSidebar'],
    });
    calendarSheet = WorkspaceStore.Sheet.SectionSpecCalendar;
    SectionStore._resetForSpecs();
    Actions.selectRootSheet(WorkspaceStore.Sheet.Threads);
  });

  afterEach(function () {
    disposables.forEach((d) => d.dispose());
    SectionStore._resetForSpecs();
    WorkspaceStore.undefineSheet('SectionSpecCalendar');
    AppEnv.menu.template = savedTemplate;
  });

  function registerCalendar(extra = {}) {
    const decl = {
      id: 'calendar',
      title: 'Calendar',
      icon: () => null,
      rootSheet: () => calendarSheet,
      menu: { id: 'Calendar', label: 'Calendar', submenu: [] },
      hiddenMenuIds: ['Thread', 'View'],
      ...extra,
    };
    disposables.push(SectionStore.registerSection(decl));
    return decl;
  }

  it('starts in mail', function () {
    expect(SectionStore.current()).toBe('mail');
  });

  it('selects the section root sheet', function () {
    registerCalendar();
    SectionStore._onSelectSection('calendar');
    expect(SectionStore.current()).toBe('calendar');
    expect(WorkspaceStore.rootSheet()).toBe(calendarSheet);
  });

  it('restores the mail root sheet that was active before leaving mail', function () {
    registerCalendar();
    WorkspaceStore.defineSheet('SectionSpecDrafts', { root: true, silent: true } as any, {
      list: ['RootSidebar'],
    });
    Actions.selectRootSheet(WorkspaceStore.Sheet.SectionSpecDrafts);
    SectionStore._onSelectSection('calendar');
    SectionStore._onSelectSection('mail');
    expect(WorkspaceStore.rootSheet()).toBe(WorkspaceStore.Sheet.SectionSpecDrafts);
    WorkspaceStore.undefineSheet('SectionSpecDrafts');
  });

  it('ignores selecting the active section', function () {
    const decl = registerCalendar({ onEnter: jasmine.createSpy('onEnter') });
    SectionStore._onSelectSection('calendar');
    SectionStore._onSelectSection('calendar');
    expect(decl.onEnter.callCount).toBe(1);
  });

  it('ignores unknown sections', function () {
    spyOn(console, 'warn');
    SectionStore._onSelectSection('nope');
    expect(SectionStore.current()).toBe('mail');
  });

  it('hides section menus, inserts the section menu after Edit, and restores on return', function () {
    registerCalendar();
    SectionStore._onSelectSection('calendar');
    expect(AppEnv.menu.template.map((m) => m.id)).toEqual(['Edit', 'Calendar', 'Window']);

    // Window submenu is rewritten at runtime by account-commands; the edit must survive.
    AppEnv.menu.template.find((m) => m.id === 'Window').submenu = [{ label: 'Account B' }];

    SectionStore._onSelectSection('mail');
    expect(AppEnv.menu.template.map((m) => m.id)).toEqual(['Edit', 'View', 'Thread', 'Window']);
    expect(AppEnv.menu.template.find((m) => m.id === 'Window').submenu[0].label).toBe('Account B');
  });

  it('switching between two non-mail sections restores menus before hiding again', function () {
    registerCalendar();
    disposables.push(
      SectionStore.registerSection({
        id: 'contacts',
        title: 'Contacts',
        icon: () => null,
        rootSheet: () => calendarSheet,
        menu: { id: 'Contact', label: 'Contact', submenu: [] },
        hiddenMenuIds: ['Thread', 'View'],
      })
    );
    SectionStore._onSelectSection('calendar');
    SectionStore._onSelectSection('contacts');
    expect(AppEnv.menu.template.map((m) => m.id)).toEqual(['Edit', 'Contact', 'Window']);
    SectionStore._onSelectSection('mail');
    expect(AppEnv.menu.template.map((m) => m.id)).toEqual(['Edit', 'View', 'Thread', 'Window']);
  });

  it('returns to mail when the active section is unregistered', function () {
    const decl = registerCalendar();
    SectionStore._onSelectSection('calendar');
    disposables.pop().dispose();
    expect(SectionStore.current()).toBe('mail');
    expect(SectionStore.sections().map((s) => s.id)).not.toContain(decl.id);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL. `section-store` cannot be resolved.

- [ ] **Step 3: Add the action** in `app/src/flux/actions.ts`, after `selectRootSheet`:

```ts
/*
  Public: Switch the main window to a top-level section (mail, calendar, contacts).

  *Scope: Window*
  */
export const selectSection = create('selectSection', ActionScopeWindow);
```

- [ ] **Step 4: Implement** `app/src/flux/stores/section-store.ts`

```ts
import React from 'react';
import { ipcRenderer } from 'electron';
import MailspringStore from 'mailspring-store';
import * as Actions from '../actions';
import WorkspaceStore from './workspace-store';
import { IMenuItem } from '../../menu-helpers';

type SheetDeclaration = ReturnType<typeof WorkspaceStore.rootSheet>;

export type SectionId = string;

export interface SectionDeclaration {
  id: SectionId;
  title: string;
  icon: React.ComponentType;
  rootSheet: () => SheetDeclaration;
  menu?: IMenuItem;
  hiddenMenuIds?: string[];
  onEnter?: () => void;
  overflow?: boolean;
  openInNewWindowCommand?: string;
}

interface StashedMenu {
  index: number;
  item: IMenuItem;
}

/**
 * Owns which top-level section the main window shows. Mail is always registered and is the
 * section at startup; calendar and contacts register themselves when their packages activate
 * in the main window.
 *
 * Menus are stashed rather than rebuilt from a snapshot because account-commands rewrites the
 * Window submenu at runtime; only the section's own hidden menus are removed and restored.
 */
class SectionStore extends MailspringStore {
  private _sections: SectionDeclaration[] = [];
  private _current: SectionId = 'mail';
  private _mailRootSheet: SheetDeclaration | null = null;
  private _stashedMenus: StashedMenu[] = [];
  private _insertedMenuId: string | null = null;

  constructor() {
    super();
    this._sections = [this._mailSection()];
    this.listenTo(Actions.selectSection, this._onSelectSection);

    if (AppEnv.isMainWindow()) {
      AppEnv.commands.add(document.body, {
        'navigation:section-mail': () => Actions.selectSection('mail'),
        'navigation:section-calendar': () => Actions.selectSection('calendar'),
        'navigation:section-contacts': () => Actions.selectSection('contacts'),
      });
      ipcRenderer.on('select-section', (_event, id: SectionId) => Actions.selectSection(id));
    }
  }

  current() {
    return this._current;
  }

  sections() {
    return this._sections;
  }

  registerSection(decl: SectionDeclaration) {
    this._sections = [...this._sections.filter((s) => s.id !== decl.id), decl];
    this.trigger();
    return {
      dispose: () => {
        if (this._current === decl.id) {
          this._onSelectSection('mail');
        }
        this._sections = this._sections.filter((s) => s !== decl);
        this.trigger();
      },
    };
  }

  _mailSection(): SectionDeclaration {
    return {
      id: 'mail',
      title: 'Mail',
      icon: () => null,
      rootSheet: () => this._mailRootSheet || WorkspaceStore.Sheet.Threads,
    };
  }

  /** Replaces the placeholder mail declaration with the dock's real title and icon. */
  setMailPresentation(title: string, icon: React.ComponentType) {
    this._sections = this._sections.map((s) => (s.id === 'mail' ? { ...s, title, icon } : s));
    this.trigger();
  }

  _onSelectSection = (id: SectionId) => {
    if (id === this._current) {
      return;
    }
    const target = this._sections.find((s) => s.id === id);
    if (!target) {
      console.warn(`SectionStore: unknown section "${id}"`);
      return;
    }

    if (this._current === 'mail') {
      this._mailRootSheet = WorkspaceStore.rootSheet();
    }

    this._restoreMenus();
    this._current = id;
    Actions.selectRootSheet(target.rootSheet());
    this._applyMenus(target);
    target.onEnter?.();
    this.trigger();
  };

  _applyMenus(section: SectionDeclaration) {
    if (!section.menu && !section.hiddenMenuIds?.length) {
      return;
    }
    const template = AppEnv.menu.template;
    const hidden = new Set(section.hiddenMenuIds || []);
    this._stashedMenus = template
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => hidden.has(item.id));
    const kept = template.filter((item) => !hidden.has(item.id));
    if (section.menu) {
      const editIndex = kept.findIndex((item) => item.id === 'Edit');
      kept.splice(editIndex + 1, 0, section.menu);
      this._insertedMenuId = section.menu.id;
    }
    AppEnv.menu.template = kept;
    AppEnv.menu.update();
  }

  _restoreMenus() {
    if (!this._insertedMenuId && this._stashedMenus.length === 0) {
      return;
    }
    const template = AppEnv.menu.template.filter((item) => item.id !== this._insertedMenuId);
    for (const { index, item } of this._stashedMenus) {
      template.splice(Math.min(index, template.length), 0, item);
    }
    this._stashedMenus = [];
    this._insertedMenuId = null;
    AppEnv.menu.template = template;
    AppEnv.menu.update();
  }

  _resetForSpecs() {
    this._restoreMenus();
    this._sections = [this._mailSection()];
    this._current = 'mail';
    this._mailRootSheet = null;
  }
}

export default new SectionStore();
```

- [ ] **Step 5: Export it.** In `mailspring-exports.js`, after the `FocusedPerspectiveStore` line:

```js
load(`SectionStore`, 'flux/stores/section-store');
```

In `mailspring-exports.d.ts`, after the `FocusedPerspectiveStore` export:

```ts
export type SectionStore = typeof import('../flux/stores/section-store').default;
export const SectionStore: SectionStore;
export type { SectionDeclaration, SectionId } from '../flux/stores/section-store';
```

- [ ] **Step 6: Run the specs and confirm they pass**

Run: `npm test`
Expected: every `SectionStore` spec PASSES. If `WorkspaceStore.Sheet.Threads` is undefined because the spec window is not the main window, define it in `beforeEach` with `WorkspaceStore.defineSheet('Threads', { root: true, silent: true } as any, { list: ['RootSidebar'] })` instead.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint:check
git add app/src/flux/stores/section-store.ts app/src/flux/actions.ts app/src/global/mailspring-exports.js app/src/global/mailspring-exports.d.ts app/spec/stores/section-store-spec.ts
git commit -m "feat(sections): SectionStore owns the main window's active section (#30)"
```

---

### Task 2: The perspective store yields to sections

**Files:**
- Modify: `app/src/flux/stores/focused-perspective-store.ts:41-59,187-197`
- Test: `app/spec/stores/focused-perspective-store-spec.ts` (new `describe` block)

**Interfaces:**
- Consumes: `SectionStore.current()` and `Actions.selectSection` from Task 1.

- [ ] **Step 1: Write the failing spec.** Append inside the top-level `describe`:

```ts
  describe('_setPerspective while another section is active', function () {
    it('does not change the root sheet outside mail', function () {
      const SectionStore = require('../../src/flux/stores/section-store').default;
      spyOn(SectionStore, 'current').andReturn('calendar');
      spyOn(Actions, 'selectRootSheet');
      FocusedPerspectiveStore._setPerspective(this.userPerspective);
      expect(Actions.selectRootSheet).not.toHaveBeenCalled();
    });
  });
```

Add `import * as Actions from '../../src/flux/actions';` to the spec imports.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL. `selectRootSheet` is called.

- [ ] **Step 3: Implement.** In `_setPerspective`, replace lines 187-197 with:

```ts
    // While Calendar or Contacts is showing, the mail perspective still updates (sidebar
    // selection, saved state) but must not pull the window back to a mail sheet.
    if (SectionStore.current() !== 'mail') {
      return;
    }

    const desired = perspective.sheet();

    // Always switch to the correct sheet and pop to root when perspective set
    if (desired && WorkspaceStore.rootSheet() !== desired) {
      Actions.selectRootSheet(desired);
    }

    const top = WorkspaceStore.topSheet();
    if (![WorkspaceStore.Sheet.Preferences, WorkspaceStore.Sheet.Threads].includes(top)) {
      Actions.popToRootSheet();
    }
```

Add `import SectionStore from './section-store';` to the imports.

In `_listenToCommands`, make every mail navigation command return to Mail first, and implement `g c`:

```ts
  _listenToCommands() {
    const inMail = (fn: () => void) => () => {
      Actions.selectSection('mail');
      fn();
    };
    AppEnv.commands.add(document.body, {
      'navigation:go-to-inbox': inMail(() => this._setPerspectiveByName('inbox')),
      'navigation:go-to-sent': inMail(() => this._setPerspectiveByName('sent')),
      'navigation:go-to-starred': inMail(() =>
        this._setPerspective(MailboxPerspective.forStarred(this._current.accountIds))
      ),
      'navigation:go-to-drafts': inMail(() =>
        this._setPerspective(MailboxPerspective.forDrafts(this._current.accountIds))
      ),
      'navigation:go-to-all': inMail(() => {
        const categories = this._current.accountIds.map((id) =>
          CategoryStore.getArchiveCategory(id)
        );
        this._setPerspective(MailboxPerspective.forCategories(categories));
      }),
      'navigation:go-to-contacts': () => Actions.selectSection('contacts'),
      'navigation:go-to-tasks': () => {}, // TODO,
      'navigation:go-to-label': () => {}, // TODO,
    });
  }
```

Clicking a mail folder in the sidebar is only possible while in Mail (the folder tree is the Mail panel), so `_setPerspective` itself needs no section switch.

- [ ] **Step 4: Run the specs and confirm they pass**

Run: `npm test`
Expected: PASS, and the existing `FocusedPerspectiveStore` specs still pass.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint:check
git add app/src/flux/stores/focused-perspective-store.ts app/spec/stores/focused-perspective-store-spec.ts
git commit -m "feat(sections): mail perspective changes no longer override other sections (#30)"
```

---

### Task 3: Shortcuts

**Files:**
- Modify: `app/keymaps/base.json:36-44`
- Modify: `app/internal_packages/account-sidebar/lib/account-commands.ts:43` (`accelerator`)
- Modify: `app/internal_packages/main-calendar/keymaps/calendar.json:10-13`
- Test: `app/spec/section-keymap-spec.ts`

**Interfaces:**
- Produces the keystrokes in Global Constraints. The command names `navigation:section-mail|calendar|contacts` are handled by `SectionStore` (Task 1).

- [ ] **Step 1: Write the failing spec** `app/spec/section-keymap-spec.ts`

```ts
import fs from 'fs';
import path from 'path';

// These commands have handlers on document.body at the same time (sections and accounts
// always; calendar views whenever Calendar is showing), and KeymapManager dispatches every
// command bound to a keystroke, so sharing a keystroke would fire both.
const SIMULTANEOUS = /^(navigation:section-|window:select-account-|calendar:view-)/;

function bindings(file: string): Record<string, string | string[]> {
  return JSON.parse(fs.readFileSync(path.join(AppEnv.getLoadSettings().resourcePath, file), 'utf8'));
}

describe('section keymaps', function () {
  const merged: Record<string, string[]> = {};
  beforeEach(function () {
    for (const file of [
      'keymaps/base.json',
      'internal_packages/main-calendar/keymaps/calendar.json',
    ]) {
      for (const [command, keys] of Object.entries(bindings(file))) {
        merged[command] = (merged[command] || []).concat(keys);
      }
    }
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL. The section bindings are undefined and `mod+1` is shared.

- [ ] **Step 3: Implement.** In `keymaps/base.json`, replace lines 36-44 with:

```json
  "navigation:section-mail": "mod+1",
  "navigation:section-calendar": "mod+2",
  "navigation:section-contacts": "mod+3",
  "window:select-account-0": "mod+alt+1",
  "window:select-account-1": "mod+alt+2",
  "window:select-account-2": "mod+alt+3",
  "window:select-account-3": "mod+alt+4",
  "window:select-account-4": "mod+alt+5",
  "window:select-account-5": "mod+alt+6",
  "window:select-account-6": "mod+alt+7",
  "window:select-account-7": "mod+alt+8",
  "window:select-account-8": "mod+alt+9",
```

In `account-commands.ts`:

```ts
    item.accelerator = `CmdOrCtrl+Alt+${idx + 1}`;
```

In `calendar.json`:

```json
  "calendar:view-day": "mod+shift+1",
  "calendar:view-week": "mod+shift+2",
  "calendar:view-month": "mod+shift+3",
  "calendar:view-agenda": "mod+shift+4",
```

- [ ] **Step 4: Check the keymap templates** for any `mod+1..3`, `mod+alt+1..9` or `mod+shift+1..4` use: `grep -n 'mod+\(alt+\|shift+\)\?[0-9]' app/keymaps/templates/*.json`. The expected matches are only `mod+shift+7/8/9` (composer lists), which don't conflict.

- [ ] **Step 5: Run the specs, including `keymap-templates-spec.ts` and `keymap-manager-spec.ts`, and confirm they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/keymaps/base.json app/internal_packages/account-sidebar/lib/account-commands.ts app/internal_packages/main-calendar/keymaps/calendar.json app/spec/section-keymap-spec.ts
git commit -m "feat(sections): mod+1/2/3 switch sections; accounts move to mod+alt, calendar views to mod+shift (#30)"
```

---

### Task 4: `section-dock` package (SectionSidebar and SectionDock)

**Files:**
- Create: `app/internal_packages/section-dock/package.json`
- Create: `app/internal_packages/section-dock/lib/main.ts`
- Create: `app/internal_packages/section-dock/lib/section-sidebar.tsx`
- Create: `app/internal_packages/section-dock/lib/section-dock.tsx`
- Create: `app/internal_packages/section-dock/lib/section-icons.tsx`
- Create: `app/internal_packages/section-dock/styles/section-dock.less`
- Modify: `app/internal_packages/account-sidebar/lib/main.ts:6`
- Modify: `app/internal_packages/notifications/lib/main.ts:26-27`

**Interfaces:**
- Consumes: `SectionStore.sections()`, `.current()`, `.setMailPresentation()`, and `Actions.selectSection` (Task 1).
- Produces: role `SectionSidebar:<sectionId>`. Section panels register with `ComponentRegistry.register(Panel, { role: 'SectionSidebar:calendar' })`.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "section-dock",
  "version": "0.1.0",
  "main": "./lib/main",
  "description": "Mail / Calendar / Contacts dock at the bottom of the main window sidebar",
  "license": "GPL-3.0",
  "private": true,
  "syncInit": true,
  "engines": {
    "mailspring": "*"
  },
  "windowTypes": {
    "default": true
  }
}
```

- [ ] **Step 2: `lib/section-icons.tsx`.** Line icons that draw in `currentColor`, so themes control them:

```tsx
import React from 'react';

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const MailIcon = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="14" rx="1.5" />
    <path d="M3.5 6l8.5 7 8.5-7" />
  </Svg>
);
MailIcon.displayName = 'MailIcon';

export const CalendarIcon = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="16" rx="1.5" />
    <path d="M3 10h18M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2" />
  </Svg>
);
CalendarIcon.displayName = 'CalendarIcon';

export const ContactsIcon = () => (
  <Svg>
    <circle cx="12" cy="8.5" r="4" />
    <path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6" />
  </Svg>
);
ContactsIcon.displayName = 'ContactsIcon';

export const MoreIcon = () => (
  <Svg>
    <circle cx="6" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="18" cy="12" r="1" />
  </Svg>
);
MoreIcon.displayName = 'MoreIcon';
```

- [ ] **Step 3: `lib/section-dock.tsx`**

```tsx
import React from 'react';
import { ipcRenderer } from 'electron';
import { Actions, SectionStore, localized } from 'mailspring-exports';
import type { SectionDeclaration } from 'mailspring-exports';
import { MoreIcon } from './section-icons';

const SHORTCUT_COMMANDS: Record<string, string> = {
  mail: 'navigation:section-mail',
  calendar: 'navigation:section-calendar',
  contacts: 'navigation:section-contacts',
};

function tooltip(section: SectionDeclaration) {
  const command = SHORTCUT_COMMANDS[section.id];
  const keys = command ? AppEnv.keymaps.getBindingsForCommand(command) : [];
  return keys.length ? `${section.title} (${keys[0]})` : section.title;
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

export function SectionDock({ sections, current }: { sections: SectionDeclaration[]; current: string }) {
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
```

`AppEnv.keymaps.getBindingsForCommand(command)` exists (`keymap-manager.ts:342`). The preferences formatter (`command-item.tsx:_formatKeystrokes`) is a private method, so the tooltip does its own minimal display mapping: on macOS `mod`→`⌘` and `shift`→`⇧`; elsewhere `mod`→`Ctrl` and `shift`→`Shift`. Each key is capitalised (e.g. `Ctrl+2`).

- [ ] **Step 4: `lib/section-sidebar.tsx`.** The single component at `RootSidebar`, carrying the width bounds `AccountSidebar` used to provide:

```tsx
import React from 'react';
import { DOMUtils, SectionStore } from 'mailspring-exports';
import { InjectedComponentSet } from 'mailspring-component-kit';
import { SectionDock } from './section-dock';

interface State {
  current: string;
  sections: ReturnType<typeof SectionStore.sections>;
}

export class SectionSidebar extends React.Component<Record<string, unknown>, State> {
  static displayName = 'SectionSidebar';
  static containerRequired = false;
  static containerStyles = {
    minWidth: DOMUtils.getWorkspaceCssNumberProperty('account-sidebar-min-width', 165),
    maxWidth: DOMUtils.getWorkspaceCssNumberProperty('account-sidebar-max-width', 250),
  };

  state = this._getState();
  _unlisten?: () => void;

  componentDidMount() {
    this._unlisten = SectionStore.listen(() => this.setState(this._getState()));
  }

  componentWillUnmount() {
    this._unlisten?.();
  }

  _getState(): State {
    return { current: SectionStore.current(), sections: SectionStore.sections() };
  }

  render() {
    const { current, sections } = this.state;
    const section = sections.find((s) => s.id === current);
    return (
      <div className={`section-sidebar section-sidebar-${current}`}>
        <h2 className="section-sidebar-title">{section?.title}</h2>
        <InjectedComponentSet
          key={current}
          className="section-sidebar-panel"
          direction="column"
          containersRequired={false}
          matching={{ role: `SectionSidebar:${current}` }}
        />
        <SectionDock sections={sections} current={current} />
      </div>
    );
  }
}
```

- [ ] **Step 5: `lib/main.ts`**

```ts
import { ComponentRegistry, SectionStore, WorkspaceStore, localized } from 'mailspring-exports';
import { SectionSidebar } from './section-sidebar';
import { MailIcon } from './section-icons';

export function activate() {
  SectionStore.setMailPresentation(localized('Mail'), MailIcon);
  ComponentRegistry.register(SectionSidebar, { location: WorkspaceStore.Location.RootSidebar });
}

export function deactivate() {
  ComponentRegistry.unregister(SectionSidebar);
}
```

`CalendarIcon` and `ContactsIcon` are exported for the calendar and contacts packages through `section-icons.tsx`. Those packages can't import from another package's `lib`, so **move `section-icons.tsx` to `app/src/components/section-icons.tsx`** and export the icons from `mailspring-component-kit` (add three `lazyLoad` lines to `app/src/global/mailspring-component-kit.js` and matching declarations to its `.d.ts`, following the neighbouring entries). Every package then imports `{ MailIcon, CalendarIcon, ContactsIcon, MoreIcon } from 'mailspring-component-kit'`.

- [ ] **Step 6: Move the mail panel into the role.**

`account-sidebar/lib/main.ts:6`:

```ts
  ComponentRegistry.register(AccountSidebar, { role: 'SectionSidebar:mail' });
```

`notifications/lib/main.ts:26-27`:

```ts
  ComponentRegistry.register(ActivitySidebar, { role: 'SectionSidebar:mail' });
  ComponentRegistry.register(NotifWrapper, { role: 'SectionSidebar:mail' });
```

Remove `containerStyles` from `AccountSidebar` (`account-sidebar.tsx:24-27`): the width now comes from `SectionSidebar`, and a role-rendered component's `containerStyles` would have no effect.

- [ ] **Step 7: `styles/section-dock.less`**

```less
@import 'ui-variables';

.section-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: @source-list-bg;

  .section-sidebar-title {
    margin: 0;
    padding: 10px 12px 6px;
    font-size: 1.15em;
    font-weight: 600;
    color: @text-color;
  }

  .section-sidebar-panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
}

.section-dock {
  display: flex;
  flex-shrink: 0;
  border-top: 1px solid @border-color-divider;

  .section-dock-item {
    flex: 1;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: @text-color-subtle;
    cursor: default;

    &:hover {
      color: @text-color;
      background: fade(@text-color, 5%);
    }

    &.active {
      color: @component-active-color;
      border-bottom-color: @component-active-color;
    }

    &:focus-visible {
      outline: 2px solid @component-active-color;
      outline-offset: -2px;
    }
  }
}
```

Mail's title is redundant with the existing account switcher at the top of `AccountSidebar`, so hide it for Mail only: `.section-sidebar-mail .section-sidebar-title { display: none; }`. That is a visual call, not a behaviour change.

- [ ] **Step 8: Manual check.** Run `npm start`, then look and click:
  - The mail sidebar looks unchanged apart from the dock at the bottom.
  - The dock shows only ✉ until Tasks 5 and 6 land.
  - Notifications (e.g. offline) still appear in the sidebar.
  - The column still resizes.

- [ ] **Step 9: Commit**

```bash
npm run typecheck && npm run lint:check
git add app/internal_packages/section-dock app/src/components/section-icons.tsx app/src/global/mailspring-component-kit.* app/internal_packages/account-sidebar app/internal_packages/notifications
git commit -m "feat(sections): section sidebar with bottom dock in the main window (#30)"
```

---

### Task 5: Calendar as an in-place section

**Files:**
- Create: `app/internal_packages/main-calendar/lib/calendar-view-store.ts`
- Create: `app/internal_packages/main-calendar/lib/core/calendar-sidebar-panel.tsx`
- Modify: `app/internal_packages/main-calendar/lib/core/mailspring-calendar.tsx` (state `focusedMoment`, the `_focusEvent` / `onChangeFocusedMoment` handlers at :239-245, render at :939-961)
- Modify: `app/internal_packages/main-calendar/lib/main.tsx` (whole file: `Notice`, `adjustMenus`, `activate`, `deactivate`)
- Modify: `app/internal_packages/main-calendar/package.json`
- Test: `app/spec/calendar-view-store-spec.ts`

**Interfaces:**
- Consumes: `SectionStore.registerSection`, `CalendarIcon` (from the component kit), and the `MailsyncBridge` reached through `AppEnv.mailsyncBridge.sendSyncCalendarNow()`.
- Produces:
  ```ts
  CalendarViewStore.focusedMoment(): Moment
  CalendarViewStore.setFocusedMoment(m: Moment): void   // triggers listeners
  ```

- [ ] **Step 1: Write the failing spec** `app/spec/calendar-view-store-spec.ts`

```ts
import moment from 'moment';
import { CalendarViewStore } from '../internal_packages/main-calendar/lib/calendar-view-store';

describe('CalendarViewStore', function () {
  it('notifies listeners when the focused moment changes', function () {
    const listener = jasmine.createSpy('listener');
    const unlisten = CalendarViewStore.listen(listener);
    const target = moment('2026-10-20T09:00:00');
    CalendarViewStore.setFocusedMoment(target);
    expect(CalendarViewStore.focusedMoment().isSame(target)).toBe(true);
    expect(listener).toHaveBeenCalled();
    unlisten();
  });

  it('does not notify when set to the same moment', function () {
    const target = moment('2026-10-21T09:00:00');
    CalendarViewStore.setFocusedMoment(target);
    const listener = jasmine.createSpy('listener');
    const unlisten = CalendarViewStore.listen(listener);
    CalendarViewStore.setFocusedMoment(moment(target));
    expect(listener).not.toHaveBeenCalled();
    unlisten();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL (module not found).

- [ ] **Step 3: `lib/calendar-view-store.ts`**

```ts
import moment, { Moment } from 'moment';
import MailspringStore from 'mailspring-store';

/**
 * The date the calendar is focused on. The section sidebar's mini-month and the calendar
 * view render in different columns, so they share this instead of component state.
 */
class CalendarViewStoreImpl extends MailspringStore {
  private _focusedMoment: Moment = moment();

  focusedMoment() {
    return this._focusedMoment;
  }

  setFocusedMoment(m: Moment) {
    if (m.isSame(this._focusedMoment)) {
      return;
    }
    this._focusedMoment = m;
    this.trigger();
  }
}

export const CalendarViewStore = new CalendarViewStoreImpl();
```

- [ ] **Step 4: Run the spec and confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: `lib/core/calendar-sidebar-panel.tsx`.** Calendar list plus mini-month, owning its own calendar, account and config subscription:

```tsx
import React from 'react';
import { Moment } from 'moment';
import { Rx, DatabaseStore, AccountStore, Calendar, Account } from 'mailspring-exports';
import { ScrollRegion, MiniMonthView } from 'mailspring-component-kit';
import { CalendarSourceList } from './calendar-source-list';
import { CalendarViewStore } from '../calendar-view-store';

const DISABLED_CALENDARS = 'mailspring.disabledCalendars';

interface State {
  accounts: Account[];
  calendars: Calendar[];
  disabledCalendars: string[];
  focusedMoment: Moment;
}

export class CalendarSidebarPanel extends React.Component<Record<string, unknown>, State> {
  static displayName = 'CalendarSidebarPanel';

  state: State = {
    accounts: AccountStore.accounts(),
    calendars: [],
    disabledCalendars: AppEnv.config.get(DISABLED_CALENDARS) || [],
    focusedMoment: CalendarViewStore.focusedMoment(),
  };

  _subscription?: { dispose(): void };
  _unlisten?: () => void;

  componentDidMount() {
    this._subscription = Rx.Observable.combineLatest(
      Rx.Observable.fromQuery(DatabaseStore.findAll<Calendar>(Calendar)),
      Rx.Observable.fromStore(AccountStore),
      Rx.Observable.fromConfig<string[] | undefined>(DISABLED_CALENDARS)
    ).subscribe(([calendars, accountStore, disabled]) =>
      this.setState({
        calendars,
        accounts: accountStore.accounts(),
        disabledCalendars: disabled || [],
      })
    );
    this._unlisten = CalendarViewStore.listen(() =>
      this.setState({ focusedMoment: CalendarViewStore.focusedMoment() })
    );
  }

  componentWillUnmount() {
    this._subscription?.dispose();
    this._unlisten?.();
  }

  render() {
    return (
      <div className="calendar-sidebar-panel">
        <ScrollRegion style={{ flex: 1 }}>
          <CalendarSourceList
            accounts={this.state.accounts}
            calendars={this.state.calendars}
            disabledCalendars={this.state.disabledCalendars}
          />
        </ScrollRegion>
        <MiniMonthView
          value={this.state.focusedMoment}
          onChange={(m) => CalendarViewStore.setFocusedMoment(m)}
        />
      </div>
    );
  }
}
```

Add `.calendar-sidebar-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }` to `main-calendar/styles/main-calendar.less`. The mini-month sits directly above the dock because the panel fills the column and the `ScrollRegion` takes up the remaining space.

- [ ] **Step 6: Wire `MailspringCalendar` to the store.**
  - `constructor`: `focusedMoment: CalendarViewStore.focusedMoment(),`
  - `componentDidMount`: add `this._unlistenView = CalendarViewStore.listen(() => this.setState({ focusedMoment: CalendarViewStore.focusedMoment(), focusedEvent: null }));`
  - `componentWillUnmount`: add `this._unlistenView?.();`
  - Declare `_unlistenView?: () => void;` next to `_unlisten`.
  - Replace `onChangeFocusedMoment` (:239-241) with:

```ts
  onChangeFocusedMoment = (focusedMoment: Moment) => {
    CalendarViewStore.setFocusedMoment(focusedMoment);
  };
```

  - Replace `_focusEvent` (:243-245) with:

```ts
  _focusEvent = (event: FocusedEventInfo) => {
    CalendarViewStore.setFocusedMoment(moment(event.start * 1000));
    this.setState({ focusedEvent: event });
  };
```

  - In the store listener, keep `focusedEvent` when the change came from `_focusEvent`: set `focusedEvent` after the store call, so the listener's `focusedEvent: null` runs first and `setState({ focusedEvent: event })` wins. React batches both inside the same handler.
  - `onChangeView` (:230-235) also sets `focusedMoment` in state. Change it to call `CalendarViewStore.setFocusedMoment(focusedMoment)` and keep `this.setState({ view, dragState: null })`.
  - Render: in the main window the panel lives in the section sidebar, so render the internal region only in the calendar window. Replace lines 939-961 with:

```tsx
          {AppEnv.getWindowType() === 'calendar' && this.state.calendarListVisible && (
            <ResizableRegion
              className="calendar-source-list"
              initialWidth={200}
              minWidth={200}
              maxWidth={300}
              handle={ResizableRegion.Handle.Right}
              style={{ flexDirection: 'column' }}
            >
              <CalendarSidebarPanel />
            </ResizableRegion>
          )}
```

  - Remove the now-unused `MiniMonthView`, `ScrollRegion` and `CalendarSourceList` imports. `state.accounts` and `state.calendars` are still used by the views and the empty state, so they stay.

- [ ] **Step 7: `main.tsx`.** Main-window activation with no menu mutation and no `Notice`:

```tsx
import React from 'react';
import {
  WorkspaceStore,
  ComponentRegistry,
  SectionStore,
  localized,
} from 'mailspring-exports';
import { CalendarIcon } from 'mailspring-component-kit';
import { QuickEventButton } from './quick-event-button';
import { MailspringCalendar } from './core/mailspring-calendar';
import { EventSearchBar } from './core/event-search-bar';
import { CalendarSidebarPanel } from './core/calendar-sidebar-panel';

function calendarMenu(): (typeof AppEnv.menu.template)[0] {
  return {
    id: 'Calendar',
    label: localized('Calendar'),
    submenu: [
      { label: localized('New Event'), command: 'core:add-item' },
      { type: 'separator' },
      { label: localized('Delete Event'), command: 'core:delete-item' },
      { type: 'separator' },
      { label: localized('By Day'), command: 'calendar:view-day' },
      { label: localized('By Week'), command: 'calendar:view-week' },
      { label: localized('By Month'), command: 'calendar:view-month' },
      { label: localized('Agenda'), command: 'calendar:view-agenda' },
      { type: 'separator' },
      { label: localized('Go to Today'), command: 'calendar:go-to-today' },
      { label: localized('Next'), command: 'calendar:navigate-next' },
      { label: localized('Previous'), command: 'calendar:navigate-previous' },
      { type: 'separator' },
      { label: localized('Find Events') + '...', command: 'core:focus-search' },
      { type: 'separator' },
      { label: localized('Refresh Calendars'), command: 'calendar:refresh-calendars' },
    ],
  };
}

const HIDDEN_MENUS = ['Thread', 'View'];

let _section: { dispose(): void } | null = null;

function activateInCalendarWindow() {
  const template = AppEnv.menu.template.filter((item) => !HIDDEN_MENUS.includes(item.id));
  template.splice(template.findIndex((item) => item.id === 'Edit') + 1, 0, calendarMenu());
  AppEnv.menu.template = template;
  AppEnv.menu.update();

  ComponentRegistry.register(MailspringCalendar, { location: WorkspaceStore.Location.Center });
  ComponentRegistry.register(QuickEventButton, { location: WorkspaceStore.Location.Center.Toolbar });
  ComponentRegistry.register(EventSearchBar, { location: WorkspaceStore.Location.Center.Toolbar });
}

function activateInMainWindow() {
  WorkspaceStore.defineSheet(
    'Calendar',
    { root: true },
    {
      list: ['RootSidebar', 'CalendarContent'],
      split: ['RootSidebar', 'CalendarContent'],
      splitVertical: ['RootSidebar', 'CalendarContent'],
    }
  );
  ComponentRegistry.register(MailspringCalendar, { location: WorkspaceStore.Location.CalendarContent });
  ComponentRegistry.register(QuickEventButton, {
    location: WorkspaceStore.Location.CalendarContent.Toolbar,
  });
  ComponentRegistry.register(EventSearchBar, {
    location: WorkspaceStore.Location.CalendarContent.Toolbar,
  });
  ComponentRegistry.register(CalendarSidebarPanel, { role: 'SectionSidebar:calendar' });

  _section = SectionStore.registerSection({
    id: 'calendar',
    title: localized('Calendar'),
    icon: CalendarIcon,
    rootSheet: () => WorkspaceStore.Sheet.Calendar,
    menu: calendarMenu(),
    hiddenMenuIds: HIDDEN_MENUS,
    onEnter: () => AppEnv.mailsyncBridge.sendSyncCalendarNow(),
    openInNewWindowCommand: 'application:show-calendar-window',
  });
}

export function activate() {
  if (AppEnv.getWindowType() === 'calendar') {
    activateInCalendarWindow();
  } else {
    activateInMainWindow();
  }
}

export function deactivate() {
  ComponentRegistry.unregister(MailspringCalendar);
  ComponentRegistry.unregister(QuickEventButton);
  ComponentRegistry.unregister(EventSearchBar);
  ComponentRegistry.unregister(CalendarSidebarPanel);
  _section?.dispose();
  _section = null;
  if (WorkspaceStore.Sheet.Calendar) {
    WorkspaceStore.undefineSheet('Calendar');
  }
}
```

Check before writing:
- The `defineSheet` call must not auto-select. It doesn't: `Threads` is already root (`workspace-store.ts:338`).
- `AppEnv.mailsyncBridge` is how `event-rsvp-task.ts:119` reaches the bridge, so it is valid here.
- `React` stays imported only if JSX remains in the file; otherwise drop it.

- [ ] **Step 8: `package.json` windowTypes**

```json
  "windowTypes": {
    "default": true,
    "calendar": true
  }
```

- [ ] **Step 9: Run the specs and confirm they pass**

Run: `npm test`
Expected: PASS, including the existing calendar specs (`calendar-*-spec.ts`, `mini-month-view-spec.tsx`).

- [ ] **Step 10: Manual check** with `npm start`:
  - Click 📅. The left column shows "Calendar", the calendar list, and the mini-month above the dock. The center shows the week view, and the toolbar shows the quick-event button and search.
  - Clicking a mini-month day moves the week view.
  - The menu bar shows Calendar instead of Thread and View.
  - `mod+shift+2` switches to week view.
  - Click ✉: back to the same inbox and thread, with the Thread and View menus restored.
  - Developer → Calendar Preview still opens the separate window, with the calendar list inside it.

- [ ] **Step 11: Commit**

```bash
npm run typecheck && npm run lint:check
git add app/internal_packages/main-calendar app/spec/calendar-view-store-spec.ts
git commit -m "feat(sections): calendar switches in place in the main window (#30)"
```

---

### Task 6: Contacts as an in-place section

**Files:**
- Modify: `app/internal_packages/contacts/lib/main.tsx` (`adjustMenus` :17-64, `activate` :66-130, `deactivate` :132-142)
- Modify: `app/internal_packages/contacts/lib/Store.ts:27-28`
- Modify: `app/internal_packages/contacts/package.json`

**Interfaces:**
- Consumes: `SectionStore.registerSection` and `ContactsIcon`.

- [ ] **Step 1: `Store.ts`.** Remove `AppEnv.displayWindow();` from the constructor's `requestAnimationFrame` callback; the store no longer decides window visibility.

- [ ] **Step 2: `main.tsx`.** Turn `adjustMenus()` into `contactMenu()`, which returns the existing `contactMenu` object unchanged (lines 18-54). Then split `activate()`:

```tsx
const HIDDEN_MENUS = ['Thread', 'View'];
let _section: { dispose(): void } | null = null;

function registerContactsComponents(sidebarLocation: { role: string } | { location: unknown }) {
  ComponentRegistry.register(ContactPerspectivesList, sidebarLocation);
  ComponentRegistry.register(FoundInMailEnabledBar, { location: WorkspaceStore.Location.ContactsList });
  ComponentRegistry.register(ContactList, { location: WorkspaceStore.Location.ContactsList });
  ComponentRegistry.register(ContactListSearch, {
    location: WorkspaceStore.Location.ContactsList.Toolbar,
  });
  ComponentRegistry.register(ContactDetail, { location: WorkspaceStore.Location.ContactsDetail });
  ComponentRegistry.register(ContactDetailToolbar, {
    location: WorkspaceStore.Location.ContactsDetail.Toolbar,
  });
}

export function activate() {
  _commandDisposable = AppEnv.commands.add(document.body, {
    /* existing 'contacts:import-vcf' and 'contacts:export-vcf-all' handlers, unchanged */
  });

  if (AppEnv.getWindowType() === 'contacts') {
    WorkspaceStore.defineSheet(
      'Contacts',
      { root: true },
      { split: ['ContactsSidebar', 'ContactsList', 'ContactsDetail'] }
    );
    const template = AppEnv.menu.template.filter((item) => !HIDDEN_MENUS.includes(item.id));
    template.splice(template.findIndex((item) => item.id === 'Edit') + 1, 0, contactMenu());
    AppEnv.menu.template = template;
    AppEnv.menu.update();
    Actions.selectRootSheet(WorkspaceStore.Sheet.Contacts);
    registerContactsComponents({ location: WorkspaceStore.Location.ContactsSidebar });
    ComponentRegistry.register(AddContactToolbar, {
      location: WorkspaceStore.Location.ContactsSidebar.Toolbar,
    });
    window.requestAnimationFrame(() => AppEnv.displayWindow());
    return;
  }

  WorkspaceStore.defineSheet(
    'Contacts',
    { root: true },
    {
      list: ['RootSidebar', 'ContactsList', 'ContactsDetail'],
      split: ['RootSidebar', 'ContactsList', 'ContactsDetail'],
      splitVertical: ['RootSidebar', 'ContactsList', 'ContactsDetail'],
    }
  );
  registerContactsComponents({ role: 'SectionSidebar:contacts' });
  // The shared sidebar column has no per-section toolbar, so "add contact" sits in the list toolbar.
  ComponentRegistry.register(AddContactToolbar, {
    location: WorkspaceStore.Location.ContactsList.Toolbar,
  });
  _section = SectionStore.registerSection({
    id: 'contacts',
    title: localized('Contacts'),
    icon: ContactsIcon,
    rootSheet: () => WorkspaceStore.Sheet.Contacts,
    menu: contactMenu(),
    hiddenMenuIds: HIDDEN_MENUS,
    openInNewWindowCommand: 'application:show-contacts-window',
  });
}
```

In `deactivate()`, add `_section?.dispose(); _section = null;` and `if (WorkspaceStore.Sheet.Contacts) WorkspaceStore.undefineSheet('Contacts');`.

Import `SectionStore` from `mailspring-exports` and `ContactsIcon` from `mailspring-component-kit`.

Check that `ContactPerspectivesList` fills the column's height. It uses `.contacts-perspective-list` with `@source-list-bg` (`index.less:3-6`). If it doesn't fill, add `flex: 1; min-height: 0;` under `.section-sidebar-contacts .contacts-perspective-list`.

- [ ] **Step 3: `package.json` windowTypes**

```json
  "windowTypes": {
    "default": true,
    "contacts": true
  }
```

- [ ] **Step 4: Run the specs** (`vcf-helpers-spec.ts`, `contact-store-spec.ts`, and the full suite)

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Manual check** with `npm start`:
  - Click 👤. The left column shows "Contacts" and the perspectives list. The center shows the list and detail.
  - The menu bar shows Contact.
  - `core:delete-item` (Delete Contact) deletes a contact and never a thread.
  - `mod+1` returns to Mail.
  - Window → Contacts behaviour is finished in Task 7.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint:check
git add app/internal_packages/contacts
git commit -m "feat(sections): contacts switch in place in the main window (#30)"
```

---

### Task 7: Application entry points and menus

**Files:**
- Modify: `app/src/browser/application.ts:444-462`
- Modify: `app/menus/darwin.js:225,243-256`, `app/menus/linux.js:194,211-224`, `app/menus/win32.js:171,189-202`

**Interfaces:**
- Consumes: the main-window `select-section` IPC listener (Task 1).
- Produces: `application:show-calendar-window` and `application:show-contacts-window`.

- [ ] **Step 1: `application.ts`.** Replace lines 444-462 with:

```ts
    this.on('application:show-calendar', () => this.showSection('calendar'));
    this.on('application:show-contacts', () => this.showSection('contacts'));

    this.on('application:show-calendar-window', () => {
      this.windowManager.ensureWindow(WindowManager.CALENDAR_WINDOW, {});
      this.sendCalendarSync();
    });

    // The calendar window's MailsyncBridge has no sync clients, so a manual
    // refresh has to be routed through the main window's bridge.
    this.on('application:sync-calendar', (accountId?: string) => {
      this.sendCalendarSync(accountId);
    });

    this.on('application:show-contacts-window', () => {
      this.windowManager.ensureWindow(WindowManager.CONTACTS_WINDOW, {});
    });
```

Add a method next to `sendCalendarSync`:

```ts
  showSection(id: 'calendar' | 'contacts') {
    const main = this.windowManager.get(WindowManager.MAIN_WINDOW);
    if (main) {
      main.show();
      main.focus();
      main.sendMessage('select-section', id);
    }
  }
```

`MailspringWindow` has `show()` (`mailspring-window.ts:467`) and `focus()` (`:486`).

The `run-contact-sync` sender goes away with the old handler. Nothing received it (spec deviation 3).

- [ ] **Step 2: Menus.** In each of the three platform menu files:
  - Delete the `{ label: localized('Calendar Preview'), command: 'application:show-calendar' },` line and its now-duplicate adjacent separator.
  - In the `Window` submenu, replace the existing Contacts item with:

```js
        { label: localized('Mail'), command: 'navigation:section-mail' },
        { label: localized('Calendar'), command: 'navigation:section-calendar' },
        { label: localized('Contacts'), command: 'navigation:section-contacts' },
        { type: 'separator' },
        { label: localized('Open Calendar in New Window'), command: 'application:show-calendar-window' },
        { label: localized('Open Contacts in New Window'), command: 'application:show-contacts-window' },
```

The `navigation:section-*` items are enabled only where `SectionStore` registered them (the main window), because `MenuManager.update` enables a non-`application:` item only when it has listeners (`menu-manager.ts:63-84`). In the separate windows they show disabled, which is correct.

- [ ] **Step 3: Run the specs** (`menu-manager-spec.ts` and the full suite)

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Manual check** with `npm start`:
  - Window → Calendar and Window → Contacts switch in place.
  - Window → Open Calendar in New Window opens the old window.
  - Preferences → Accounts → the contacts link (`preferences-account-details.tsx:179`) switches the main window to Contacts.
  - Right-click 📅 in the dock → Open in New Window works.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint:check
git add app/src/browser/application.ts app/menus
git commit -m "feat(sections): calendar/contacts commands switch in place; separate windows on demand (#30)"
```

---

### Task 8: Changelog, full verification, close-out

**Files:**
- Modify: `CHANGELOG.md` (top, unreleased section, matching the existing format)

- [ ] **Step 1: Changelog entry**

```markdown
- **Section dock:** Mail, Calendar and Contacts now switch in place from a dock at the bottom of the left sidebar (also Window menu, Ctrl/Cmd+1/2/3). Right-click a dock icon to open Calendar or Contacts in a separate window.
- **Shortcut changes:** account selection moved from Ctrl/Cmd+1…9 to Ctrl/Cmd+Alt+1…9; calendar Day/Week/Month/Agenda moved to Ctrl/Cmd+Shift+1…4.
```

- [ ] **Step 2: Full suite, typecheck, lint**

Run: `npm run typecheck && npm run lint:check && npm test`
Expected: all green.

- [ ] **Step 3: Smoke run** with `npm start`, in each layout mode (Preferences → Appearance: Single Panel, Two Panel, Two Panel Vertical):
  - Mail → Calendar → Contacts → Mail through the dock, then again through `mod+1/2/3`. The thread and folder selection survive the round trip.
  - The menus match each section.
  - In Calendar: create an event with the quick-event button, then delete it with Delete. Confirm no thread was trashed (check that the Trash count is unchanged).
  - In Contacts: edit a contact.
  - Restart the app: it opens in Mail.
  - Open in New Window works for both sections.
  - Resize the sidebar narrow and wide: the dock icons stay centred and the mini-month fits.

- [ ] **Step 4: Commit, push, update the issue**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for section dock (#30)"
git push origin master
gh issue comment 30 -R AnsCodeLab/Mailspring --body "Implemented per docs/superpowers/plans/2026-10-15-section-dock.md"
```

## Self-Review

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | §1 SectionStore | 1 |
  | §2 perspective store | 2 |
  | §3 root sheets | 5, 6 |
  | §4 shared column | 4 (mail), 5 (calendar panel), 6 (contacts panel) |
  | §5 dock | 4 |
  | §6 keymaps | 3 (`g c` in 2) |
  | §7 entry points | 7 |
  | Changelog | 8 |
  | Error handling: unknown id | 1 (spec) |
  | Error handling: disabled package | Never registers, so the dock omits it (no code needed) |

  The contacts sync and menu-snapshot changes are recorded under Deviations.
- **Types:** `SectionDeclaration` fields (`id`, `title`, `icon`, `rootSheet`, `menu`, `hiddenMenuIds`, `onEnter`, `overflow`, `openInNewWindowCommand`) are used the same way in Tasks 1, 4, 5 and 6. `CalendarViewStore.focusedMoment` / `setFocusedMoment` match between Tasks 5 Step 3 and Step 6.
- **Remaining check:** whether `WorkspaceStore.Sheet.Threads` exists in the spec window (Task 1 Step 6). The step gives the fallback.
