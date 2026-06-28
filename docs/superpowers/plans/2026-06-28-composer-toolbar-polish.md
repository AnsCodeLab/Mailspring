# Composer Toolbar Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Mailspring rich-text composer toolbar Outlook-style clipboard controls (Cut/Copy/Paste/Paste-as-plain-text/Format Painter) and rebuild the font-family and font-size controls as clean dropdowns with an expanded font list and correct mixed/collapsed-selection behavior.

**Architecture:** All work stays inside the existing Slate-plugin toolbar pattern (`app/src/components/composer-editor/`). Pure decision logic is extracted into a new `toolbar-utils.ts` and unit-tested in isolation (matching the codebase's `export-to-markdown` spec pattern); the React toolbar components and Slate editor wiring consume those helpers and are verified manually in the dev app. A new `clipboard-plugins.tsx` contributes the clipboard toolbar section and reuses the editor's existing sanitize → inline-style → convert paste pipeline and Electron `clipboard`.

**Tech Stack:** TypeScript, React, Slate 0.47.x, slate-react, Electron `clipboard`, Jasmine specs, LESS.

## Global Constraints

- Application source lives in **both** `app/src/` and `app/internal_packages/`; the composer editor is under `app/src/components/composer-editor/`.
- The on-the-wire HTML serialization for marks stays `<font>`-based (`base-mark-plugins.tsx` `MARK_CONFIG`). Do not change `render`/`rules` serialization — only the toolbar UI and apply logic.
- Character marks in scope: `bold`, `italic`, `underline`, `strike` (toggle, no value) and `color`, `face`, `size` (value marks). Block-level formatting (lists/quotes/headings) is **out of scope** for Format Painter.
- Clipboard ops must respect the existing uneditable/quoted-region guard already used in `composer-editor.tsx` `onCopy` (lines ~211–214).
- Font size validation range: 6–200 pt (existing behavior in `BuildFontSizeInput._applySize`).
- Toolbar buttons must use `onMouseDown` + `event.preventDefault()` so the editor never blurs/loses its selection (existing pattern in `BuildToggleButton`).
- Run `npm run lint` and `npm test` before considering any task done; both must pass. (Note: the `after_edit` hook runs `npm run lint` automatically on `.ts/.tsx` edits.)
- Specs are Jasmine, flat files named `app/spec/<name>-spec.ts`, run via `npm test`.

---

## File Structure

- **Create** `app/src/components/composer-editor/toolbar-utils.ts` — pure, editor-independent helpers (value conversion, mixed-selection resolution, mark capture/reapply decisions, clipboard enable predicates). One responsibility: decision logic, no React, no Slate mutation.
- **Create** `app/spec/composer-toolbar-utils-spec.ts` — unit tests for `toolbar-utils.ts`.
- **Create** `app/src/components/composer-editor/clipboard-plugins.tsx` — the clipboard toolbar section plugin (Cut/Copy/Paste/Paste-plain/Format Painter).
- **Create** `app/spec/composer-clipboard-plugins-spec.ts` — tests for the clipboard plugin's pure orchestration via a fake editor + fake clipboard.
- **Modify** `app/src/components/composer-editor/toolbar-component-factories.tsx` — add `applyValueForMarkSafe`; replace `BuildFontFacePicker` (datalist) and `BuildFontSizeInput` internals with menu-style dropdowns that consume `toolbar-utils`.
- **Modify** `app/src/components/composer-editor/base-mark-plugins.tsx` — expand `DEFAULT_FONT_FACE_OPTIONS`; route font/size apply through `applyValueForMarkSafe`.
- **Modify** `app/src/components/composer-editor/conversion.tsx` — register `ClipboardPlugins` in the `plugins` array.
- **Modify** `app/internal_packages/composer/styles/composer.less` — styling for the new dropdowns and clipboard section.

---

## Task 1: Pure toolbar utilities

**Files:**
- Create: `app/src/components/composer-editor/toolbar-utils.ts`
- Test: `app/spec/composer-toolbar-utils-spec.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `TOGGLE_MARK_TYPES: string[]` = `['bold','italic','underline','strike']`
  - `VALUE_MARK_TYPES: string[]` = `['color','face','size']`
  - `CHARACTER_MARK_TYPES: string[]` = union of the two above
  - `ptFromMarkValue(val: any): string`
  - `faceFromMarkValue(val: any, options: {name:string;value:string}[]): string`
  - `resolveDisplay(distinctDisplays: string[], fallback: string): { display: string; mixed: boolean }`
  - `interface CapturedMark { type: string; value?: any }`
  - `captureCharacterMarks(marks: {type:string; data:{get:(k:string)=>any}}[]): CapturedMark[]`
  - `marksToReapply(saved: {type:string; data:{get:(k:string)=>any}}[], presentTypes: Set<string>, appliedType: string): CapturedMark[]`
  - `canCopyOrCut(isCollapsed: boolean): boolean`
  - `canPaint(captured: CapturedMark[]): boolean`

- [ ] **Step 1: Write the failing test**

Create `app/spec/composer-toolbar-utils-spec.ts`:

```typescript
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
    const captured = captureCharacterMarks([mark('bold'), mark('size', '14pt'), mark('codeInline')]);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jasmine --config=app/spec/spec-runner/jasmine.json app/spec/composer-toolbar-utils-spec.ts` (or `npm test`).
Expected: FAIL — `Cannot find module '../src/components/composer-editor/toolbar-utils'`.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/components/composer-editor/toolbar-utils.ts`:

```typescript
// Pure, editor-independent helpers for the composer toolbar. No React, no Slate
// mutation — everything here is unit-tested in composer-toolbar-utils-spec.ts.

export const TOGGLE_MARK_TYPES = ['bold', 'italic', 'underline', 'strike'];
export const VALUE_MARK_TYPES = ['color', 'face', 'size'];
export const CHARACTER_MARK_TYPES = [...TOGGLE_MARK_TYPES, ...VALUE_MARK_TYPES];

const LEGACY_TO_PT: Record<number, number> = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24 };

export function ptFromMarkValue(val: any): string {
  if (!val && val !== 0) return '';
  if (typeof val === 'string' && val.endsWith('pt')) return val.slice(0, -2);
  if (typeof val === 'string' && val.endsWith('px')) return String(Math.round(parseInt(val, 10) * 0.75));
  if (typeof val === 'string' && val.endsWith('em')) return String(Math.round(parseFloat(val) * 12));
  if (typeof val === 'number') return String(LEGACY_TO_PT[val] || 12);
  return '';
}

export function faceFromMarkValue(val: any, options: { name: string; value: string }[]): string {
  if (!val) return '';
  const opt = options.find((o) => String(val).toLowerCase().includes(o.value.toLowerCase()));
  return opt ? opt.value : String(val);
}

export function resolveDisplay(
  distinctDisplays: string[],
  fallback: string
): { display: string; mixed: boolean } {
  const distinct = distinctDisplays.filter((d) => d !== '' && d != null);
  if (distinct.length === 0) return { display: fallback, mixed: false };
  if (distinct.length === 1) return { display: distinct[0], mixed: false };
  return { display: '', mixed: true };
}

export interface CapturedMark {
  type: string;
  value?: any;
}

type MarkLike = { type: string; data: { get: (k: string) => any } };

export function captureCharacterMarks(marks: MarkLike[]): CapturedMark[] {
  return marks
    .filter((m) => CHARACTER_MARK_TYPES.includes(m.type))
    .map((m) => ({
      type: m.type,
      value: VALUE_MARK_TYPES.includes(m.type) ? m.data.get('value') : undefined,
    }));
}

export function marksToReapply(
  saved: MarkLike[],
  presentTypes: Set<string>,
  appliedType: string
): CapturedMark[] {
  return saved
    .filter((m) => m.type !== appliedType && !presentTypes.has(m.type))
    .map((m) => ({ type: m.type, value: m.data.get('value') }));
}

export function canCopyOrCut(isCollapsed: boolean): boolean {
  return !isCollapsed;
}

export function canPaint(captured: CapturedMark[]): boolean {
  return captured.length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (or the single-file jasmine command above).
Expected: PASS — all `composer-toolbar-utils-spec` cases green.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/composer-editor/toolbar-utils.ts app/spec/composer-toolbar-utils-spec.ts
git commit -m "feat(composer): add pure toolbar utility helpers with tests"
```

---

## Task 2: Safe mark application + expanded font list

**Files:**
- Modify: `app/src/components/composer-editor/toolbar-component-factories.tsx` (add `applyValueForMarkSafe`, export it)
- Modify: `app/src/components/composer-editor/base-mark-plugins.tsx` (expand `DEFAULT_FONT_FACE_OPTIONS`)
- Test: `app/spec/composer-clipboard-plugins-spec.ts` is created in Task 5; this task's logic is covered by the pure `marksToReapply` test from Task 1 plus a focused fake-editor test added here.

**Interfaces:**
- Consumes: `marksToReapply`, `safeActiveMarks`, existing `applyValueForMark`.
- Produces: `applyValueForMarkSafe(editor, type, value): void` — applies a value mark to the current selection without dropping the other character marks that were active.

- [ ] **Step 1: Write the failing test**

Create `app/spec/composer-marks-safe-spec.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `applyValueForMarkSafe` is not exported from `toolbar-component-factories`.

- [ ] **Step 3: Write minimal implementation**

In `app/src/components/composer-editor/toolbar-component-factories.tsx`, add an import at the top:

```typescript
import { marksToReapply } from './toolbar-utils';
```

Then add, immediately after the existing `applyValueForMark` function (after line ~114):

```typescript
// Apply a value mark (size/face/color) to the current selection WITHOUT dropping the
// other character marks that were active. Slate's remove+add dance in applyValueForMark
// can clear sibling marks at a collapsed cursor; we snapshot first and re-add what got
// lost. The re-apply decision is the pure marksToReapply helper (unit-tested).
export function applyValueForMarkSafe(editor: Editor, type: string, markValue: any) {
  const saved = safeActiveMarks(editor.value);
  applyValueForMark(editor, type, markValue);
  const presentTypes = new Set(safeActiveMarks(editor.value).map((m) => m.type));
  for (const m of marksToReapply(saved as any, presentTypes, type)) {
    editor.addMark({ type: m.type, data: { value: m.value } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `applyValueForMarkSafe` re-adds bold/color after a size change.

- [ ] **Step 5: Expand the font list**

In `app/src/components/composer-editor/base-mark-plugins.tsx`, replace the `DEFAULT_FONT_FACE_OPTIONS` array (lines 26–36) with the Outlook-style set. Keep `value` lowercased (the deserializer matches case-insensitively) and add a generic CSS fallback family in the **applied** value so mail degrades on machines without the font:

```typescript
export const DEFAULT_FONT_FACE = 'sans-serif';
// `value` is the family string written into the mark/HTML. Office-only fonts get a
// generic fallback appended so recipients without the font still render sensibly.
export const DEFAULT_FONT_FACE_OPTIONS = [
  // Generic (always available)
  { name: 'Sans Serif', value: 'sans-serif' },
  { name: 'Serif', value: 'serif' },
  { name: 'Fixed Width', value: 'monospace' },
  // Theme / common (mostly Windows + Office)
  { name: 'Calibri', value: 'calibri, sans-serif' },
  { name: 'Cambria', value: 'cambria, serif' },
  { name: 'Candara', value: 'candara, sans-serif' },
  { name: 'Consolas', value: 'consolas, monospace' },
  { name: 'Constantia', value: 'constantia, serif' },
  { name: 'Corbel', value: 'corbel, sans-serif' },
  { name: 'Segoe UI', value: 'segoe ui, sans-serif' },
  // Classic web-safe
  { name: 'Arial', value: 'arial, sans-serif' },
  { name: 'Arial Black', value: 'arial black, sans-serif' },
  { name: 'Comic Sans MS', value: 'comic sans ms, cursive' },
  { name: 'Courier New', value: 'courier new, monospace' },
  { name: 'Garamond', value: 'garamond, serif' },
  { name: 'Georgia', value: 'georgia, serif' },
  { name: 'Impact', value: 'impact, sans-serif' },
  { name: 'Lucida Console', value: 'lucida console, monospace' },
  { name: 'Palatino Linotype', value: 'palatino linotype, serif' },
  { name: 'Tahoma', value: 'tahoma, sans-serif' },
  { name: 'Times New Roman', value: 'times new roman, serif' },
  { name: 'Trebuchet MS', value: 'trebuchet ms, sans-serif' },
  { name: 'Verdana', value: 'verdana, sans-serif' },
];
```

Note: `faceFromMarkValue` already uses `includes()` so `'georgia, serif'` still resolves to the `georgia` option's label substring; the menu (Task 3) matches on `value`, so menu rows compare against these exact `value` strings — keep that consistent.

- [ ] **Step 6: Run lint + tests, then commit**

Run: `npm run lint && npm test`
Expected: PASS.

```bash
git add app/src/components/composer-editor/toolbar-component-factories.tsx app/src/components/composer-editor/base-mark-plugins.tsx app/spec/composer-marks-safe-spec.ts
git commit -m "feat(composer): add applyValueForMarkSafe and expand font list"
```

---

## Task 3: Font-family dropdown component

**Files:**
- Modify: `app/src/components/composer-editor/toolbar-component-factories.tsx` (rewrite `BuildFontFacePicker` internals)

**Interfaces:**
- Consumes: `applyValueForMarkSafe`, `faceFromMarkValue`, `resolveDisplay`, `getActiveValueForMark`, `safeActiveMarks`, `DEFAULT_FONT_FACE_OPTIONS`.
- Produces: same `BuildFontFacePicker(config)` export signature (so `base-mark-plugins.tsx` wiring is unchanged), now rendering a menu dropdown instead of a `<datalist>`.

This component is verified manually in the dev app (Task 7). Its pure pieces (`faceFromMarkValue`, `resolveDisplay`) are already tested in Task 1.

- [ ] **Step 1: Add a Slate-side value collector**

In `toolbar-component-factories.tsx`, add a helper near `getActiveValueForMark` (after line ~100) that returns the distinct values of a mark type across the current selection (used to detect "mixed"):

```typescript
// Distinct values of `type` across the current selection's text leaves. Empty when the
// mark is absent everywhere; length>1 means a mixed selection. Slate-dependent, verified
// manually; the pure decision lives in resolveDisplay().
export function collectMarkValues(value: Value, type: string): any[] {
  const { selection, document } = value;
  if (selection.isCollapsed) {
    const v = getActiveValueForMark(value, type);
    return v ? [v] : [];
  }
  const seen = new Set<any>();
  let texts;
  try {
    texts = document.getTextsAtRange(selection as any);
  } catch (err) {
    return [];
  }
  texts.forEach((node: any) => {
    node.getMarks().forEach((m: any) => {
      if (m.type === type) seen.add(m.data.get('value'));
    });
  });
  return Array.from(seen);
}
```

- [ ] **Step 2: Rewrite `BuildFontFacePicker`**

Replace the entire `BuildFontFacePicker` function (lines ~571–691, including the `FONT_DATALIST_ID` const at line 569) with a menu-dropdown implementation:

```typescript
export function BuildFontFacePicker(config: {
  type: string;
  default?: string;
  options: Array<{ name: string; value: string }>;
}) {
  return class FontFacePicker extends React.Component<
    ComposerEditorPluginToolbarComponentProps,
    { open: boolean; custom: boolean; customValue: string }
  > {
    _el: HTMLDivElement;

    state = { open: false, custom: false, customValue: '' };

    _activeValue() {
      const distinct = collectMarkValues(this.props.value, config.type).map((v) =>
        faceFromMarkValue(v, config.options)
      );
      // Show the option label for the resolved value, blank when mixed.
      const { display, mixed } = resolveDisplay(distinct, config.default || '');
      if (mixed) return { label: '', value: '' };
      const opt = config.options.find((o) => o.value === display);
      return { label: opt ? opt.name : display, value: display };
    }

    _toggleOpen = (e: React.MouseEvent) => {
      e.preventDefault();
      this.setState({ open: !this.state.open, custom: false });
    };

    _onBlur = (e: React.FocusEvent) => {
      if (!this._el.contains(e.relatedTarget as Node)) this.setState({ open: false, custom: false });
    };

    _apply = (faceValue: string | null) => {
      applyValueForMarkSafe(this.props.editor, config.type, faceValue);
      this.setState({ open: false, custom: false });
    };

    render() {
      const { open, custom, customValue } = this.state;
      const active = this._activeValue();
      return (
        <div
          className={`${this.props.className} font-face-picker`}
          tabIndex={-1}
          ref={(el) => (this._el = el)}
          onBlur={this._onBlur}
        >
          <button className="dropdown-toggle" onMouseDown={this._toggleOpen}>
            <span className="value">{active.label || localized('Font')}</span>
            <i className="fa fa-caret-down" />
          </button>
          {open && (
            <div className="dropdown menu">
              {config.options.map((o) => (
                <div
                  key={o.value}
                  className={`item ${o.value === active.value ? 'active' : ''}`}
                  style={{ fontFamily: o.value }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    this._apply(o.value);
                  }}
                >
                  {o.value === active.value && <i className="fa fa-check" />}
                  {o.name}
                </div>
              ))}
              <div className="divider" />
              {custom ? (
                <input
                  type="text"
                  autoFocus
                  placeholder={localized('Custom font…')}
                  value={customValue}
                  onChange={(e) => this.setState({ customValue: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customValue.trim()) this._apply(customValue.trim());
                    e.stopPropagation();
                  }}
                />
              ) : (
                <div
                  className="item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    this.setState({ custom: true });
                  }}
                >
                  {localized('Custom…')}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }
  };
}
```

Add `localized` to the imports at the top of `toolbar-component-factories.tsx`:

```typescript
import { localized } from 'mailspring-exports';
```

(`collectMarkValues`, `faceFromMarkValue`, `resolveDisplay`, `applyValueForMarkSafe` must be imported/defined in this file — `faceFromMarkValue` and `resolveDisplay` from `./toolbar-utils`.)

- [ ] **Step 3: Run lint + tests**

Run: `npm run lint && npm test`
Expected: PASS (no spec covers the React component; ensure no type errors and existing tests stay green).

- [ ] **Step 4: Commit**

```bash
git add app/src/components/composer-editor/toolbar-component-factories.tsx
git commit -m "feat(composer): rebuild font-family control as a styled dropdown"
```

---

## Task 4: Font-size dropdown component

**Files:**
- Modify: `app/src/components/composer-editor/toolbar-component-factories.tsx` (rewrite `BuildFontSizeInput` internals)

**Interfaces:**
- Consumes: `applyValueForMarkSafe`, `ptFromMarkValue`, `resolveDisplay`, `collectMarkValues`.
- Produces: same `BuildFontSizeInput(config)` export signature (unchanged wiring in `base-mark-plugins.tsx`).

- [ ] **Step 1: Rewrite `BuildFontSizeInput`**

Replace the `BuildFontSizeInput` function (lines ~375–567) with a menu-dropdown version. Keep `PRESET_SIZES` and the 6–200 validation; use `ptFromMarkValue` + `resolveDisplay` for the displayed value and mixed handling; apply via `applyValueForMarkSafe`:

```typescript
export function BuildFontSizeInput(config: { type: string; default?: string; iconClass?: string }) {
  const PRESET_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

  return class FontSizeInput extends React.Component<
    ComposerEditorPluginToolbarComponentProps,
    { open: boolean; inputValue: string }
  > {
    _el: HTMLDivElement;
    state = { open: false, inputValue: '' };

    _displayed() {
      const distinct = collectMarkValues(this.props.value, config.type).map((v) =>
        ptFromMarkValue(v)
      );
      return resolveDisplay(distinct, config.default || '');
    }

    _apply = (raw: string) => {
      const pt = parseInt(raw, 10);
      const markValue = pt >= 6 && pt <= 200 ? String(pt) + 'pt' : null;
      applyValueForMarkSafe(this.props.editor, config.type, markValue);
      this.setState({ open: false });
    };

    _toggleOpen = (e: React.MouseEvent) => {
      e.preventDefault();
      const current = this._displayed();
      this.setState({ open: !this.state.open, inputValue: current.display });
    };

    _onBlur = (e: React.FocusEvent) => {
      if (!this._el.contains(e.relatedTarget as Node)) this.setState({ open: false });
    };

    render() {
      const { open, inputValue } = this.state;
      const { display } = this._displayed();
      return (
        <div
          className={`${this.props.className} font-size-picker`}
          tabIndex={-1}
          ref={(el) => (this._el = el)}
          onBlur={this._onBlur}
        >
          <button className="dropdown-toggle" onMouseDown={this._toggleOpen}>
            <i className={config.iconClass || 'fa fa-text-height'} />
            <span className="value">{display}</span>
            <i className="fa fa-caret-down" />
          </button>
          {open && (
            <div className="dropdown menu">
              <input
                type="number"
                min={6}
                max={200}
                autoFocus
                value={inputValue}
                onChange={(e) => this.setState({ inputValue: e.target.value })}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') this._apply((e.target as HTMLInputElement).value);
                  e.stopPropagation();
                }}
              />
              {PRESET_SIZES.map((size) => (
                <div
                  key={size}
                  className={`item ${String(size) === display ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    this._apply(String(size));
                  }}
                >
                  {String(size) === display && <i className="fa fa-check" />}
                  {size}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
  };
}
```

- [ ] **Step 2: Run lint + tests**

Run: `npm run lint && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/composer-editor/toolbar-component-factories.tsx
git commit -m "feat(composer): rebuild font-size control as a styled dropdown with mixed-selection handling"
```

---

## Task 5: Clipboard toolbar section (Cut/Copy/Paste/Paste-plain/Format Painter)

**Files:**
- Create: `app/src/components/composer-editor/clipboard-plugins.tsx`
- Modify: `app/src/components/composer-editor/conversion.tsx` (register the plugin)
- Test: `app/spec/composer-clipboard-plugins-spec.ts`

**Interfaces:**
- Consumes: Electron `clipboard`; `SanitizeTransformer`/`InlineStyleTransformer` from `mailspring-exports`; `convertFromHTML`/`convertToHTML`/`convertToPlainText` from `./conversion`; `safeActiveMarks`, `applyValueForMark` from `./toolbar-component-factories`; `captureCharacterMarks`, `canCopyOrCut`, `canPaint`, `TOGGLE_MARK_TYPES`, `VALUE_MARK_TYPES`, `CapturedMark` from `./toolbar-utils`.
- Produces:
  - default export `ClipboardPlugins: ComposerEditorPlugin[]`
  - `copySelectionToClipboard(editor, clipboard): boolean` — writes html+text, returns false if nothing copied
  - `pasteFromClipboard(editor, clipboard): void`
  - `pastePlainFromClipboard(editor, clipboard): void`
  - `applyCapturedMarks(editor, captured: CapturedMark[]): void`

To keep Slate orchestration testable, the four operations above are module-level functions taking the editor + clipboard as parameters, and tested with a fake editor/clipboard (the codebase pattern of testing extracted functions).

- [ ] **Step 1: Write the failing test**

Create `app/spec/composer-clipboard-plugins-spec.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../clipboard-plugins'`.

- [ ] **Step 3: Write the implementation**

Create `app/src/components/composer-editor/clipboard-plugins.tsx`:

```typescript
import React from 'react';
import { Editor, Value, Range } from 'slate';
import { clipboard as ElectronClipboard } from 'electron';
import { localized, InlineStyleTransformer, SanitizeTransformer } from 'mailspring-exports';
import { ComposerEditorPlugin, ComposerEditorPluginToolbarComponentProps } from './types';
import { convertFromHTML, convertToHTML, convertToPlainText } from './conversion';
import { safeActiveMarks, applyValueForMark } from './toolbar-component-factories';
import {
  captureCharacterMarks,
  canCopyOrCut,
  canPaint,
  TOGGLE_MARK_TYPES,
  VALUE_MARK_TYPES,
  CapturedMark,
} from './toolbar-utils';

type ClipboardLike = Pick<typeof ElectronClipboard, 'writeText' | 'write' | 'readText' | 'readHTML'>;

// --- Slate orchestration (tested with a fake editor/clipboard) ---

export function copySelectionToClipboard(editor: Editor, clipboard: ClipboardLike): boolean {
  if (editor.value.selection.isCollapsed) return false;
  const range = editor.value.selection as any as Range;
  const fragment = editor.value.document.getFragmentAtRange(range);
  const value = Value.create({ document: fragment });
  const text = convertToPlainText(value);
  if (!text) return false;
  clipboard.write({ text, html: convertToHTML(value) });
  return true;
}

export function pasteFromClipboard(editor: Editor, clipboard: ClipboardLike) {
  let html = clipboard.readHTML();
  if (html) {
    html = SanitizeTransformer.runSync(html);
    try {
      html = InlineStyleTransformer.runSync(html);
    } catch (err) {
      // no-op — fall through to whatever sanitize produced
    }
    const value = convertFromHTML(html);
    if (value && value.document) {
      editor.insertFragment(value.document);
      return;
    }
  }
  const text = clipboard.readText();
  if (text) editor.insertText(text);
}

export function pastePlainFromClipboard(editor: Editor, clipboard: ClipboardLike) {
  const text = clipboard.readText();
  if (text) editor.insertText(text);
}

// Apply a captured set of character marks to the current selection so it matches the
// source: captured toggle marks are turned on, uncaptured ones off; value marks are set
// to the captured value or cleared.
export function applyCapturedMarks(editor: Editor, captured: CapturedMark[]) {
  const types = new Set(captured.map((c) => c.type));
  const active = safeActiveMarks(editor.value);
  for (const t of TOGGLE_MARK_TYPES) {
    const present = active.some((m) => m.type === t);
    if (types.has(t) && !present) editor.addMark(t);
    if (!types.has(t) && present) editor.removeMark(active.find((m) => m.type === t));
  }
  for (const t of VALUE_MARK_TYPES) {
    const c = captured.find((x) => x.type === t);
    applyValueForMark(editor, t, c ? c.value : null);
  }
  editor.focus();
}

// --- Toolbar buttons ---

function ClipboardButton({
  icon,
  title,
  disabled,
  onMouseDown,
  active,
  className,
}: {
  icon: string;
  title: string;
  disabled?: boolean;
  active?: boolean;
  className: string;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      className={`${className} ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) onMouseDown(e);
      }}
    >
      <i title={title} className={icon} />
    </button>
  );
}

