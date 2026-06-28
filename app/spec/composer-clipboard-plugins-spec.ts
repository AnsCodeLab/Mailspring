import {
  copySelectionToClipboard,
  applyCapturedMarks,
} from '../src/components/composer-editor/clipboard-plugins';

function fakeMark(type: string, value?: any) {
  return { type, data: { get: (k: string) => (k === 'value' ? value : undefined) } };
}

function makeClipboard() {
  const store: Record<string, string> = {};
  return {
    writeText: (t: string) => (store['text'] = t),
    write: (obj: { text?: string; html?: string }) => Object.assign(store, obj),
    readText: () => store['text'] || '',
    readHTML: () => store['html'] || '',
    _store: store,
  };
}

describe('copySelectionToClipboard', () => {
  it('returns false and writes nothing when the selection is collapsed', () => {
    const clip = makeClipboard();
    const editor = { value: { selection: { isCollapsed: true } } } as any;
    expect(copySelectionToClipboard(editor, clip)).toBe(false);
    expect(clip._store['text']).toBeUndefined();
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
