import { Editor } from 'slate';
import { BuildToggleButton } from './toolbar-component-factories';
import { ComposerEditorPlugin } from './types';

// Slate tracks its own undo/redo stack on `value.data` (`undos`/`redos`), and
// slate-react's core plugin already binds mod+z/mod+shift+z to `editor.undo()`/
// `editor.redo()` inside `[data-slate-editor]` — no new keymap entries needed. These
// buttons just expose the same commands in the toolbar; they stay always-enabled
// (calling undo/redo with an empty stack is already a no-op in Slate).
export function performUndo(editor: Editor) {
  editor.undo();
}

export function performRedo(editor: Editor) {
  editor.redo();
}

const UndoButton = BuildToggleButton({
  type: 'undo',
  button: {
    isActive: () => false,
    onToggle: (editor) => performUndo(editor),
    iconClass: 'fa fa-undo',
  },
});

const RedoButton = BuildToggleButton({
  type: 'redo',
  button: {
    isActive: () => false,
    onToggle: (editor) => performRedo(editor),
    iconClass: 'fa fa-repeat',
  },
});

const HistoryPlugin: ComposerEditorPlugin = {
  toolbarSectionClass: 'history-section',
  toolbarComponents: [UndoButton, RedoButton],
};

const plugins: ComposerEditorPlugin[] = [HistoryPlugin];

export default plugins;