const CutButton = (props: ComposerEditorPluginToolbarComponentProps) => (
  <ClipboardButton
    className={props.className}
    icon="fa fa-scissors"
    title={localized('Cut')}
    disabled={!canCopyOrCut(props.value.selection.isCollapsed)}
    onMouseDown={() => {
      if (copySelectionToClipboard(props.editor, ElectronClipboard)) {
        props.editor.delete();
      }
    }}
  />
);

const CopyButton = (props: ComposerEditorPluginToolbarComponentProps) => (
  <ClipboardButton
    className={props.className}
    icon="fa fa-copy"
    title={localized('Copy')}
    disabled={!canCopyOrCut(props.value.selection.isCollapsed)}
    onMouseDown={() => copySelectionToClipboard(props.editor, ElectronClipboard)}
  />
);

const PasteButton = (props: ComposerEditorPluginToolbarComponentProps) => (
  <ClipboardButton
    className={props.className}
    icon="fa fa-clipboard"
    title={localized('Paste')}
    onMouseDown={() => pasteFromClipboard(props.editor, ElectronClipboard)}
  />
);

const PastePlainButton = (props: ComposerEditorPluginToolbarComponentProps) => (
  <ClipboardButton
    className={props.className}
    icon="fa fa-clipboard"
    title={localized('Paste as plain text')}
    onMouseDown={() => pastePlainFromClipboard(props.editor, ElectronClipboard)}
  />
);

