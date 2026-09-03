import {
  TOGGLE_MARK_TYPES,
  VALUE_MARK_TYPES,
  CHARACTER_MARK_TYPES,
  resolveDropdownBlockType,
} from '../src/components/composer-editor/toolbar-utils';
import {
  BLOCK_CONFIG,
  isWithinListOrQuote,
  isHeadingDropdownDisabled,
  isAlignDirDisabled,
  readBlockData,
  mergeBlockData,
  currentBlockAlign,
  currentBlockDir,
  nextAlignValue,
  setDivBlockData,
  indentBlock,
  outdentBlock,
} from '../src/components/composer-editor/base-block-plugins';
import {
  isMeaningfulBackgroundColor,
  clearFormatting,
} from '../src/components/composer-editor/base-mark-plugins';
import { insertHorizontalRule } from '../src/components/composer-editor/hr-plugins';
import { performUndo, performRedo } from '../src/components/composer-editor/history-plugins';

// Mark stub matching Slate's Mark shape used elsewhere in this suite (.type + .data.get).
function fakeMark(type: string, value?: any) {
  return { type, data: { get: (k: string) => (k === 'value' ? value : undefined) } };
}

// --- MARK_CONFIG registration: superscript/subscript/highlight must be classified
// correctly so the format-painter and clear-formatting cover them. ---

describe('TOGGLE_MARK_TYPES / VALUE_MARK_TYPES', () => {
  it('classifies superscript and subscript as toggle marks', () => {
    expect(TOGGLE_MARK_TYPES).toContain('superscript');
    expect(TOGGLE_MARK_TYPES).toContain('subscript');
  });

  it('classifies highlight as a value mark', () => {
    expect(VALUE_MARK_TYPES).toContain('highlight');
  });

  it('derives CHARACTER_MARK_TYPES from both lists', () => {
    expect(CHARACTER_MARK_TYPES).toContain('superscript');
    expect(CHARACTER_MARK_TYPES).toContain('subscript');
    expect(CHARACTER_MARK_TYPES).toContain('highlight');
    // regression: existing marks must not have been dropped
    expect(CHARACTER_MARK_TYPES).toContain('bold');
    expect(CHARACTER_MARK_TYPES).toContain('color');
  });
});

// --- resolveDropdownBlockType (heading dropdown current-value resolution) ---

describe('resolveDropdownBlockType', () => {
  const optionValues = ['div', 'heading_one', 'heading_two', 'blockquote'];

  it('returns the current type when it is one of the options', () => {
    expect(resolveDropdownBlockType('heading_one', optionValues, 'div')).toBe('heading_one');
  });

  it('falls back when the current type is not one of the options', () => {
    expect(resolveDropdownBlockType('code', optionValues, 'div')).toBe('div');
  });

  it('falls back when there is no current type', () => {
    expect(resolveDropdownBlockType(undefined, optionValues, 'div')).toBe('div');
  });
});

// --- isWithinListOrQuote / isHeadingDropdownDisabled / isAlignDirDisabled ---
// (nesting-safety guard shared by the heading dropdown, align group, and dir toggle)

function fakeValue(focusType: string | null, ancestorTypes: string[] = []) {
  return {
    focusBlock: focusType ? { key: 'k1', type: focusType } : null,
    document: {
      getAncestors: () => ancestorTypes.map((t) => ({ object: 'block', type: t })),
    },
  } as any;
}

describe('isWithinListOrQuote', () => {
  it('is false for a plain paragraph', () => {
    expect(isWithinListOrQuote(fakeValue('div'))).toBe(false);
  });

  it('is true when the block itself is a list item', () => {
    expect(isWithinListOrQuote(fakeValue('list_item'))).toBe(true);
  });

  it('is true when the block itself is a blockquote', () => {
    expect(isWithinListOrQuote(fakeValue('blockquote'))).toBe(true);
  });

  it('is true when an ancestor is a list item', () => {
    expect(isWithinListOrQuote(fakeValue('div', ['ul_list', 'list_item']))).toBe(true);
  });

  it('is true when an ancestor is a blockquote', () => {
    expect(isWithinListOrQuote(fakeValue('div', ['blockquote']))).toBe(true);
  });
});

