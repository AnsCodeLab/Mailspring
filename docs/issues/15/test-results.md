## Part A

### Red (before implementation)

Command:
```
xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test -f "attachment-image-size"
```

Result: all 10 specs failed with `TypeError: (0 , attachment_items_1.computeImagePresetSize)
is not a function` (the export didn't exist yet), confirming the tests fail for the right
reason before any implementation:

```
  1) computeImagePresetSize a large landscape image (1200x600, 2:1 ratio) returns undefined for "original" (clears imgProps, falls back to natural size).
     TypeError: (0 , attachment_items_1.computeImagePresetSize) is not a function
  ...
  10) computeImagePresetSize a portrait image (900x1800, 1:2 ratio) confirms height-side aspect-ratio math scales "small" to 160 wide / 320 tall.
     TypeError: (0 , attachment_items_1.computeImagePresetSize) is not a function
```

### Green (after implementation)

Command:
```
xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test -f "attachment-image-size"
```

Result: all 10 specs pass.

```
  computeImagePresetSize
    a large landscape image (1200x600, 2:1 ratio)
      ✓ returns undefined for "original" (clears imgProps, falls back to natural size)
      ✓ scales "large" down to 600 wide, preserving aspect ratio
      ✓ scales "medium" down to 320 wide, preserving aspect ratio
      ✓ scales "small" down to 160 wide, preserving aspect ratio
    an image already smaller than every preset (100x50)
      ✓ never upscales "large" beyond the natural size
      ✓ never upscales "medium" beyond the natural size
      ✓ never upscales "small" beyond the natural size
    a portrait image (900x1800, 1:2 ratio) confirms height-side aspect-ratio math
      ✓ scales "large" to 600 wide / 1200 tall
      ✓ scales "medium" to 320 wide / 640 tall
      ✓ scales "small" to 160 wide / 320 tall

  10 passing
```

### Lint

Command:
```
npx eslint -c .eslintrc app/src/components/attachment-items.tsx app/spec/attachment-image-size-spec.ts
```

Result: no output — clean, zero warnings/errors.

### Manual/visual verification

Not performed in this pass: no Playwright precedent in this repo for triggering/reading a
native Electron context menu's contents (confirmed by the plan's own search), and this is
UI/DOM logic (reading a live `<img>` element's natural size, building an `Electron.Menu`)
that isn't practically unit-testable without a full React+DOM mount — matching the plan's
explicit testing decision to extract and exhaustively unit-test only the pure
`computeImagePresetSize` size-computation logic, and record the "Size" submenu's manual
behavior (TC-A6 in `test-cases.md`) as a manual/visual check.

### Acceptance criteria verification

- `buildContextMenu`'s extension is additive-only: read both other call sites
  (`AttachmentItem`'s `onContextMenu` at what is now line ~250, and the pre-existing image
  `onContextMenu` this change replaces) — `AttachmentItem`'s call site never passes
  `sizePresets`, so `if (fns.sizePresets)` never fires for it; behavior unchanged.
- The 4 presets are wired to the real `onResized` callback: `_onImageContextMenu` calls
  `onResized(target?.width, target?.height)` for Large/Medium/Small (using
  `computeImagePresetSize`'s result) and `onResized(undefined, undefined)` for Original
  (via `target` being `undefined`) — the exact same prop/call path
  `_resizeEnd` (drag-resize) already uses, with no new persistence code.
- `computeImagePresetSize` is unit-tested (10 passing specs above) and exported as a
  standalone, DOM-free function per the plan's testability requirement.
- `npx eslint -c .eslintrc app/src/components/attachment-items.tsx
  app/spec/attachment-image-size-spec.ts` is clean.