// Format Painter — one-shot. Click captures the character marks at the current selection
// and arms; the next non-collapsed selection has those marks applied, then it disarms.
// Esc or a second click cancels.
class FormatPainterButton extends React.Component<
  ComposerEditorPluginToolbarComponentProps,
  { armed: boolean }
> {
  _captured: CapturedMark[] = [];
  state = { armed: false };

  componentDidUpdate(prevProps: ComposerEditorPluginToolbarComponentProps) {
    if (!this.state.armed) return;
    const sel = this.props.value.selection;
    const prevSel = prevProps.value.selection;
    // Apply once the user has made a NEW non-collapsed selection.
    if (!sel.isCollapsed && sel !== prevSel) {
      applyCapturedMarks(this.props.editor, this._captured);
      this._disarm();
    }
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this._onKeyDown);
  }

  _onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this._disarm();
  };

  _disarm = () => {
    document.removeEventListener('keydown', this._onKeyDown);
    if (this.state.armed) this.setState({ armed: false });
  };

  _onMouseDown = () => {
    if (this.state.armed) {
      this._disarm();
      return;
    }
    this._captured = captureCharacterMarks(safeActiveMarks(this.props.value) as any);
    if (!canPaint(this._captured)) return;
    document.addEventListener('keydown', this._onKeyDown);
    this.setState({ armed: true });
  };

  render() {
    const captured = captureCharacterMarks(safeActiveMarks(this.props.value) as any);
    return (
      <ClipboardButton
        className={this.props.className}
        icon="fa fa-paint-brush"
        title={localized('Format Painter')}
        active={this.state.armed}
        disabled={!this.state.armed && !canPaint(captured)}
        onMouseDown={this._onMouseDown}
      />
    );
  }
}

