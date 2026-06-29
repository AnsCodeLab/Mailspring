import {
  ptFromMarkValue,
  faceFromMarkValue,
  resolveDisplay,
  captureCharacterMarks,
  marksToReapply,
  canCopyOrCut,
  canPaint,
  CHARACTER_MARK_TYPES,
} from '../src/components/composer-editor/toolbar-utils';

// Mark stub matching Slate's Mark shape used by the helpers (.type + .data.get).
function mark(type: string, value?: any) {
  return { type, data: { get: (k: string) => (k === 'value' ? value : undefined) } };
}

const FACE_OPTIONS = [
  { name: 'Sans Serif', value: 'sans-serif' },
  { name: 'Georgia', value: 'georgia' },
];

describe('ptFromMarkValue', () => {
  it('passes through pt values', () => expect(ptFromMarkValue('14pt')).toBe('14'));
  it('converts px to pt', () => expect(ptFromMarkValue('16px')).toBe('12'));
  it('converts em to pt', () => expect(ptFromMarkValue('2em')).toBe('24'));
  it('maps legacy numeric sizes', () => expect(ptFromMarkValue(4)).toBe('14'));
  it('returns empty for falsy', () => expect(ptFromMarkValue('')).toBe(''));
});

describe('faceFromMarkValue', () => {
  it('normalizes a known family to its option value', () =>
    expect(faceFromMarkValue('Georgia, serif', FACE_OPTIONS)).toBe('georgia'));
  it('returns the raw value when unknown', () =>
    expect(faceFromMarkValue('Wingdings', FACE_OPTIONS)).toBe('Wingdings'));
  it('returns empty for falsy', () => expect(faceFromMarkValue('', FACE_OPTIONS)).toBe(''));

  // Regression: with the real option list, each value is a CSS family list with a
  // generic fallback (e.g. "georgia, serif"). A loose substring match would collapse
  // every such value onto the generic "Serif"/"Sans Serif"/"Fixed Width" option. The
  // resolver must map a value back to ITS OWN option.
  const REAL_OPTIONS = [
    { name: 'Sans Serif', value: 'sans-serif' },
    { name: 'Serif', value: 'serif' },
    { name: 'Fixed Width', value: 'monospace' },
    { name: 'Georgia', value: 'georgia, serif' },
    { name: 'Calibri', value: 'calibri, sans-serif' },
    { name: 'Consolas', value: 'consolas, monospace' },
  ];
  it('resolves a comma-fallback value to its own option, not the generic', () => {
    expect(faceFromMarkValue('georgia, serif', REAL_OPTIONS)).toBe('georgia, serif');
    expect(faceFromMarkValue('calibri, sans-serif', REAL_OPTIONS)).toBe('calibri, sans-serif');
    expect(faceFromMarkValue('consolas, monospace', REAL_OPTIONS)).toBe('consolas, monospace');
  });
  it('still resolves a bare primary family to its option', () =>
    expect(faceFromMarkValue('Georgia', REAL_OPTIONS)).toBe('georgia, serif'));
  it('keeps the generic options resolving to themselves', () => {
    expect(faceFromMarkValue('serif', REAL_OPTIONS)).toBe('serif');
    expect(faceFromMarkValue('sans-serif', REAL_OPTIONS)).toBe('sans-serif');
  });

  // Chromium normalizes multi-word unquoted font names by adding double-quotes when
  // reading el.style.fontFamily. e.g. storing 'Open Sans, sans-serif' as a mark and
  // reading it back from HTML gives '"Open Sans", sans-serif'. The resolver must
  // strip CSS quotes before comparing so the font picker still recognizes the font.
  const BUNDLED_OPTIONS = [
    { name: 'Sans Serif', value: 'sans-serif' },
    { name: 'Roboto', value: 'Roboto, sans-serif' },
    { name: 'Open Sans', value: 'Open Sans, sans-serif' },
    { name: 'Source Code Pro', value: 'Source Code Pro, monospace' },
  ];
  it('matches Chromium-normalized quoted multi-word font names back to their option', () => {
    // Chromium reads el.style.fontFamily = 'Open Sans, sans-serif' as '"Open Sans", sans-serif'
    expect(faceFromMarkValue('"Open Sans", sans-serif', BUNDLED_OPTIONS)).toBe(
      'Open Sans, sans-serif'
    );
    expect(faceFromMarkValue('"Source Code Pro", monospace', BUNDLED_OPTIONS)).toBe(
      'Source Code Pro, monospace'
    );
    // Single-word names are unaffected
    expect(faceFromMarkValue('Roboto, sans-serif', BUNDLED_OPTIONS)).toBe('Roboto, sans-serif');
  });
});

describe('resolveDisplay', () => {
  it('uses the fallback when there are no values', () =>
    expect(resolveDisplay([], '11')).toEqual({ display: '11', mixed: false }));
  it('shows the single shared value', () =>
    expect(resolveDisplay(['14'], '11')).toEqual({ display: '14', mixed: false }));
  it('blanks out and flags mixed when values differ', () =>
    expect(resolveDisplay(['14', '18'], '11')).toEqual({ display: '', mixed: true }));
});

describe('captureCharacterMarks', () => {
  it('captures toggle marks without a value and value marks with one', () => {
    const captured = captureCharacterMarks([
      mark('bold'),
      mark('size', '14pt'),
      mark('codeInline'),
    ]);
    expect(captured).toEqual([
      { type: 'bold', value: undefined },
      { type: 'size', value: '14pt' },
    ]);
  });
  it('ignores marks outside the character set', () => {
    expect(captureCharacterMarks([mark('codeInline')])).toEqual([]);
    expect(CHARACTER_MARK_TYPES).toContain('size');
  });
});

describe('marksToReapply', () => {
  it('returns saved marks that were dropped, excluding the applied type', () => {
    const saved = [mark('bold'), mark('color', '#f00'), mark('size', '10pt')];
    const present = new Set(['size']); // bold + color got dropped, size is the one we applied
    expect(marksToReapply(saved, present, 'size')).toEqual([
      { type: 'bold', value: undefined },
      { type: 'color', value: '#f00' },
    ]);
  });
  it('returns nothing when all saved marks are still present', () => {
    const saved = [mark('bold')];
    expect(marksToReapply(saved, new Set(['bold']), 'size')).toEqual([]);
  });
});

describe('clipboard predicates', () => {
  it('canCopyOrCut requires a non-collapsed selection', () => {
    expect(canCopyOrCut(false)).toBe(true);
    expect(canCopyOrCut(true)).toBe(false);
  });
  it('canPaint requires at least one captured mark', () => {
    expect(canPaint([{ type: 'bold' }])).toBe(true);
    expect(canPaint([])).toBe(false);
  });
});
