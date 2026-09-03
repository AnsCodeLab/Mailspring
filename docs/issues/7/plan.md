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

## Plan Review Gate — verdict: APPROVE WITH CHANGES

Independent reviewer findings (binding — implementor must resolve each before/while implementing):

1. **Section ordering matters.** `history-plugins.tsx` must be inserted FIRST in
   `conversion.tsx#plugins` (renders leftmost toolbar section). `hr-plugins.tsx`'s position in
   the array affects HTML-deserialization rule precedence (comment at `conversion.tsx:53-54`)
   — insert it near `BaseBlockPlugins` since `<hr>` never collides with existing tag rules.
2. Plan's "one new plugin file per feature" framing is inaccurate — only history and hr are new
   files; everything else extends `MARK_CONFIG`/`BLOCK_CONFIG`/existing plugin files. Follow the
   per-item file list in "Files touched", not the framing sentence.
3. **No keymap collision**: Slate's own undo/redo already owns mod+z/mod+shift+z inside
   `[data-slate-editor]`; item 1 (undo/redo buttons) needs no new keymap entries, only buttons
   calling `editor.undo()`/`editor.redo()`.
4. **Explicit scope decision required for items 3 (align) and 10 (dir):** they only apply to
   `BLOCK_CONFIG.div`. Inside headings/blockquote/list-items the buttons must be either disabled
   (`isActive`/button disabled state) or explicitly documented as no-ops — not silently ignored.
   Decision: buttons act on the div/paragraph type only; disable (not hide) when the current
   block is heading/blockquote/list-item, consistent with how the toolbar already disables
   cut/copy (`clipboard-plugins.tsx` `canCopyOrCut` pattern).
5. **Item 9 (insert image) is fully specified, not an open question**: use
   `AppEnv.showOpenDialog(...)` → `Actions.addAttachment({ filePath, headerMessageId, inline: true, onCreated: file => InlineAttachmentChanges.insert(editor, file) })`,
   mirroring `composer-view.tsx#_onFileReceived`. `headerMessageId` comes from
   `editor.props.propsForPlugins.draft` (same access `ImageNode` already uses in
   `inline-attachment-plugins.tsx`). No new store-level plumbing needed.
6. **Items 5/7/8 need no new `BuildActionButton` factory** — `BuildToggleButton` already accepts
   any `isActive`; pass `isActive: () => false` for one-shot action buttons (indent, outdent,
   clear-formatting, insert-hr).
7. **Item 1 exact wiring**: do not guess at a Slate history-stack introspection API for
   disabled-state; ship undo/redo always-enabled (mousedown handler is a no-op if the stack is
   empty), matching how Slate's own keyboard-triggered undo/redo behaves today.
8. **Void-block boundary risk (item 8, hr)**: inserting `hr` adjacent to the document edge or
   another void node can strand the cursor with no adjacent editable text. Implementation must
   guarantee an empty `div` block is inserted immediately after every `hr` insert (same pattern
   already used for code-block insertion in `BLOCK_CONFIG.code.button.onToggle`, which chains
   `.insertBlock(code).insertText(...).insertBlock(div)`).
9. **Block-data merge is a required implementation detail, not a "verify later" item**: `div`
   node data is read via `node.data['className'] || node.data.get('className')` because it's a
   plain object on the serialize path and an Immutable.Map on the render path; the deserialize
   rule (`base-block-plugins.tsx:275-282` in the plan's line numbering) returns a single-key
   object today. Adding `align`/`dir` requires the deserialize rule to merge multiple data keys
   (className + align + dir) into one object/Map consistently on both paths — implement this
   directly, do not defer to a follow-up "verify" step.
10. **Empty-block export gap**: `div.render`'s `targetIsHTML && nodeIsEmpty(node)` branch
    returns a bare `<br {...attributes} />`, dropping `className` today and would equally drop
    `align`/`dir` styling on a blank aligned/directed paragraph. Must carry `style` through that
    branch too (e.g. `<br {...attributes} style={style} />`), not just the non-empty branch.
11. **Highlight picker default is wrong as specified**: `CompactPicker` never emits the literal
    string `'transparent'`, so a `default: 'transparent'` gives users no in-picker way to clear a
    highlight (the `hex !== config.default ? hex : null` clear gesture in `BuildColorPicker`
    never fires). Add an explicit "no highlight" swatch/eraser control, or extend
    `BuildColorPicker` with an optional clear button, rather than relying on `CompactPicker`'s
    swatch set to include the default.
12. **Heading dropdown nesting risk (item 2)**: `blockquote`'s toggle uses
    `toggleBlockTypeWithBreakout` to safely unwrap ancestors; a plain `editor.setBlocks(type)`
    for headings risks malformed nesting (e.g. `<h1>` inside `<li>`/`<blockquote>`). Decision:
    disable the heading dropdown (like items 3/10) when the current block is inside a list item
    or blockquote, rather than building a new breakout-aware heading transform.