describe('isHeadingDropdownDisabled', () => {
  it('stays enabled while already inside a heading (so you can switch back to Normal)', () => {
    expect(isHeadingDropdownDisabled(fakeValue('heading_one'))).toBe(false);
  });

  it('disables inside a list item', () => {
    expect(isHeadingDropdownDisabled(fakeValue('div', ['list_item']))).toBe(true);
  });

  it('disables inside a blockquote', () => {
    expect(isHeadingDropdownDisabled(fakeValue('blockquote'))).toBe(true);
  });

  it('stays enabled for a plain paragraph', () => {
    expect(isHeadingDropdownDisabled(fakeValue('div'))).toBe(false);
  });
});

describe('isAlignDirDisabled', () => {
  it('disables on a heading itself (align/dir only apply to div)', () => {
    expect(isAlignDirDisabled(fakeValue('heading_one'))).toBe(true);
    expect(isAlignDirDisabled(fakeValue('heading_two'))).toBe(true);
  });

  it('disables inside a list item or blockquote', () => {
    expect(isAlignDirDisabled(fakeValue('div', ['list_item']))).toBe(true);
    expect(isAlignDirDisabled(fakeValue('blockquote'))).toBe(true);
  });

  it('stays enabled for a plain paragraph', () => {
    expect(isAlignDirDisabled(fakeValue('div'))).toBe(false);
  });
});

// --- readBlockData / mergeBlockData: dual Immutable.Map / plain-object access ---

describe('readBlockData', () => {
  it('reads from a plain object', () => {
    expect(readBlockData({ className: 'x' }, 'className')).toBe('x');
  });

  it('reads from an Immutable.Map-like object via .get', () => {
    const data = { get: (k: string) => (k === 'align' ? 'center' : undefined) };
    expect(readBlockData(data, 'align')).toBe('center');
  });

  it('returns undefined for missing data', () => {
    expect(readBlockData(undefined, 'className')).toBeUndefined();
  });
});

describe('mergeBlockData', () => {
  it('merges a patch into a plain object without dropping existing keys', () => {
    const result = mergeBlockData({ className: 'x' }, { align: 'center' });
    expect(result).toEqual({ className: 'x', align: 'center' });
  });

  it('merges a patch into an Immutable.Map-like object via .merge', () => {
    const obj: Record<string, any> = { className: 'x' };
    const fakeMap = {
      merge: (patch: Record<string, any>) => {
        const merged = { ...obj, ...patch };
        return {
          get: (k: string) => merged[k],
        };
      },
    };
    const result = mergeBlockData(fakeMap, { dir: 'rtl' });
    expect(result.get('className')).toBe('x');
    expect(result.get('dir')).toBe('rtl');
  });

  it('handles undefined current data', () => {
    expect(mergeBlockData(undefined, { align: 'left' })).toEqual({ align: 'left' });
  });
});

// --- currentBlockAlign / currentBlockDir / nextAlignValue ---

describe('currentBlockAlign / currentBlockDir', () => {
  it('reads align/dir off the focus block data', () => {
    const value = { focusBlock: { data: { align: 'right', dir: 'rtl' } } } as any;
    expect(currentBlockAlign(value)).toBe('right');
    expect(currentBlockDir(value)).toBe('rtl');
  });

  it('returns undefined without a focus block', () => {
    const value = { focusBlock: null } as any;
    expect(currentBlockAlign(value)).toBeUndefined();
    expect(currentBlockDir(value)).toBeUndefined();
  });
});

describe('nextAlignValue', () => {
  it('clears an already-active alignment', () => {
    expect(nextAlignValue('center', 'center')).toBeNull();
  });

  it('applies a different alignment', () => {
    expect(nextAlignValue('center', 'left')).toBe('left');
  });

  it('applies to an unaligned block', () => {
    expect(nextAlignValue(undefined, 'left')).toBe('left');
  });
});

// --- setDivBlockData: merge-not-replace write path ---

