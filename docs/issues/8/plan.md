# Issue #8 — Pasted images render as attachment instead of inline

## Root cause (confirmed by reading source, filed with the issue)

`handleFilePasted()` (`app/src/components/composer-editor/composer-editor.tsx:369-424`)
writes a pasted clipboard image blob to a temp file, choosing its extension from a
hardcoded, incomplete MIME map:

```ts
const ext = { 'image/png': '.png', 'image/jpg': '.jpg', 'image/tiff': '.tiff' }[item.type] || '';
```

- `image/jpg` is not a real MIME type (browsers/OSes emit `image/jpeg`), so this entry
  never matches anything.
- `image/gif`, `image/bmp`, `image/webp` aren't listed at all.
- Any unmatched type falls through to `ext = ''`, so the temp file is written as
  `Pasted File` with no extension.

Downstream, `composer-view.tsx#_onFileReceived` (called for both drop and paste) only
calls `this.editor.current.insertInlineAttachment(file)` when
`Utils.shouldDisplayAsImage(file)` is true. `Utils.shouldDisplayAsImage()`
(`app/src/flux/models/utils.ts:175-190`) requires `path.extname(name)` to be one of
`['.jpg', '.bmp', '.gif', '.png', '.jpeg']`. An extensionless temp file fails this check,
so `_onFileReceived` falls through to leaving it as a plain attachment.

Net effect: pasting a real-world JPEG (the common case for screenshots and copied web
images) — or a GIF/BMP/WebP — never renders inline. Only PNG (and the never-actually-used
"image/jpg"/TIFF entries) happened to work.

## Fix

Single-file, surgical fix — no change needed to `Utils.shouldDisplayAsImage` (its
extension list already covers every format once the temp file has the right extension).

1. Extract the MIME→extension resolution into a small pure, exported, unit-testable
   function in `composer-editor.tsx`:
   ```ts
   export function extensionForClipboardMimeType(mimeType: string): string {
     return (
       {
         'image/png': '.png',
         'image/jpeg': '.jpeg',
         'image/jpg': '.jpg', // some Windows clipboard sources still report this
         'image/gif': '.gif',
         'image/bmp': '.bmp',
         'image/webp': '.webp',
         'image/tiff': '.tiff',
       }[mimeType] || ''
     );
   }
   ```
   Keep `image/jpg` in the map (harmless — real senders don't emit it, but costs nothing
   to accept it defensively) alongside the correct `image/jpeg`.
2. `handleFilePasted()` calls `extensionForClipboardMimeType(item.type)` instead of the
   inline object literal.
3. No change to `Utils.shouldDisplayAsImage`, `composer-view.tsx#_onFileReceived`, or the
   inline-insertion pipeline — the bug is entirely upstream of them.

## Testing

- `handleFilePasted` itself is not practically unit-testable in isolation (`ClipboardEvent`,
  `FileReader`, Node `fs`/`os`/`crypto` side effects) — matches this file's existing
  convention of no direct tests for it. The pure extraction (`extensionForClipboardMimeType`)
  IS directly unit-testable and is the one truly new piece of logic; test it exhaustively
  (all acceptance-criteria formats + unknown-type fallback) in
  `app/spec/composer-paste-image-spec.ts`, mirroring the existing fake-mark-free pure-function
  spec convention (`composer-toolbar-utils-spec.ts`).
- `Utils.shouldDisplayAsImage` already has no dedicated spec; add a couple of regression
  cases confirming it now accepts every extension `extensionForClipboardMimeType` can
  produce (`.jpeg`, `.gif`, `.bmp`, `.webp`, `.png`, `.jpg`), since this is the exact
  contract the fix depends on holding.
- E2e (Playwright): a paste-image-inline round trip through the real Electron app would
  need to synthesize a `ClipboardEvent` with clipboard `items`/file blobs, which
  `compose.spec.ts`'s existing conventions don't currently support (no precedent for
  clipboard-image synthesis in this suite, unlike the file-drop path). Given the fix is a
  pure data-mapping function with no UI surface of its own, unit coverage of
  `extensionForClipboardMimeType` plus the `shouldDisplayAsImage` regression cases is the
  right-sized test for this issue — do not invent e2e clipboard-image mocking
  infrastructure the repo doesn't have, per "test observable contract, not plumbing."

## Acceptance criteria mapping

| Issue AC | How satisfied |
|---|---|
| PNG/JPEG/GIF/BMP/WebP paste inserts inline | `extensionForClipboardMimeType` covers all 5 real MIME types; `shouldDisplayAsImage`'s existing extension list already accepts the resulting extensions — verified via regression spec cases, not re-derived |
| Temp file has correct extension per MIME type | Unit-tested exhaustively |
| No regression to non-image paste (still a plain attachment) or drag-and-drop | `extensionForClipboardMimeType` only changes what extension is chosen for recognized image MIME types; unknown types still fall through to `''` exactly as before. Drag-and-drop (`_onDrop` → `webUtils.getPathForFile`) doesn't go through `handleFilePasted` at all — untouched. |
| Regression test coverage | `composer-paste-image-spec.ts` |

## Non-goals

- `draft.plaintext` mode (never inserts inline content, by design — untouched).
- `shouldDisplayAsImage`'s size bounds (512B–5MB) — unrelated to this bug, not touched.
