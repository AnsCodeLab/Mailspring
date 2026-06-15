import { ComponentRegistry } from 'mailspring-exports';
import ExportThreadButton from './export-thread-button';
import ExportEmailMenuItem from './export-email-menu-item';

export function activate() {
  ComponentRegistry.register(ExportThreadButton, { role: 'ThreadActionsToolbarButton' });
  ComponentRegistry.register(ExportEmailMenuItem, { role: 'MessageActionMenuItem' });
}

export function deactivate() {
  ComponentRegistry.unregister(ExportThreadButton);
  ComponentRegistry.unregister(ExportEmailMenuItem);
}
