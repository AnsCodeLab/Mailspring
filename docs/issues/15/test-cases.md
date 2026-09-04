## Part A

### TC-A1: Right-click image → "Original" resets to natural size

- **Preconditions**: A composer draft with an inline image attachment that has previously
  been resized (drag-resize or a different preset), so `imgProps.width`/`.height` are set.
- **Steps**: Right-click the image. Open the "Size" submenu. Click "Original".
- **Expected result**: `computeImagePresetSize('original', naturalWidth, naturalHeight)`
  returns `undefined`, so `onResized(undefined, undefined)` is called — the exact same call
  `inline-attachment-plugins.tsx`'s `ImageNode` already wires into
  `newN.data.set('imgProps', { width: undefined, height: undefined })`. `renderImage()`'s
  existing `if (imgProps.height)` / `if (imgProps.width)` truthy guards mean no inline
  `px` CSS is applied, so the `<img>` renders at its natural browser-default size — zero
  new rendering code needed for this case.
- **Automated coverage**: `computeImagePresetSize` "returns undefined for 'original'
  (clears imgProps, falls back to natural size)".

### TC-A2: Right-click image → "Large" resizes to max 600px wide, preserving aspect ratio

- **Preconditions**: An inline image wider than 600px natural width.
- **Steps**: Right-click the image. Open the "Size" submenu. Click "Large".
- **Expected result**: `computeImagePresetSize('large', naturalWidth, naturalHeight)`
  returns `{ width: min(naturalWidth, 600), height: width * naturalHeight / naturalWidth }`.
  `onResized(width, height)` is called with that exact result — the same call the
  drag-resize handler (`_resizeEnd`) already makes, so persistence (`imgProps` on the Slate
  node, HTML `width`/`height` attrs on send) reuses the existing, unchanged path.
- **Automated coverage**: `computeImagePresetSize` "scales 'large' down to 600 wide,
  preserving aspect ratio" (landscape) and "scales 'large' to 600 wide / 1200 tall"
  (portrait, confirms height-side aspect-ratio math).

### TC-A3: Right-click image → "Medium" resizes to max 320px wide, preserving aspect ratio

- **Preconditions**: An inline image wider than 320px natural width.
- **Steps**: Right-click the image. Open the "Size" submenu. Click "Medium".
- **Expected result**: `computeImagePresetSize('medium', naturalWidth, naturalHeight)`
  returns `{ width: min(naturalWidth, 320), height: width * naturalHeight / naturalWidth }`,
  wired to `onResized` exactly as TC-A2.
- **Automated coverage**: `computeImagePresetSize` "scales 'medium' down to 320 wide,
  preserving aspect ratio" and "scales 'medium' to 320 wide / 640 tall".

### TC-A4: Right-click image → "Small" resizes to max 160px wide, preserving aspect ratio

- **Preconditions**: An inline image wider than 160px natural width.
- **Steps**: Right-click the image. Open the "Size" submenu. Click "Small".
- **Expected result**: `computeImagePresetSize('small', naturalWidth, naturalHeight)`
  returns `{ width: min(naturalWidth, 160), height: width * naturalHeight / naturalWidth }`,
  wired to `onResized` exactly as TC-A2.
- **Automated coverage**: `computeImagePresetSize` "scales 'small' down to 160 wide,
  preserving aspect ratio" and "scales 'small' to 160 wide / 320 tall".

### TC-A5: Presets never upscale an image already smaller than the preset target

- **Preconditions**: An inline image whose natural width (e.g. 100px) is smaller than
  every preset's max width (160/320/600).
- **Steps**: Right-click the image. Click "Large", then "Medium", then "Small" in turn.
- **Expected result**: Every preset resolves to `{ width: naturalWidth, height:
  naturalHeight }` (the `Math.min(naturalWidth, presetMax)` clamp never exceeds the
  natural width) — the image is never stretched larger than its real size.
- **Automated coverage**: `computeImagePresetSize` "never upscales 'large'/'medium'/
  'small' beyond the natural size" (all three preset cases against a 100x50 image).

### TC-A6: "Size" submenu shows a radio-checked state for the currently active preset

- **Preconditions**: An inline image currently resized to the "Medium" preset's width
  (`imgProps.width === computeImagePresetSize('medium', naturalWidth, naturalHeight).width`).
- **Steps**: Right-click the image. Open the "Size" submenu.
- **Expected result**: The "Medium" entry shows Electron's native radio-checked state
  (`type: 'radio'`, `checked: true`); the other three entries are unchecked. This is a
  manual/visual check only — Electron's native context menu isn't inspectable from the
  Jasmine or Playwright suites in this sandbox (no existing precedent), so it isn't
  automated; the `active` boolean fed into each preset's menu-item config is exercised
  indirectly by `computeImagePresetSize`'s exact-`{width,height}` assertions, which is
  what the `active` comparison is keyed off of.

### TC-A7: No regression to the existing Open/Save context-menu items on plain (non-image)
attachments

- **Preconditions**: A non-image file attachment (`AttachmentItem`, not
  `ImageAttachmentItem`).
- **Steps**: Right-click the attachment.
- **Expected result**: The context menu still shows exactly Open / Remove / Preview / Save
  Into..., with no "Size" submenu — `buildContextMenu`'s new `sizePresets` param is
  optional, and `AttachmentItem`'s call site never passes it, so `if (fns.sizePresets)`
  never pushes the new menu entry for this caller. Zero behavior change.
- **Automated coverage**: None needed beyond code review (per the plan, this is UI/DOM
  logic with no existing spec convention for asserting native `Menu` contents) — verified
  by reading `AttachmentItem`'s `onContextMenu` call site directly: it does not pass
  `sizePresets`, so the new code path is unreachable for it.

### TC-A8: No regression to the existing drag-resize handle

- **Preconditions**: An inline image.
- **Steps**: Drag the resize handle in the bottom-right corner of the image.
- **Expected result**: `_resizeStart`/`_resizeImage`/`_resizeEnd` behave exactly as before
  — unmodified by this change. `_resizeEnd` still calls `this.props.onResized(img.width,
  img.height)` directly from the live DOM element's rendered size, entirely independent of
  the new `computeImagePresetSize`/context-menu code path.
- **Automated coverage**: None needed — no lines in `_resizeStart`/`_resizeImage`/
  `_resizeEnd` were touched by this change; verified by code review/diff.
