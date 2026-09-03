# Issue #7 — Composer toolbar: full formatting control set

## Architecture recap (verified by reading source)

`app/src/components/composer-editor/` is a Slate-based rich text editor. Formatting is
implemented as a list of `ComposerEditorPlugin` objects (`conversion.tsx#plugins`, order
matters for HTML deserialization). Each plugin may contribute:

- `toolbarComponents: React.ComponentType[]` — one toolbar *section*; sections are rendered
  in plugin-array order, separated by a `.divider` (`composer-editor-toolbar.tsx`).
- `rules: Rule[]` — `deserialize(el, next)` / `serialize(obj, children)` for HTML round-trip.
- `renderMark` / `renderNode` — React rendering for marks (inline character styling) and
  nodes (block/void elements).
- `appCommands` — keyboard-shortcut-triggered command handlers (`contenteditable:*`, wired
  in `keymaps/base.json` and displayed in preferences).

Two config-driven registries exist:
- `MARK_CONFIG` (`base-mark-plugins.tsx`) — character-level styling (bold, italic, underline,
  strike, color, size, face). `button: { iconClass, isActive, onToggle }` on an entry
  auto-generates a toggle button via `BuildToggleButton`.
- `BLOCK_CONFIG` (`base-block-plugins.tsx`) — block-level types (div, blockquote, code,
  ol_list, ul_list, list_item, heading_one, heading_two). Same `button` convention.

Reusable factories already exist in `toolbar-component-factories.tsx`:
- `BuildToggleButton` — binary on/off button from `isActive`/`onToggle`.
- `BuildColorPicker` — swatch + `CompactPicker` dropdown, generic over any value-mark type
  (works for `color` today; directly reusable for a new `highlight` mark).
- `BuildFontPicker` / `BuildFontFacePicker` / `BuildFontSizeInput` — `<select>`-based value
  mark pickers.
- `applyValueForMarkSafe` / `getActiveValueForMark` — generic value-mark helpers (any mark
  type, not just color/face/size).

Toolbar plugin order today (`conversion.tsx`): Clipboard, InlineAttachment, Uneditable,
BaseMark, Template, Emoji, GrammarCheck, Link, BaseBlock, Markdown. Only Clipboard,
BaseMark, Emoji, Link, BaseBlock currently contribute `toolbarComponents` — these are the
5 visible sections in the screenshot.

## Plan — one new plugin file per logical feature group, inserted into `conversion.tsx#plugins`

1. **`history-plugins.tsx`** (new) — Undo/Redo toolbar buttons calling `editor.undo()` /
   `editor.redo()`. No marks/blocks/serialization involved (Slate tracks history
   internally); disable via `editor.value.data` history stack length if available, else
   always-enabled (matches existing cut/copy button disпрезin pattern in
   `clipboard-plugins.tsx` `canCopyOrCut`). Own toolbar section, placed first.

2. **Paragraph-style dropdown** — extend `base-block-plugins.tsx`: new `BuildBlockTypeDropdown`
   factory (parallel to `BuildFontPicker`, `<select>` of Normal/H1/H2/Quote → `editor.setBlocks`).
   Added to `MailspringBaseBlockPlugin.toolbarComponents` (prepended, since heading_one/
   heading_two already have `render` + `rules` but no button today).

3. **Text alignment** — new `align-plugins.tsx`. Alignment is not a mark (must apply to the
   whole block), so add an `align` field to block `data` (not a new node type) via
   `editor.setNodeByKey`/`editor.setBlocks(type, { data: { align } })`. Render: `base-block-plugins.tsx`'s
   `div.render` gains `style={{ textAlign: node.data.get('align') }}`. Toggle-group of 4
   buttons (left/center/right/justify), only one active at a time — `BuildToggleButton` is
   binary per-button, so add a small `BuildAlignButtonGroup` factory. Rules: serialize emits
   `style="text-align: …"` on the wrapping `<div>`/`<p>`; deserialize reads `el.style.textAlign`
   into block data (mirrors existing `rtl` dir detection already in `div.render`).

4. **Highlight (background) color** — extend `MARK_CONFIG` with a `highlight` entry
   (`render`: `<span style={{ backgroundColor }}>`), reuse `BuildColorPicker({ type: 'highlight', default: 'transparent' })`
   appended to `BaseMarkPlugin.toolbarComponents`, plus a deserialize rule for
   `background-color` in the existing color-detection rule block.

