import { ComponentRegistry, WorkspaceStore } from 'mailspring-exports';
import UndoRedoToast from './undo-redo-toast';

export function activate() {
  const { windowType } = AppEnv.getLoadSettings();
  if (AppEnv.isMainWindow() || windowType === 'composer') {
    ComponentRegistry.register(UndoRedoToast, {
      location: WorkspaceStore.Sheet.Global.Footer,
    });
  }
}

export function deactivate() {
  const { windowType } = AppEnv.getLoadSettings();
  if (AppEnv.isMainWindow() || windowType === 'composer') {
    ComponentRegistry.unregister(UndoRedoToast);
  }
}
