# Issue #8 — Test results

## Red state (before the fix), for reference

Before implementing the fix (spec written first, red-green), the command below produced
5 passing / 10 failing, with the failures being exactly the cases the fix addresses:
`extensionForClipboardMimeType` not yet exported/existing (`TypeError:
extensionForClipboardMimeType is not a function`), the `handleFilePasted`
`image/jpeg` regression test failing its `.jpeg`-suffix assertion (temp file written
without an extension, matching the reported bug), and the `Utils.shouldDisplayAsImage`
`.webp` regression case failing (`.webp` missing from the accepted-extensions list).

## Green state (after the fix)

Command:

```
xvfb-run -a ./node_modules/.bin/electron ./app --enable-logging --test -f "composer-paste-image-spec"
```

Output (test result lines):

```
  extensionForClipboardMimeType
    ✓ maps image/png to .png
    ✓ maps image/jpeg to .jpeg
    ✓ maps image/jpg to .jpg
    ✓ maps image/gif to .gif
    ✓ maps image/bmp to .bmp
    ✓ maps image/webp to .webp
    ✓ maps image/tiff to .tiff
    ✓ returns an empty string for an unrecognized mime type

  handleFilePasted
    ✓ writes a pasted image/jpeg blob to a temp file with a .jpeg extension
    ✓ still writes a pasted image/png blob to a temp file with a .png extension

  Utils.shouldDisplayAsImage regression for extensionForClipboardMimeType outputs
    ✓ accepts a .jpeg file
    ✓ accepts a .gif file
    ✓ accepts a .bmp file
    ✓ accepts a .webp file
    ✓ rejects an unrelated extension like .txt

  15 passing
```

Exit code: `0`. All 15 specs in `app/spec/composer-paste-image-spec.ts` pass, covering
every test case in `docs/issues/8/test-cases.md` that has automated coverage (TC-1
through TC-7; TC-8 is a code-inspection-only verification, documented as such, since
drag-and-drop does not go through the code paths this fix touches).

Note: `Utils.shouldDisplayAsImage`'s regression cases live in the same
`composer-paste-image-spec.ts` file (no pre-existing dedicated `utils-spec.ts` for
`flux/models/utils.ts` was found in `app/spec/` to extend instead).

## ESLint

Command:

```
npx eslint -c .eslintrc "app/src/components/composer-editor/composer-editor.tsx" "app/src/flux/models/utils.ts" "app/spec/composer-paste-image-spec.ts"
```

Result: exit code `0`, no errors or warnings (one round of `--fix` was applied to
`app/spec/composer-paste-image-spec.ts` to satisfy `prettier/prettier` line-wrapping on
the one-line arrow-function `it()` cases; the fix was re-verified to still pass the full
spec run afterward).
