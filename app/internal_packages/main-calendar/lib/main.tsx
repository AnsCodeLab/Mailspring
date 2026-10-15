import moment from 'moment';
import { WorkspaceStore, ComponentRegistry, SectionStore, localized } from 'mailspring-exports';
import { CalendarIcon } from 'mailspring-component-kit';
import { QuickEventButton } from './quick-event-button';
import { MailspringCalendar } from './core/mailspring-calendar';
import { EventSearchBar } from './core/event-search-bar';
import { CalendarSidebarPanel } from './core/calendar-sidebar-panel';
import { CalendarViewStore } from './calendar-view-store';

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
let _calendarWindowBaseMenu: typeof AppEnv.menu.template | null = null;

function activateInCalendarWindow() {
  _calendarWindowBaseMenu = AppEnv.menu.template;
  const template = AppEnv.menu.template.filter((item) => !HIDDEN_MENUS.includes(item.id));
  template.splice(template.findIndex((item) => item.id === 'Edit') + 1, 0, calendarMenu());
  AppEnv.menu.template = template;
  AppEnv.menu.update();

  ComponentRegistry.register(MailspringCalendar, { location: WorkspaceStore.Location.Center });
  ComponentRegistry.register(QuickEventButton, {
    location: WorkspaceStore.Location.Center.Toolbar,
  });
  ComponentRegistry.register(EventSearchBar, { location: WorkspaceStore.Location.Center.Toolbar });
}

/** CalendarViewStore lives for the whole session, so each entry starts back on today. */
export function enterCalendarSection() {
  CalendarViewStore.setFocusedMoment(moment());
  AppEnv.mailsyncBridge.sendSyncCalendarNow();
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
  ComponentRegistry.register(MailspringCalendar, {
    location: WorkspaceStore.Location.CalendarContent,
  });
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
    order: 10,
    rootSheet: () => WorkspaceStore.Sheet.Calendar,
    menu: calendarMenu(),
    hiddenMenuIds: HIDDEN_MENUS,
    onEnter: enterCalendarSection,
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
  if (_calendarWindowBaseMenu) {
    AppEnv.menu.template = _calendarWindowBaseMenu;
    AppEnv.menu.update();
    _calendarWindowBaseMenu = null;
  }
}
