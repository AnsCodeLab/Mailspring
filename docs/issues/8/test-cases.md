# Issue #8 — Test cases: pasted images render inline

One scenario per acceptance criterion from the issue. Automated coverage lives in
`app/spec/composer-paste-image-spec.ts` (and the `Utils.shouldDisplayAsImage` regression
cases within it); this document maps each AC to concrete steps and expected results.

## TC-1: PNG paste inserts inline

- **Preconditions**: Composer open with focus in the editor body. Clipboard holds a
  PNG image (e.g. copied from an image viewer or "Copy Image" from a browser).
- **Steps**: Paste (Ctrl/Cmd+V) into the composer body.
- **Expected result**: `handleFilePasted` reads the clipboard `image/png` item, resolves
  extension `.png` via `extensionForClipboardMimeType`, writes a `Pasted File.png` temp
  file, and `Utils.shouldDisplayAsImage` (extension `.png` is in its accepted list, size
  within 512B–5MB) returns `true`, so the image is inserted inline rather than as a plain
  attachment.
- **Automated coverage**: `extensionForClipboardMimeType` "maps image/png to .png";
  `handleFilePasted` "still writes a pasted image/png blob to a temp file with a .png
  extension".

## TC-2: JPEG paste inserts inline (the bug this issue reports)

- **Preconditions**: Composer open with focus in the editor body. Clipboard holds a JPEG
  image with real-world MIME type `image/jpeg` (e.g. a screenshot or an image copied from
  a webpage — the common real-world case, not the nonstandard `image/jpg`).
- **Steps**: Paste (Ctrl/Cmd+V) into the composer body.
- **Expected result**: `extensionForClipboardMimeType('image/jpeg')` resolves to `.jpeg`
  (previously resolved to `''` because only the nonexistent `image/jpg` MIME type was
  mapped), the temp file is written as `Pasted File.jpeg`, `shouldDisplayAsImage` accepts
  the `.jpeg` extension, and the image is inserted inline.
- **Automated coverage**: `extensionForClipboardMimeType` "maps image/jpeg to .jpeg";
  `handleFilePasted` "writes a pasted image/jpeg blob to a temp file with a .jpeg
  extension" (direct regression test using the `Object.defineProperty` clipboard-faking
  technique).

## TC-3: GIF paste inserts inline

- **Preconditions**: Composer open with focus in the editor body. Clipboard holds a GIF
  image (`image/gif`).
- **Steps**: Paste (Ctrl/Cmd+V) into the composer body.
- **Expected result**: `extensionForClipboardMimeType('image/gif')` resolves to `.gif`,
  temp file is `Pasted File.gif`, `shouldDisplayAsImage` accepts `.gif`, image inserted
  inline.
- **Automated coverage**: `extensionForClipboardMimeType` "maps image/gif to .gif";
  `Utils.shouldDisplayAsImage` regression "accepts a .gif file".

## TC-4: BMP paste inserts inline

- **Preconditions**: Composer open with focus in the editor body. Clipboard holds a BMP
  image (`image/bmp`).
- **Steps**: Paste (Ctrl/Cmd+V) into the composer body.
- **Expected result**: `extensionForClipboardMimeType('image/bmp')` resolves to `.bmp`,
  temp file is `Pasted File.bmp`, `shouldDisplayAsImage` accepts `.bmp`, image inserted
  inline.
- **Automated coverage**: `extensionForClipboardMimeType` "maps image/bmp to .bmp";
  `Utils.shouldDisplayAsImage` regression "accepts a .bmp file".

## TC-5: WebP paste inserts inline

- **Preconditions**: Composer open with focus in the editor body. Clipboard holds a WebP
  image (`image/webp`).
- **Steps**: Paste (Ctrl/Cmd+V) into the composer body.
- **Expected result**: `extensionForClipboardMimeType('image/webp')` resolves to `.webp`,
  temp file is `Pasted File.webp`. Before this fix, `Utils.shouldDisplayAsImage`'s
  `extensions` array did not include `.webp`, so even a correctly-extensioned WebP temp
  file would have fallen back to a plain attachment — `.webp` was added to that array as
  part of this fix, so `shouldDisplayAsImage` now accepts it and the image is inserted
  inline.
- **Automated coverage**: `extensionForClipboardMimeType` "maps image/webp to .webp";
  `Utils.shouldDisplayAsImage` regression "accepts a .webp file".

## TC-6: Temp file has the correct extension per MIME type (exhaustive)

- **Preconditions**: None (pure function, no composer needed).
- **Steps**: Call `extensionForClipboardMimeType(mimeType)` for each of `image/png`,
  `image/jpeg`, `image/jpg`, `image/gif`, `image/bmp`, `image/webp`, `image/tiff`, and one
  unrecognized MIME type (`application/octet-stream`).
- **Expected result**: Each recognized MIME type resolves to its correct extension
  (`.png`, `.jpeg`, `.jpg`, `.gif`, `.bmp`, `.webp`, `.tiff` respectively); the
  unrecognized MIME type resolves to `''` (fallback preserved — this is the same
  regression guard for the original bug pattern of an unmatched type silently producing
  an extensionless file).
- **Automated coverage**: All eight `extensionForClipboardMimeType` spec cases.

## TC-7: No regression to non-image paste (stays a plain attachment)

- **Preconditions**: Composer open with focus in the editor body. Clipboard holds a file
  with an unrecognized/non-image MIME type (e.g. a `.zip` or `.pdf` file copied from a
  file manager).
- **Steps**: Paste (Ctrl/Cmd+V) into the composer body.
- **Expected result**: `extensionForClipboardMimeType` returns `''` for the unrecognized
  MIME type exactly as before this fix (unchanged fallback behavior), the temp file has no
  extension, `Utils.shouldDisplayAsImage` rejects it (extension not in its accepted list),
  and the file is attached as a plain (non-inline) attachment — unchanged from
  pre-fix behavior.
- **Automated coverage**: `extensionForClipboardMimeType` "returns an empty string for an
  unrecognized mime type"; `Utils.shouldDisplayAsImage` regression "rejects an unrelated
  extension like .txt" (same code path — an extension outside the accepted list is
  rejected regardless of whether it's empty or `.txt`).

## TC-8: No regression to drag-and-drop

- **Preconditions**: Composer open. A file (image or non-image) available to drag from the
  OS file manager.
- **Steps**: Drag the file onto the composer body and drop it.
- **Expected result**: Drag-and-drop is handled by `_onDrop` / `webUtils.getPathForFile` in
  `composer-view.tsx`, a code path that never calls `handleFilePasted` or
  `extensionForClipboardMimeType`. This fix touches neither `composer-view.tsx` nor the
  drop handler, so drag-and-drop behavior (including inline-image detection via
  `shouldDisplayAsImage` on the dropped file's real filename/extension, unaffected by the
  `.webp` addition since it only extends acceptance, not restricts it) is unchanged.
- **Automated coverage**: Not applicable for a direct test (out of scope, unmodified code
  path — confirmed by source inspection per the plan's Non-goals /
  Plan Review Gate item 3). Verified by code review: `handleFilePasted` and
  `extensionForClipboardMimeType` are not referenced from `composer-view.tsx`'s drop
  handler.
