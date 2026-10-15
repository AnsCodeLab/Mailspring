import {
  WorkspaceStore,
  ComponentRegistry,
  SectionStore,
  Actions,
  AccountStore,
  localized,
} from 'mailspring-exports';
import { ContactsIcon } from 'mailspring-component-kit';
import { ContactPerspectivesList } from './ContactPerspectivesList';
import { ContactDetailToolbar } from './ContactDetailToolbar';
import { AddContactToolbar } from './AddContactToolbar';
import { ContactList, ContactListSearch } from './ContactList';
import { ContactDetail } from './ContactDetail';
import { FoundInMailEnabledBar } from './FoundInMailEnabledBar';
import { Store } from './Store';
import { exportContactsToFile, importContactsFromFile } from './VCFImportExport';

function contactMenu(): (typeof AppEnv.menu.template)[0] {
  return {
    id: 'Contact',
    label: localized('Contact'),
    submenu: [
      {
        label: localized('New Contact'),
        command: 'core:add-item',
      },
      { type: 'separator' },
      {
        label: localized('Import vCards...'),
        command: 'contacts:import-vcf',
      },
      {
        label: localized('Export All vCards...'),
        command: 'contacts:export-vcf-all',
      },
      {
        label: localized('Export Selected...'),
        command: 'contacts:export-vcf-selected',
      },
      { type: 'separator' },
      {
        label: localized('Edit Contact'),
        command: 'core:edit-item',
      },
      {
        label: localized('Delete Contact'),
        command: 'core:delete-item',
      },
      { type: 'separator' },
      {
        label: localized('Remove from Group'),
        command: 'core:remove-from-view',
      },
    ],
  };
}

const HIDDEN_MENUS = ['Thread', 'View'];

let _section: { dispose(): void } | null = null;
let _contactsWindowBaseMenu: typeof AppEnv.menu.template | null = null;

let _commandDisposable: { dispose: () => void } | null = null;

function resolveImportAccountId(): string | null {
  const perspective = Store.perspective();
  if ('accountId' in perspective) {
    return perspective.accountId;
  }
  // Unified view — fall back to the first CardDAV-capable account.
  const account = AccountStore.accounts().find((a) => a.provider !== 'gmail');
  return account ? account.id : null;
}

type RegistryDescriptor = Parameters<typeof ComponentRegistry.register>[1];

function registerContactsComponents(sidebarLocation: RegistryDescriptor) {
  ComponentRegistry.register(ContactPerspectivesList, sidebarLocation);
  ComponentRegistry.register(FoundInMailEnabledBar, {
    location: WorkspaceStore.Location.ContactsList,
  });
  ComponentRegistry.register(ContactList, { location: WorkspaceStore.Location.ContactsList });
  ComponentRegistry.register(ContactListSearch, {
    location: WorkspaceStore.Location.ContactsList.Toolbar,
  });
  ComponentRegistry.register(ContactDetail, { location: WorkspaceStore.Location.ContactsDetail });
  ComponentRegistry.register(ContactDetailToolbar, {
    location: WorkspaceStore.Location.ContactsDetail.Toolbar,
  });
}

function activateInContactsWindow() {
  WorkspaceStore.defineSheet(
    'Contacts',
    { root: true },
    { split: ['ContactsSidebar', 'ContactsList', 'ContactsDetail'] }
  );
  _contactsWindowBaseMenu = AppEnv.menu.template;
  const template = AppEnv.menu.template.filter((item) => !HIDDEN_MENUS.includes(item.id));
  template.splice(template.findIndex((item) => item.id === 'Edit') + 1, 0, contactMenu());
  AppEnv.menu.template = template;
  AppEnv.menu.update();
  Store.start();
  Actions.selectRootSheet(WorkspaceStore.Sheet.Contacts);
  registerContactsComponents({ location: WorkspaceStore.Location.ContactsSidebar });
  ComponentRegistry.register(AddContactToolbar, {
    location: WorkspaceStore.Location.ContactsSidebar.Toolbar,
  });
  // The window is created hidden; show it once the first frame has rendered.
  window.requestAnimationFrame(() => AppEnv.displayWindow());
}

function activateInMainWindow() {
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
    order: 20,
    rootSheet: () => WorkspaceStore.Sheet.Contacts,
    menu: contactMenu(),
    hiddenMenuIds: HIDDEN_MENUS,
    onEnter: () => Store.start(),
    openInNewWindowCommand: 'application:show-contacts-window',
  });
}

export function activate() {
  _commandDisposable = AppEnv.commands.add(document.body, {
    'contacts:import-vcf': () => {
      const accountId = resolveImportAccountId();
      if (accountId) {
        importContactsFromFile(accountId);
      } else {
        require('@electron/remote').dialog.showMessageBox({
          type: 'info',
          title: localized('No Compatible Account'),
          message: localized(
            'VCard import requires at least one CardDAV account. Google accounts must be managed via contacts.google.com.'
          ),
          buttons: [localized('OK')],
        });
      }
    },
    'contacts:export-vcf-all': () => {
      const contacts = Store.filteredContacts() || [];
      exportContactsToFile(contacts);
    },
  });

  if (AppEnv.getWindowType() === 'contacts') {
    activateInContactsWindow();
  } else {
    activateInMainWindow();
  }
}

export function deactivate() {
  ComponentRegistry.unregister(ContactPerspectivesList);
  ComponentRegistry.unregister(ContactList);
  ComponentRegistry.unregister(FoundInMailEnabledBar);
  ComponentRegistry.unregister(ContactListSearch);
  ComponentRegistry.unregister(ContactDetail);
  ComponentRegistry.unregister(ContactDetailToolbar);
  ComponentRegistry.unregister(AddContactToolbar);
  _commandDisposable?.dispose();
  _commandDisposable = null;
  _section?.dispose();
  _section = null;
  if (WorkspaceStore.Sheet.Contacts) {
    WorkspaceStore.undefineSheet('Contacts');
  }
  if (_contactsWindowBaseMenu) {
    AppEnv.menu.template = _contactsWindowBaseMenu;
    AppEnv.menu.update();
    _contactsWindowBaseMenu = null;
  }
}
