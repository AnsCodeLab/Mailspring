import { Actions, WorkspaceStore } from 'mailspring-exports';
import SectionStore, { SectionDeclaration } from '../../src/flux/stores/section-store';
import { SheetDeclaration } from '../../src/flux/stores/workspace-store';

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
      { id: 'Window', label: 'Window', submenu: [{ label: 'Account A' }] },
    ];
    spyOn(AppEnv.menu, 'update');
    // The spec window is not the main window, so thread-list never defines the Threads sheet.
    WorkspaceStore.defineSheet(
      'Threads',
      { root: true, silent: true } as Partial<SheetDeclaration>,
      {
        list: ['RootSidebar'],
      }
    );
    WorkspaceStore.defineSheet(
      'SectionSpecCalendar',
      { root: true, silent: true } as Partial<SheetDeclaration>,
      {
        list: ['RootSidebar'],
      }
    );
    calendarSheet = WorkspaceStore.Sheet.SectionSpecCalendar;
    SectionStore._resetForSpecs();
    Actions.selectRootSheet(WorkspaceStore.Sheet.Threads);
  });

  afterEach(function () {
    disposables.forEach((d) => d.dispose());
    SectionStore._resetForSpecs();
    WorkspaceStore.undefineSheet('SectionSpecCalendar');
    WorkspaceStore.undefineSheet('Threads');
    AppEnv.menu.template = savedTemplate;
  });

  function registerCalendar(extra: Partial<SectionDeclaration> = {}) {
    const decl: SectionDeclaration = {
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
    WorkspaceStore.defineSheet(
      'SectionSpecDrafts',
      { root: true, silent: true } as Partial<SheetDeclaration>,
      {
        list: ['RootSidebar'],
      }
    );
    Actions.selectRootSheet(WorkspaceStore.Sheet.SectionSpecDrafts);
    SectionStore._onSelectSection('calendar');
    SectionStore._onSelectSection('mail');
    expect(WorkspaceStore.rootSheet()).toBe(WorkspaceStore.Sheet.SectionSpecDrafts);
    WorkspaceStore.undefineSheet('SectionSpecDrafts');
  });

  it('ignores selecting the active section', function () {
    const onEnter = jasmine.createSpy('onEnter');
    registerCalendar({ onEnter });
    SectionStore._onSelectSection('calendar');
    SectionStore._onSelectSection('calendar');
    expect(onEnter.callCount).toBe(1);
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