const ClipboardPlugin: ComposerEditorPlugin = {
  toolbarSectionClass: 'clipboard-section',
  toolbarComponents: [
    CutButton,
    CopyButton,
    PasteButton,
    PastePlainButton,
    FormatPainterButton,
  ],
};

const ClipboardPlugins: ComposerEditorPlugin[] = [ClipboardPlugin];
export default ClipboardPlugins;
```

- [ ] **Step 4: Register the plugin**

In `app/src/components/composer-editor/conversion.tsx`, add the import after the other plugin imports (after line 24):

```typescript
import ClipboardPlugins from './clipboard-plugins';
```

And add it to the `plugins` array (after line 23 `import GrammarCheckPlugins`) — place it first so the clipboard section renders at the start of the toolbar:

```typescript
export const plugins: ComposerEditorPlugin[] = [
  ...ClipboardPlugins,
  ...InlineAttachmentPlugins,
  ...UneditablePlugins,
  ...BaseMarkPlugins,
  ...TemplatePlugins,
  ...EmojiPlugins,
  ...GrammarCheckPlugins,
  ...LinkPlugins,
  ...BaseBlockPlugins,
  ...MarkdownPlugins,
];
```

Note: `ClipboardPlugins` has no `rules`, so its position in the array does not affect HTML deserialization — only toolbar order.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `composer-clipboard-plugins-spec` green.

- [ ] **Step 6: Run lint, then commit**

Run: `npm run lint && npm test`
Expected: PASS.

```bash
git add app/src/components/composer-editor/clipboard-plugins.tsx app/src/components/composer-editor/conversion.tsx app/spec/composer-clipboard-plugins-spec.ts
git commit -m "feat(composer): add clipboard toolbar section with Format Painter"
```

---

## Task 6: Toolbar styling

**Files:**
- Modify: `app/internal_packages/composer/styles/composer.less`

**Interfaces:**
- Consumes: the class names emitted by Tasks 3–5 (`.font-face-picker`, `.font-size-picker`, `.dropdown-toggle`, `.menu`, `.item`, `.clipboard-section`).
- Produces: visual styling only.

This task is verified visually (Task 7). No spec.

- [ ] **Step 1: Add styles**

In `app/internal_packages/composer/styles/composer.less`, inside the existing `.RichEditor-toolbar { … }` block (around line 105–183, alongside `.color-picker` / `.link-picker`), add:

```less
.clipboard-section {
  button.disabled {
    opacity: 0.35;
    cursor: default;
  }
  button.active {
    background: fade(@accent-color, 20%);
  }
}

