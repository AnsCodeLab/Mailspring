# Composer Toolbar Polish — Design

**Date:** 2026-06-28
**Status:** Approved (design), pending implementation plan
**Scope:** Rich-text composer toolbar only. This is project **A** of a larger effort
(A = toolbar polish, B = AI integration). AI work is out of scope here and tracked separately.

## Goal

Polish the Mailspring composer's rich-text formatting toolbar to feel like Outlook:

1. **Clipboard section** — add Cut, Copy, Paste, Paste-as-plain-text, and Format Painter
   toolbar buttons.
2. **Font & size controls** — replace the current bare text-input + `<datalist>` controls
   with clean, on-brand dropdown menus that show the current value, and expand the font
   list to an Outlook-style set.
3. **Edge cases** — fix the "feels buggy" behavior, primarily marks being silently dropped
   when applying a font or size, and correct value resolution for mixed/collapsed selections.

## Background / Current State

The composer uses **Slate 0.47.x** for rich-text editing. The toolbar is assembled from
Slate plugins, each contributing `toolbarComponents`.

Key files:

- `app/src/components/composer-editor/composer-editor.tsx` — editor component; existing
  `onCopy` / `onCut` / `onPaste` handlers (lines ~205–285), including the uneditable/quoted
  region guard and the sanitize → inline-style → `convertFromHTML` paste path.
- `app/src/components/composer-editor/composer-editor-toolbar.tsx` — toolbar renderer;
  filters plugins with `toolbarComponents`, renders sections with dividers.
- `app/src/components/composer-editor/toolbar-component-factories.tsx` — factory functions
  for toolbar controls. Contains `BuildFontFacePicker` (text input + `<datalist>`) and
  `BuildFontSizeInput` (custom number input + preset list), and the `applyValueForMark`
  helper.
- `app/src/components/composer-editor/base-mark-plugins.tsx` — character marks
  (bold/italic/underline/strike/color/`face`/`size`); `MARK_CONFIG`, default font options,
  and the current manual mark save/restore logic.
- `app/src/components/composer-editor/conversion.tsx` — master plugin array (order matters)
  and HTML ↔ Slate value conversion.
- `app/src/components/composer-editor/types.ts` — `ComposerEditorPlugin` interface
  (`toolbarComponents`, `toolbarSectionClass`, `appCommands`, `rules`, etc.).

Font family is applied as a `face` mark (`<font style="font-family">`), font size as a
`size` mark (`<font style="font-size">` / `<font size>`), with pt/px/em/legacy-numeric
conversion. Default face `sans-serif`, default size `11pt`.

## Non-Goals

- No changes to the plaintext composer.
- No block-level format copying in Format Painter (lists/quotes/headings excluded).
- No AI features.
- No change to the on-the-wire HTML serialization format for marks (still `<font>`-based),
  so existing drafts and sent mail render unchanged.

## Approach

Work entirely within the existing Slate-plugin toolbar pattern.

- New plugin `clipboard-plugins.tsx` for the clipboard section, registered in
  `conversion.tsx`'s plugin array. Operates directly on the Slate editor and Electron's
  `clipboard` module, **reusing** the existing sanitize/convert helpers from the editor's
  `onPaste`.
- Rewrite the two font controls in `toolbar-component-factories.tsx`.

Rejected alternatives:

- `document.execCommand('copy'/'paste')` — `paste` is frequently blocked in Electron
  renderers, no control over sanitization, cannot support Format Painter.
- The legacy `ComposerExtension` toolbar API — wrong layer (legacy contenteditable, not the
  Slate toolbar).

## Section 1 — Clipboard toolbar section

New file: `app/src/components/composer-editor/clipboard-plugins.tsx`, exporting a
`ComposerEditorPlugin` with a `toolbarComponents` array and a `toolbarSectionClass` (so it
renders as its own divided section). Registered in `conversion.tsx`'s plugin array.

All buttons use the existing `onMouseDown` + `event.preventDefault()` pattern so the editor
never blurs / loses its selection. Buttons disable themselves when not applicable.

Buttons:

- **Cut** — serialize the selected Slate fragment to HTML + plain text, write both to
  Electron `clipboard`, then delete the selection. Disabled on collapsed selection.
- **Copy** — same as Cut without deletion. Disabled on collapsed selection.
- **Paste** — read `clipboard` HTML (fallback to text), run through the same
  `SanitizeTransformer.runSync` → `InlineStyleTransformer.runSync` → `convertFromHTML`
  pipeline the editor's `onPaste` uses, then `insertFragment`. Empty/non-text clipboard is a
  no-op.
- **Paste as plain text** — read `clipboard` text and `insertText` (drops formatting;
  inserts at cursor on a collapsed selection, replaces range otherwise).
- **Format Painter** — one-shot. Click captures the character marks
  (bold/italic/underline/strike/color/`face`/`size`) at the current selection and "arms" a
  painter controller. The next non-collapsed selection has those marks applied, then it
  disarms. Esc cancels; a second click disarms; arming then interacting with another toolbar
  control cancels paint. Disabled when nothing meaningful is captured.