describe('setDivBlockData', () => {
  function makeDataEditor(data: any) {
    const calls: any[] = [];
    const editor = {
      value: { focusBlock: { key: 'k1', data } },
      setNodeByKey(key: string, props: any) {
        calls.push([key, props]);
        return editor;
      },
    };
    return { editor, calls };
  }

  it('merges the patch with existing data rather than replacing it', () => {
    const { editor, calls } = makeDataEditor({ className: 'x' });
    setDivBlockData(editor as any, { align: 'center' });
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('k1');
    expect(calls[0][1].data).toEqual({ className: 'x', align: 'center' });
  });

  it('is a no-op without a focus block', () => {
    const calls: any[] = [];
    const editor = {
      value: { focusBlock: null },
      setNodeByKey(key: string, props: any) {
        calls.push([key, props]);
        return editor;
      },
    };
    setDivBlockData(editor as any, { align: 'center' });
    expect(calls.length).toBe(0);
  });
});

// --- indentBlock / outdentBlock: factored appCommand bodies, reused by buttons ---

describe('indentBlock / outdentBlock', () => {
  function makeBlockEditor(focusType: string | null) {
    const calls: string[] = [];
    const editor = {
      value: { focusBlock: focusType ? { type: focusType } : null },
      setBlocks(type: string) {
        calls.push(type);
        return editor;
      },
    };
    return { editor, calls };
  }

  it('indents a div into a blockquote', () => {
    const { editor, calls } = makeBlockEditor(BLOCK_CONFIG.div.type);
    indentBlock(editor as any);
    expect(calls).toEqual([BLOCK_CONFIG.blockquote.type]);
  });

  it('does not indent an already-indented block', () => {
    const { editor, calls } = makeBlockEditor(BLOCK_CONFIG.blockquote.type);
    indentBlock(editor as any);
    expect(calls).toEqual([]);
  });

  it('outdents a blockquote into a div', () => {
    const { editor, calls } = makeBlockEditor(BLOCK_CONFIG.blockquote.type);
    outdentBlock(editor as any);
    expect(calls).toEqual([BLOCK_CONFIG.div.type]);
  });

  it('does not outdent a div', () => {
    const { editor, calls } = makeBlockEditor(BLOCK_CONFIG.div.type);
    outdentBlock(editor as any);
    expect(calls).toEqual([]);
  });
});

// --- BLOCK_CONFIG.div.render: align/dir style carry-through, including the empty-block
// export branch (bare <br>) that must not silently drop styling. render() is called
// directly here (no Slate/React mounting) — it returns a plain React element descriptor
// we can inspect via .type/.props.

function fakeDivNode({
  text = 'hi',
  data = {},
  isRtlDetected = false,
}: {
  text?: string;
  data?: any;
  isRtlDetected?: boolean;
}) {
  return {
    text,
    object: 'block',
    nodes: text === '' ? [] : [{ object: 'text' }],
    data,
    isLeafBlock: () => true,
    getTextDirection: () => (isRtlDetected ? 'rtl' : 'ltr'),
  } as any;
}

