# Issue #7 — Test Cases

Scenario / preconditions / steps / expected result for each of the 10 toolbar
features. "Composer" = any composer window (popout via `c`, or an inline
reply) with the rich-text (non-plaintext) editor active.

## 1. Undo / Redo

**Preconditions:** Composer open, cursor in the body.

**Steps:**
1. Select some typed text and click the Bold button (first section of the
   toolbar, leftmost — icon `fa-undo` / `fa-repeat`).
2. Click the Undo button.
3. Click the Redo button.

**Expected result:** After step 2 the bold mark is removed from the text.
After step 3 the bold mark is reapplied. Both buttons are always present and
enabled; clicking them never throws even with an empty history stack.

## 2. Paragraph-style dropdown (Normal / Heading 1 / Heading 2 / Quote)

**Preconditions:** Composer open, cursor in a plain paragraph.

**Steps:**
1. Type some text.
2. Open the paragraph-style `<select>` (first control in the block-format
   section) and choose "Heading 1".
3. Choose "Normal" again.
4. Move the cursor inside a list item or blockquote.

**Expected result:** Step 2 converts the current block to `<h1>` (verified
via `heading_one`/`<h1>` in the DOM and on HTML export). Step 3 converts it
back to a plain paragraph (`div`). Step 4: the dropdown is visibly disabled
(not hidden) — its `disabled` attribute is set and it carries a `disabled`
CSS class — because converting a block in place isn't nesting-safe inside a
list item or blockquote.

## 3. Text alignment (left / center / right / justify)

**Preconditions:** Composer open, cursor in a plain paragraph.

**Steps:**
1. Type some text.
2. Click the "Align center" button in the alignment button group.
3. Click "Align center" again.
4. Click "Align right".
5. Move the cursor into a heading, blockquote, or list item.

**Expected result:** Step 2 applies `text-align: center` inline style to the
paragraph and marks the center button `active`; the other three buttons stay
inactive (mutually exclusive). Step 3 (clicking the already-active button)
clears the alignment. Step 4 switches to `text-align: right` and moves the
`active` class to the right button. Step 5: the whole button group is
disabled (not hidden). Alignment survives HTML export/import round-trip,
including on an emptied-out (bare `<br>`-exporting) paragraph.

## 4. Highlight (background) color

**Preconditions:** Composer open, some text typed and selected.

**Steps:**
1. Click the highlight swatch (second color-picker in the mark toolbar
   section, right after the text-color picker).
2. Click a color swatch in the dropdown.
3. Re-open the picker and click the "No highlight" clear control.

**Expected result:** Step 2 wraps the selection in `<span
style="background-color: …">`. Step 3 removes the highlight mark entirely
(the picker's own `CompactPicker` swatches can never produce the literal
value `transparent`, so an explicit clear affordance is required and
present). Highlight round-trips through HTML export/import via
`background-color` detection.

## 5. Indent / Outdent buttons

**Preconditions:** Composer open, cursor in a plain paragraph.

**Steps:**
1. Type some text.
2. Click the Indent button (icon `fa-indent`).
3. Click the Outdent button (icon `fa-outdent`).
4. Press `Cmd/Ctrl+]` (existing keyboard shortcut) and `Cmd/Ctrl+[`.

**Expected result:** Step 2 converts the paragraph into a `blockquote`. Step
3 converts it back to a plain paragraph. Step 4 produces the identical
result via the keyboard app-commands, which now call the same
`indentBlock`/`outdentBlock` functions the buttons use (no behavior change
from before this issue).

## 6. Superscript / Subscript

**Preconditions:** Composer open, some text typed and selected.

**Steps:**
1. Click the Superscript button (icon `fa-superscript`).
2. Select different text and click the Subscript button (icon
   `fa-subscript`).

**Expected result:** Step 1 wraps the selection in `<sup>`; the button shows
`active` while the selection is within superscripted text. Step 2 wraps its
selection in `<sub>`. Both round-trip through HTML export/import (`<sup>`/
`<sub>` tag rules) and are covered by the clear-formatting button and the
format-painter's mark set.

## 7. Clear-formatting button

**Preconditions:** Composer open, some text typed and selected.

**Steps:**
1. Apply Bold and Italic to the selection.
2. Click the Clear-formatting button (icon `fa-eraser`, rightmost in the
   mark toolbar section).

**Expected result:** Every character mark on the selection (bold, italic,
underline, strike, superscript, subscript, color, face, size, highlight) is
removed. Plain text remains untouched.

## 8. Horizontal rule

**Preconditions:** Composer open, cursor at the end of some typed text.

**Steps:**
1. Click the horizontal-rule insert button (icon `fa-minus`, its own
   toolbar section).
2. Type more text immediately after.

**Expected result:** An `<hr>` void block is inserted, followed immediately
by a new empty paragraph block — the cursor lands in that empty block (not
stranded against the void node), so step 2's typed text appears in the DOM
strictly after the `<hr>` element. `<hr>` round-trips through HTML export/
import.

## 9. Insert inline image

**Preconditions:** Composer open.

**Steps:**
1. Locate the insert-image button (icon `fa-image`) in the toolbar.
2. Click it (actionability-only — see note).

**Expected result:** The button is visible, has the `image` tooltip/title,
and is enabled/clickable — it opens a native OS file-picker dialog
(`AppEnv.showOpenDialog`) filtered to image extensions, then funnels the
selected file through `Actions.addAttachment({ inline: true, … })` →
`InlineAttachmentChanges.insert`, mirroring the existing drag/paste inline
image path. **Note:** automated tests cannot drive the native OS dialog (no
existing mock convention in this repo), so this is verified as
render/actionability-only in the e2e suite, mirrored by exercising the
`insertHorizontalRule`-style trailing-edit contract by code review of the
`Actions.addAttachment`/`InlineAttachmentChanges.insert` wiring.

## 10. Text direction (LTR/RTL) toggle

**Preconditions:** Composer open, cursor in a plain paragraph.

**Steps:**
1. Type some text.
2. Click the direction-toggle button (icon `fa-text-width`).
3. Click it again.
4. Move the cursor into a heading, blockquote, or list item.

**Expected result:** Step 2 sets an explicit `dir="rtl"` on the paragraph
(overriding Slate's own content-based auto-detection), and the button shows
`active`. Step 3 flips it back to `dir="ltr"`, explicitly, rather than
merely clearing the override. Step 5: the button is disabled (not hidden)
in headings/blockquote/list-item contexts, same as alignment. The explicit
direction is carried through HTML export even for an emptied-out paragraph
(the bare `<br>` export branch).