Format Painter state (armed flag + captured marks) lives in a small controller scoped to the
editor instance, not module-global, so multiple composer windows don't interfere. The
"apply on next selection" hook runs off the editor's change/selection event.

All clipboard ops respect the existing uneditable/quoted-region guard (as `onCopy` already
does) so quoted text can't be corrupted.

## Section 2 — Font & size controls restyle

Rewrite `BuildFontFacePicker` and `BuildFontSizeInput` in
`toolbar-component-factories.tsx` as proper dropdown menus, styled with the existing toolbar
LESS to be on-brand: a button showing the **current value** with a caret, opening a clean
menu on click. Use the component-kit's existing menu/dropdown primitives (open/close,
outside-click dismissal, ↑/↓/Enter/Esc keyboard nav) instead of the hand-rolled
`<datalist>`, which is the source of the current clunky feel.

**Font family dropdown**

- Button shows the active face label (e.g. "Sans Serif"); blank/placeholder when the
  selection spans mixed faces.
- Menu lists the faces below, each rendered in its own font as a live preview (graceful
  fallback if not installed locally), active one checkmarked, hover states.
- A divider + "Custom…" row preserves typing an arbitrary family.
- Expanded Outlook-style list, grouped:
  - **Generic (always work):** Sans Serif, Serif, Fixed Width
  - **Theme/common:** Calibri, Cambria, Candara, Consolas, Constantia, Corbel, Segoe UI
  - **Classic web-safe:** Arial, Arial Black, Comic Sans MS, Courier New, Garamond, Georgia,
    Impact, Lucida Console, Palatino Linotype, Tahoma, Times New Roman, Trebuchet MS, Verdana
- Applied marks carry a generic CSS fallback (e.g. `Calibri, sans-serif`) so mail degrades
  nicely on machines without the font. `DEFAULT_FONT_FACE_OPTIONS` in `base-mark-plugins.tsx`
  is expanded accordingly.

**Font size dropdown**

- Button shows the active size in pt; blank when mixed.
- Menu lists presets `[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]`, active one
  checkmarked, plus a small number input at the top to type a custom size (validated
  6–200pt, same as today).
- Keeps the existing pt/px/em/legacy-numeric conversion so values read back correctly from
  pasted mail.

Both controls apply via the hardened `applyValueForMarkSafe` helper (Section 3).

## Section 3 — Edge cases & testing

**Selection / value resolution**

- Mixed selection (spans two faces or sizes) → control shows blank, not a wrong/first value;
  applying unifies the range.
- Collapsed cursor → setting face/size sets the mark for the next typed text (Slate
  marks-at-cursor), matching how bold behaves today.
- Read-back from pasted mail → pt/px/em/legacy-numeric all resolve to the displayed pt value.

**Mark preservation (core current bug)**

- Consolidate the existing remove+re-add + manual re-apply logic into a single helper
  `applyValueForMarkSafe(editor, type, value)` used by both font and size controls.
- Invariant under test: applying a `size` never drops bold/italic/underline/color/`face`,
  and applying a `face` never drops the others.

**Clipboard / Format Painter**

- Cut/Copy disabled on collapsed selection.
- Paste-as-plain on collapsed cursor inserts at cursor.
- Copy/Cut spanning or inside a quoted/uneditable region falls back to the existing guard.
- Format Painter: capture from collapsed cursor grabs cursor marks; nothing meaningful
  captured → button disabled; Esc / second click disarms; arming then clicking a different
  toolbar control cancels paint.
- Paste with empty/non-text clipboard is a no-op (no crash).

**Testing** — Jasmine specs under `app/spec/`:

- `clipboard-plugins-spec` — mock Electron `clipboard`; cover cut/copy/paste/paste-plain and
  Format Painter arm → apply → disarm, plus disabled-state logic.
- `toolbar-marks-spec` — value resolution (mixed / collapsed / unit conversion) and the
  mark-preservation invariant.
- Manual verification in the dev app per the existing dev/verify workflow.
- `npm run lint` and `npm test` must pass.

## Risks

- **Cross-platform fonts:** Office-only fonts won't preview locally on Linux/macOS. Mitigated
  by generic CSS fallbacks in applied marks and graceful preview fallback. Matches Outlook
  behavior.
- **Slate 0.47 marks-at-cursor quirks:** collapsed-selection mark application can be finicky;
  covered by specs.
- **Electron `clipboard` access from the renderer:** confirm the module is reachable in the
  composer window (likely via `@electron/remote`); if not, route through a small main-process
  helper.

## Files Touched (anticipated)

- New: `app/src/components/composer-editor/clipboard-plugins.tsx`
- Edit: `app/src/components/composer-editor/conversion.tsx` (register plugin)
- Edit: `app/src/components/composer-editor/toolbar-component-factories.tsx` (font/size
  dropdowns, `applyValueForMarkSafe`)
- Edit: `app/src/components/composer-editor/base-mark-plugins.tsx` (expanded font options,
  use of `applyValueForMarkSafe`)
- Styles: relevant toolbar LESS for the new dropdowns and clipboard section
- New specs: `app/spec/.../clipboard-plugins-spec`, `app/spec/.../toolbar-marks-spec`