.font-face-picker,
.font-size-picker {
  position: relative;
  display: inline-flex;
  align-items: center;

  .dropdown-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border: 1px solid fade(@border-color-divider, 60%);
    border-radius: 3px;
    background: transparent;
    font-size: 12px;
    cursor: pointer;

    .value {
      min-width: 22px;
      text-align: left;
    }
    &:hover { background: fade(@black, 6%); }
  }

  .menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 10;
    min-width: 140px;
    max-height: 280px;
    overflow-y: auto;
    padding: 4px 0;
    background: @fill-secondary;
    border: 1px solid @border-color-divider;
    border-radius: 4px;
    box-shadow: 0 2px 8px fade(@black, 25%);

    input {
      display: block;
      width: calc(100% - 12px);
      margin: 2px 6px 4px;
      padding: 2px 4px;
      box-sizing: border-box;
    }

    .item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      cursor: pointer;
      white-space: nowrap;

      &:hover { background: fade(@accent-color, 12%); }
      &.active { font-weight: 600; }
      .fa-check { width: 12px; }
    }
    .divider {
      height: 1px;
      margin: 4px 0;
      background: @border-color-divider;
    }
  }
}

.font-size-picker .menu { min-width: 72px; }
```

If any of the referenced LESS variables (`@accent-color`, `@border-color-divider`, `@fill-secondary`, `@black`) are not in scope, substitute the nearest existing variable used elsewhere in `composer.less` (grep the file for `@` to see what's available) or a literal color.

- [ ] **Step 2: Run lint, then commit**

Run: `npm run lint`
Expected: PASS (LESS is compiled at build; lint covers JS/TS — confirm no TS files changed broke).

```bash
git add app/internal_packages/composer/styles/composer.less
git commit -m "style(composer): style font dropdowns and clipboard toolbar section"
```

---

## Task 7: Integration verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Full lint + test**

Run: `npm run lint && npm test`
Expected: PASS — all specs green, no lint errors.

- [ ] **Step 2: Launch the dev app**

Follow the project's dev/verify workflow (see `memory/dev-verify-workflow.md`): start the dev app, open a compose window in HTML (rich-text) mode.

- [ ] **Step 3: Manual verification checklist**

Type/select text in a draft and confirm each:

Font family:
- Dropdown shows the active family; selecting a family applies it and the button updates.
- Selecting text spanning two families shows a blank family button (mixed).
- "Custom…" lets you type an arbitrary family and apply it.
- Applying a family does not drop bold/italic/color/size on the selection.

Font size:
- Dropdown shows the active size in pt; presets apply; the custom number input applies on Enter.
- Mixed-size selection shows a blank size button.
- A size out of range (e.g. 500) is rejected (no mark applied); 6–200 works.
- Applying a size does not drop bold/italic/color/face.

Clipboard:
- Cut/Copy are disabled with no selection; with a selection, Copy then Paste reproduces formatted content; Cut removes it.
- Paste-as-plain-text inserts unformatted text.
- Copy/paste of content from an external app (e.g. a browser) is sanitized and inserted.
- Copy inside the quoted-text region falls back to default behavior (no corruption).

Format Painter:
- Select formatted text, click Format Painter (button highlights/armed), then select other text → it takes on the source formatting and the button disarms.
- Esc while armed cancels.
- Button is disabled when the current selection has no character formatting to copy.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "fix(composer): address toolbar polish verification findings"
```

---

## Self-Review Notes

- **Spec coverage:** Clipboard section (Task 5), Paste-as-plain (Task 5), Format Painter one-shot/character-marks (Task 5), font restyle (Tasks 3–4), expanded Outlook font list (Task 2), mixed/collapsed handling (Tasks 1/3/4), mark-preservation invariant (Tasks 1–2), Jasmine specs + lint/test gating (all tasks + Task 7). All spec sections map to tasks.
- **Type consistency:** `applyValueForMarkSafe`, `collectMarkValues`, `captureCharacterMarks`, `marksToReapply`, `applyCapturedMarks`, `copySelectionToClipboard`, `pasteFromClipboard`, `pastePlainFromClipboard` are referenced with the same signatures across tasks. `CapturedMark`/`CHARACTER_MARK_TYPES`/`TOGGLE_MARK_TYPES`/`VALUE_MARK_TYPES` come from `toolbar-utils.ts` (Task 1) and are consumed in Tasks 2–5.
- **Known risk to watch during execution:** the exact single-file Jasmine invocation may differ from the repo's runner; if `npx jasmine …` doesn't work, use `npm test` (runs the full suite) — confirm the runner command early in Task 1.
```
