import { applyValueForMarkSafe } from '../src/components/composer-editor/toolbar-component-factories';

// Minimal fake Slate editor that records addMark/removeMark and exposes a mutable
// activeMarks list. applyValueForMark (called inside applyValueForMarkSafe) removes
// the target type then re-adds it; our fake mimics enough of that to assert that the
// OTHER previously-active marks get re-added.
function fakeMark(type: string, value?: any) {
  return { type, data: { get: (k: string) => (k === 'value' ? value : undefined) } };
}

function makeEditor(initialActive: any[]) {
  const active = [...initialActive];
  return {
    added: [] as any[],
    focus() { return this; },
    get value() {
      return {
        selection: { isCollapsed: false },
        // safeActiveMarks reads value.activeMarks.toArray()
        activeMarks: { toArray: () => active },
        document: { getTextsAtRange: () => [] },
      };
    },
    removeMark(m: any) {
      const i = active.findIndex((x) => x.type === (m.type || m));
      if (i >= 0) active.splice(i, 1);
      return this;
    },
    addMark(m: any) {
      active.push(fakeMark(m.type, m.data && m.data.value));
      this.added.push(m);
      return this;
    },
  } as any;
}

describe('applyValueForMarkSafe', () => {
  it('re-applies bold and color after changing size', () => {
    const editor = makeEditor([fakeMark('bold'), fakeMark('color', '#f00'), fakeMark('size', '10pt')]);
    applyValueForMarkSafe(editor, 'size', '14pt');
    const addedTypes = editor.added.map((m: any) => m.type);
    expect(addedTypes).toContain('size');
    expect(addedTypes).toContain('bold');
    expect(addedTypes).toContain('color');
  });
});
