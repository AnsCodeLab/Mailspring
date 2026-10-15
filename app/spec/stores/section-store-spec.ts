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
      order: 10,
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
        order: 20,
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

  it('orders sections by declared order regardless of registration order', function () {
    disposables.push(
      SectionStore.registerSection({
        id: 'contacts',
        title: 'Contacts',
        icon: () => null,
        order: 20,
        rootSheet: () => calendarSheet,
      })
    );
    registerCalendar();
    expect(SectionStore.sections().map((s) => s.id)).toEqual(['mail', 'calendar', 'contacts']);
  });

  it('puts overflow sections after the dock sections', function () {
    disposables.push(
      SectionStore.registerSection({
        id: 'notes',
        title: 'Notes',
        icon: () => null,
        order: 1,
        overflow: true,
        rootSheet: () => calendarSheet,
      })
    );
    registerCalendar();
    expect(SectionStore.sections().map((s) => s.id)).toEqual(['mail', 'calendar', 'notes']);
  });

  it('replaces a re-registered section in place', function () {
    registerCalendar();
    disposables.push(
      SectionStore.registerSection({
        id: 'contacts',
        title: 'Contacts',
        icon: () => null,
        order: 20,
        rootSheet: () => calendarSheet,
      })
    );
    const replacement = registerCalendar({ title: 'Agenda' });
    expect(SectionStore.sections().map((s) => s.id)).toEqual(['mail', 'calendar', 'contacts']);
    expect(SectionStore.sections()[1]).toBe(replacement);
  });

  it('returns to the mail root sheet recorded while away', function () {
    registerCalendar();
    WorkspaceStore.defineSheet(
      'SectionSpecDrafts',
      { root: true, silent: true } as Partial<SheetDeclaration>,
      {
        list: ['RootSidebar'],
      }
    );
    SectionStore._onSelectSection('calendar');
    SectionStore.setMailRootSheet(WorkspaceStore.Sheet.SectionSpecDrafts);
    SectionStore._onSelectSection('mail');
    expect(WorkspaceStore.rootSheet()).toBe(WorkspaceStore.Sheet.SectionSpecDrafts);
    WorkspaceStore.undefineSheet('SectionSpecDrafts');
  });

  it('clears the focused thread when leaving mail from the Thread sheet', function () {
    registerCalendar();
    WorkspaceStore.defineSheet('Thread', { silent: true } as Partial<SheetDeclaration>, {
      list: ['MessageList'],
    });
    WorkspaceStore.pushSheet(WorkspaceStore.Sheet.Thread);
    spyOn(Actions, 'setFocus');
    SectionStore._onSelectSection('calendar');
    expect(Actions.setFocus).toHaveBeenCalledWith({ collection: 'thread', item: null });
    WorkspaceStore.undefineSheet('Thread');
  });

  it('does not touch thread focus when leaving mail from the thread list', function () {
    registerCalendar();
    spyOn(Actions, 'setFocus');
    SectionStore._onSelectSection('calendar');
    expect(Actions.setFocus).not.toHaveBeenCalled();
  });

  it('restores the placeholder mail presentation', function () {
    const icon = () => null;
    SectionStore.setMailPresentation('Post', icon);
    SectionStore.restoreMailPresentation();
    const mail = SectionStore.sections().find((s) => s.id === 'mail');
    expect(mail.title).toBe('Mail');
    expect(mail.icon).not.toBe(icon);
  });
});
