import { Editor } from 'slate';
import {
  copySelectionToClipboard,
  applyCapturedMarks,
} from '../src/components/composer-editor/clipboard-plugins';

function fakeMark(type: string, value?: any) {
  return { type, data: { get: (k: string) => (k === 'value' ? value : undefined) } };
}

function makeClipboard() {
  const written: ClipboardItem[][] = [];
  return {
    write: async (items: ClipboardItem[]) => {
      written.push(items);
    },
    read: async () => written[written.length - 1] || [],
    readText: async () => '',
    written,
  };
}

describe('copySelectionToClipboard', () => {
  it('returns false and writes nothing when the selection is collapsed', async () => {
    const clip = makeClipboard();
    // Only `value.selection.isCollapsed` is read before the early return.
    const editor = { value: { selection: { isCollapsed: true } } } as unknown as Editor;
    expect(await copySelectionToClipboard(editor, clip)).toBe(false);
    expect(clip.written.length).toBe(0);
  });
});

describe('applyCapturedMarks', () => {
  it('adds captured toggle marks and removes uncaptured ones to match the source', () => {
    const active = [fakeMark('italic')]; // target currently italic
    const editor = {
      added: [] as any[],
      removed: [] as any[],
      focus() { return this; },
      get value() {
        return { selection: { isCollapsed: false }, activeMarks: { toArray: () => active }, document: { getTextsAtRange: () => [] } };
      },
      addMark(m: any) { this.added.push(m.type || m); return this; },
      removeMark(m: any) { this.removed.push(m.type || m); return this; },
    } as any;
    // Source formatting was bold only.
    applyCapturedMarks(editor, [{ type: 'bold', value: undefined }]);
    expect(editor.added).toContain('bold');   // add the captured mark
    expect(editor.removed).toContain('italic'); // clear the uncaptured one
  });
});