5. **Indent / Outdent buttons** — `base-block-plugins.tsx` already implements the logic as
   `appCommands['contenteditable:indent'|'outdent']`. Factor the two bodies into exported
   `indentBlock(editor)` / `outdentBlock(editor)` functions, call them from both the
   `appCommands` and two new `BuildToggleButton`-style buttons (`isActive` always false —
   they're actions, not toggles, so a plain button, not `BuildToggleButton`) added to
   `MailspringBaseBlockPlugin.toolbarComponents`.

6. **Superscript / Subscript** — two more `MARK_CONFIG` entries (`superscript`/`subscript`,
   tags `sup`/`sub`), each with `button` for auto-generated toggle buttons via the existing
   `Object.values(MARK_CONFIG).filter(m => m.button).map(BuildToggleButton)` line — no new
   factory needed.

7. **Clear formatting** — new plain button (not toggle) in `BaseMarkPlugin.toolbarComponents`
   that removes all marks in `TOGGLE_MARK_TYPES`/`VALUE_MARK_TYPES` (already enumerated in
   `toolbar-utils.ts` for the format-painter) from the current selection.

8. **Horizontal rule** — new `hr-plugins.tsx`. New void block type `hr`, registered in
   `conversion.tsx#schema.blocks`, `renderNode` → `<hr />`, `rules` for `<hr>` tag, one insert
   button (`editor.insertBlock('hr')`, no active state).

9. **Insert inline image button** — extend `inline-attachment-plugins.tsx`: a toolbar button
   that opens a native file picker (`remote.dialog.showOpenDialog` — check existing pattern
   used by `attachments-area.tsx`/`composer-view.tsx` for the file-picker convention already
   used for regular attachments) and, on selection, funnels the file through the same
   `AttachmentStore` + `changes.insertInlineAttachment`-style path already used for
   drag/paste-based inline image insertion (`changes` export, lines 89-111 — read exact
   signature before wiring).

10. **Text direction (LTR/RTL) toggle** — `div.render` already reads
    `node.getTextDirection()` for HTML export; add a toggle button that flips an explicit
    `dir` block-data override (Slate's `getTextDirection()` auto-detects from content today,
    so this needs an explicit `dir` data field similar to `align`, checked before the
    auto-detected value).

## Files touched

- `app/src/components/composer-editor/conversion.tsx` — schema (`hr` void block), plugin
  array insertion order.
- `app/src/components/composer-editor/base-mark-plugins.tsx` — highlight, superscript,
  subscript entries; clear-formatting button.
- `app/src/components/composer-editor/base-block-plugins.tsx` — paragraph-style dropdown,
  align data + render, indent/outdent factored + buttoned, dir toggle.
- `app/src/components/composer-editor/toolbar-component-factories.tsx` — new
  `BuildBlockTypeDropdown`, `BuildAlignButtonGroup`, plain `BuildActionButton` factories.
- `app/src/components/composer-editor/history-plugins.tsx` (new) — undo/redo.
- `app/src/components/composer-editor/hr-plugins.tsx` (new) — horizontal rule.
- `app/src/components/composer-editor/inline-attachment-plugins.tsx` — insert-image button.
- `app/src/components/composer-editor/styles` (via `app/internal_packages/composer/styles/composer.less`)
  — CSS for new buttons/dropdowns/dividers, align-group active state.
- `app/spec/` — new specs for conversion round-trip (align, highlight, superscript,
  subscript, hr, dir) and active-state logic (align group, indent/outdent, heading dropdown).

## Open questions

- Exact file-picker API for step 9 (image insert) needs confirming against
  `attachments-area.tsx` before implementation — deferred to implementor, who must read that
  file first.
- `align`/`dir` as block `data` fields requires confirming Slate's `setNodeByKey`/`setBlocks`
  preserves data merge semantics without clobbering `className` already stored in `div` data
  (`base-block-plugins.tsx` `div.render` reads `node.data['className']`) — implementor must
  verify with a manual round-trip test before assuming.

## Non-goals (confirmed with user via issue body)

- Table insertion/editing.
