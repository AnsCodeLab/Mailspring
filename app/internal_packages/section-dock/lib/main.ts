import { ComponentRegistry, SectionStore, WorkspaceStore, localized } from 'mailspring-exports';
import { MailIcon } from 'mailspring-component-kit';
import { SectionSidebar } from './section-sidebar';

export function activate() {
  SectionStore.setMailPresentation(localized('Mail'), MailIcon);
  ComponentRegistry.register(SectionSidebar, { location: WorkspaceStore.Location.RootSidebar });
}

export function deactivate() {
  ComponentRegistry.unregister(SectionSidebar);
}