describe('BLOCK_CONFIG.div.render', () => {
  it('applies align as inline text-align style (plain-object data)', () => {
    const el = BLOCK_CONFIG.div.render({
      node: fakeDivNode({ data: { className: 'foo', align: 'center' } }),
      attributes: {},
      children: 'hello',
      targetIsHTML: false,
    }) as any;
    expect(el.type).toBe('div');
    expect(el.props.className).toBe('foo');
    expect(el.props.style.textAlign).toBe('center');
  });

  it('applies align from Immutable.Map-like data on the render path', () => {
    const data = { get: (k: string) => (({ align: 'right' }) as any)[k] };
    const el = BLOCK_CONFIG.div.render({
      node: fakeDivNode({ data }),
      attributes: {},
      children: 'hello',
      targetIsHTML: false,
    }) as any;
    expect(el.props.style.textAlign).toBe('right');
  });

  it('an explicit dir override wins over Slate auto-detection', () => {
    const el = BLOCK_CONFIG.div.render({
      node: fakeDivNode({ data: { dir: 'ltr' }, isRtlDetected: true }),
      attributes: {},
      children: 'hello',
      targetIsHTML: true,
    }) as any;
    expect(el.props.dir).toBe('ltr');
  });

  it('falls back to Slate auto-detected rtl on HTML export when no explicit dir is set', () => {
    const el = BLOCK_CONFIG.div.render({
      node: fakeDivNode({ isRtlDetected: true }),
      attributes: {},
      children: 'hello',
      targetIsHTML: true,
    }) as any;
    expect(el.props.dir).toBe('rtl');
  });

  it('does not auto-detect direction outside HTML export', () => {
    const el = BLOCK_CONFIG.div.render({
      node: fakeDivNode({ isRtlDetected: true }),
      attributes: {},
      children: 'hello',
      targetIsHTML: false,
    }) as any;
    expect(el.props.dir).toBeUndefined();
  });

  it('carries align/dir style through the empty-block bare-<br> export branch', () => {
    const el = BLOCK_CONFIG.div.render({
      node: fakeDivNode({ text: '', data: { align: 'center', dir: 'rtl' } }),
      attributes: {},
      children: undefined,
      targetIsHTML: true,
    }) as any;
    expect(el.type).toBe('br');
    expect(el.props.style.textAlign).toBe('center');
    expect(el.props.dir).toBe('rtl');
  });

  it('renders an empty block as an editable div (not <br>) while not exporting HTML', () => {
    const el = BLOCK_CONFIG.div.render({
      node: fakeDivNode({ text: '' }),
      attributes: {},
      children: undefined,
      targetIsHTML: false,
    }) as any;
    expect(el.type).toBe('div');
  });
});

// --- clearFormatting: removes every character mark in range ---

describe('clearFormatting', () => {
  it('removes only the character marks that are actually present', () => {
    const active = [fakeMark('bold'), fakeMark('highlight', '#ff0')];
    const removed: string[] = [];
    const editor = {
      value: { selection: { isCollapsed: true }, activeMarks: { toArray: () => active } },
      removeMark(m: any) {
        removed.push(m.type);
      },
      focus() {
        return this;
      },
    } as any;
    clearFormatting(editor);
    expect(removed).toContain('bold');
    expect(removed).toContain('highlight');
    expect(removed).not.toContain('italic');
  });
});

// --- isMeaningfulBackgroundColor: highlight deserialize detection ---

describe('isMeaningfulBackgroundColor', () => {
  it('treats transparent as no highlight', () => {
    expect(isMeaningfulBackgroundColor('transparent')).toBe(false);
  });

  it('treats rgba(0, 0, 0, 0) as no highlight', () => {
    expect(isMeaningfulBackgroundColor('rgba(0, 0, 0, 0)')).toBe(false);
  });

  it('treats black as a meaningful background (unlike foreground text color)', () => {
    expect(isMeaningfulBackgroundColor('#000000')).toBe(true);
  });

  it('treats a real color as meaningful', () => {
    expect(isMeaningfulBackgroundColor('#ffff00')).toBe(true);
  });

  it('treats empty/falsy as not meaningful', () => {
    expect(isMeaningfulBackgroundColor('')).toBe(false);
    expect(isMeaningfulBackgroundColor(undefined as any)).toBe(false);
  });
});

// --- insertHorizontalRule: void-block cursor safety (trailing empty div) ---

describe('insertHorizontalRule', () => {
  it('inserts the hr block followed by a trailing empty div', () => {
    const calls: string[] = [];
    const editor = {
      insertBlock(type: string) {
        calls.push(type);
        return editor;
      },
    } as any;
    insertHorizontalRule(editor);
    expect(calls).toEqual(['hr', BLOCK_CONFIG.div.type]);
  });
});

// --- performUndo / performRedo: thin wiring around editor.undo()/redo() ---

describe('performUndo / performRedo', () => {
  it('calls editor.undo()', () => {
    let undoCalls = 0;
    const editor = { undo: () => undoCalls++ } as any;
    performUndo(editor);
    expect(undoCalls).toBe(1);
  });

  it('calls editor.redo()', () => {
    let redoCalls = 0;
    const editor = { redo: () => redoCalls++ } as any;
    performRedo(editor);
    expect(redoCalls).toBe(1);
  });
});
