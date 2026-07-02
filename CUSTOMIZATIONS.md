# Mailspring Customizations

This document records every change made on top of the upstream Mailspring codebase
([Foundry376/Mailspring](https://github.com/Foundry376/Mailspring)).

Two purposes:

1. **Merge guide** — when pulling upstream updates (`git merge upstream/master`), the
   sections marked "upstream file" tell you exactly which hunks to preserve so our work
   is not overwritten by the merge.
2. **Feature reference** — a plain-English description of what we added or changed
   compared to stock Mailspring.

---

## Table of Contents

1. [AI Assistant (new plugin)](#1-ai-assistant-new-plugin)
2. [Composer — Font Picker](#2-composer--font-picker)
3. [Composer — Clipboard Improvements](#3-composer--clipboard-improvements)
4. [Composer — Toolbar Layout](#4-composer--toolbar-layout)
5. [Export to Markdown (new plugin)](#5-export-to-markdown-new-plugin)
6. [Mail Rules — Import / Export](#6-mail-rules--import--export)
7. [Preferences — Subscription Tab Hidden](#7-preferences--subscription-tab-hidden)
8. [Upstream File Conflict Map](#8-upstream-file-conflict-map)

---

## 1. AI Assistant (new plugin)

**What it does**

Adds a full AI assistant sidebar to Mailspring, powered by any OpenAI-compatible API
(local models via Ollama/LM Studio, OpenAI, Anthropic-compatible proxies, etc.).

Key capabilities:

- **Thread chat** — ask questions about the currently selected email thread; AI cites
  specific messages.
- **Knowledge base** — indexes your entire inbox into a local vector store so the AI can
  answer questions about past emails across all threads.
- **Agentic skills** — the AI can search your mailbox, open emails, create draft replies,
  send email (with a countdown confirmation), archive/trash threads, do web searches, and
  fetch web pages.
- **Composer assist** — a `✨ AI` button in the composer action bar offers one-click
  Rewrite / Shorter / Longer / More Formal / More Casual / Fix Grammar / Suggest Next Line
  / Draft Reply commands applied to the current draft.
- **Per-turn draft reply** — under each AI response bubble a "Use as draft reply" button
  opens that response as a composer draft.
- **Session history** — previous conversations are saved per-thread and can be resumed.

**Files (all new — zero upstream conflict risk)**

```
app/internal_packages/ai-assistant/
  package.json
  lib/
    main.ts                  plugin entry point (activate / deactivate)
    ai-service.ts            HTTP client for OpenAI-compatible APIs (streaming + non-streaming)
    config.ts                config key constants and helpers
    agent.ts                 bounded tool-calling agent loop with confirmation gate
    prompts.ts               system prompts for chat, rewrite, grammar, and next-line
    chat-panel.tsx           sidebar chat UI (AIToggleButton + ChatPanel)
    chat-store.ts            per-thread conversation persistence
    chat-activity-store.ts   unread-message badge tracking
    thread-chat-badge.tsx    badge rendered in thread list
    composer-assist.tsx      ✨ AI button in composer toolbar
    thread-context.ts        extracts thread messages + attachments for AI context
    sse.ts                   Server-Sent Events parser (streaming tokens)
    ssrf.ts                  SSRF guard (blocks private IPs, non-HTTPS endpoints)
    next-line.ts             "Suggest next line" composer command
    privacy-notice.tsx       one-time privacy consent dialog
    preferences.tsx          AI settings tab (provider, model, KB, RAG params)
    indexer.ts               background KB indexer with maintenance lifecycle
    vector-store.ts          SQLite-backed vector store
    similarity.ts            cosine similarity + ANN search
    retriever.ts             RAG retrieval with citation validation
    citations.ts             citation parser and validator
    chunking.ts              HTML-to-text + smart chunking (JSON-LD, meta, plain)
    auto-tune.ts             corpus analysis + adaptive RAG parameter tuning
    embeddings/
      provider.ts            embedding provider interface
      in-app.ts              local embedding via WebAssembly (no API key needed)
      server.ts              remote embedding via API
    skills/
      types.ts               skill interface + ConfirmResult type
      registry.ts            skill registry with OpenAI tool-call serialization
      builtin/
        kb-search.ts         search the local knowledge base
        mailbox-search.ts    search email via DatabaseStore
        open-email.ts        open a thread in the main window
        create-draft.ts      open a composer draft
        send-email.ts        send email with countdown confirmation UI
        manage-thread.ts     trash + archive with batch confirmation
        fetch-url.ts         SSRF-guarded web page fetcher
        web-search.ts        DuckDuckGo web search (no API key needed)
  specs/                     113 Jasmine specs covering all modules
  styles/ai-assistant.less   all AI UI styles
```

---

## 2. Composer — Font Picker

**What it does**

Replaces the original font-face dropdown (which listed proprietary fonts like Comic Sans,
Georgia, Verdana) with:

- **Bundled open-source fonts** — Roboto, Open Sans, Lato, Montserrat, Poppins,
  Merriweather, Lora, Source Code Pro. The `.woff2` files ship inside the app
  (`app/internal_packages/composer/fonts/`), so they render identically for the
  sender and (with a CSS fallback stack) gracefully for recipients who lack them.
- **Default font persistence** — the user's chosen font face and size are saved to
  `core.composing.defaultFontFace` / `core.composing.defaultFontSize` and applied to
  every new draft automatically.
- **Numeric font-size input** — replaces the old dropdown with a direct numeric entry so
  the user can type any size.
- **Clipboard paste** — pastes rich text from the clipboard (e.g. from Word/Google Docs)
  preserving bold, italic, links, and images; strips unwanted Office markup.

**New files (zero upstream conflict risk)**

```
app/internal_packages/composer/
  fonts/                     woff2 files for all 8 bundled typefaces + LICENSES.md
  styles/bundled-fonts.less  @font-face declarations loaded by the composer
  lib/apply-rules-button.tsx toolbar button added to composer action bar
  lib/preferences-button.tsx toolbar button added to composer action bar
  lib/refresh-button.tsx     toolbar button added to composer action bar
```

**Modified upstream files (conflict risk — see Section 8)**

```
app/src/components/composer-editor/base-mark-plugins.tsx
app/src/components/composer-editor/toolbar-component-factories.tsx
app/src/components/composer-editor/clipboard-plugins.tsx
app/src/components/composer-editor/composer-editor.tsx
app/src/components/composer-editor/conversion.tsx
app/src/components/composer-editor/toolbar-utils.ts
app/internal_packages/composer/lib/main.tsx   (added activateConfig export)
app/internal_packages/composer/styles/composer.less
app/internal_packages/composer/lib/compose-button.tsx
```

**Config schema (moved out of upstream file)**

`defaultFontFace` and `defaultFontSize` are registered in the composer plugin's
`activateConfig()` hook (`app/internal_packages/composer/lib/main.tsx`) rather than in
`app/src/config-schema.ts`, so that upstream file stays untouched.

---

## 3. Composer — Clipboard Improvements

**What it does**

When the user pastes from an external source (Word, Google Docs, a web page), the
composer now preserves:

- Bold, italic, underline, strikethrough
- Links (href sanitized; `javascript:` / `data:` / `vbscript:` protocols stripped)
- Font color and size
- Inline images (converted to data URIs)
- Tables (basic structure)

Office-specific XML junk and excessive inline styles are stripped automatically.

**File** (modified from upstream):

```
app/src/components/composer-editor/clipboard-plugins.tsx   (heavily extended)
```

---

## 4. Composer — Toolbar Layout

**What it does**

Reorders the title-bar window-control buttons on Linux so Close is on the right
(matching standard Linux desktop conventions) and the hamburger menu is on the far left.
Also wraps the controls in a flex-order `div` so the AI toggle button and other
registered toolbar components slot in naturally.

**Modified upstream file (conflict risk — see Section 8)**

```
app/src/sheet-toolbar.tsx
```

Specific changes:
- Window controls (minimize/maximize/close) wrapped in `<div style={{ order: 1000 }}>` so
  they stay right-most regardless of other registered components.
- Button order changed: minimize, maximize, close (close moved to the end to match GNOME
  HIG).
- `toolbar-menu-control` given `style={{ order: -200 }}` to pin it left.
- `Toolbar.Right` / `Toolbar.Left` location assignments swapped for RTL/LTR consistency.

---

## 5. Export to Markdown (new plugin)

**What it does**

Adds two export paths:

- **Thread toolbar button** — exports the entire selected thread to a Markdown file.
- **Per-message menu item** — exports a single message from the message controls menu.

Attachments are listed by filename; inline Base64 images are embedded as Markdown image
references.

**Files (all new — zero upstream conflict risk)**

```
app/internal_packages/export-to-markdown/
  package.json
  lib/
    main.ts
    export-utils.ts          HTML-to-Markdown conversion (turndown library)
    export-thread-button.tsx toolbar button
    export-email-menu-item.tsx per-message menu item
```

**Modified upstream file**

```
app/internal_packages/message-list/lib/message-controls.tsx
```

Change: adds an import of `ExportEmailMenuItem` and renders it inside the existing
message controls dropdown. This is a single-hunk addition at the bottom of the menu's
JSX.

---

## 6. Mail Rules — Import / Export

**What it does**

Adds Import and Export buttons to the Mail Rules preferences tab so users can back up
their rules to a JSON file and restore them on a new machine.

**Modified upstream file (conflict risk — see Section 8)**

```
app/internal_packages/preferences/lib/tabs/preferences-mail-rules.tsx
```

Changes: adds Import/Export button row above the rules list, and JSON
serialize/deserialize helpers. The surrounding rule-list rendering is untouched.

---

## 7. Preferences — Subscription Tab Hidden

**What it does**

Removes the "Subscription" tab from the Preferences window. The upstream tab links to
Mailspring's paid-plan page, which is not relevant for self-hosted / custom builds.

**Modified upstream file**

```
app/internal_packages/preferences/lib/main.tsx
```

Change: the `registerPreferencesTab(new PreferencesUIStore.TabItem({ tabId: 'Subscription' ... }))` block
has been deleted. Everything else in this file is untouched.

**To restore:** add back:

```ts
PreferencesUIStore.registerPreferencesTab(
  new PreferencesUIStore.TabItem({
    tabId: 'Subscription',
    displayName: localized('Subscription'),
    componentClassFn: () => require('./tabs/preferences-identity').default,
    order: 3,
  })
);
```

---

## 8. Upstream File Conflict Map

When running `git merge upstream/master`, these files from `app/src/` are at risk of
merge conflicts. All other changes live in new files or in `app/internal_packages/`
files that don't exist upstream.

### How to merge

```bash
git fetch upstream
git merge upstream/master
# Resolve conflicts per the table below, then:
git add <resolved files>
git commit
```

| File | What we changed | How to resolve conflict |
|---|---|---|
| `app/src/components/composer-editor/base-mark-plugins.tsx` | Replaced proprietary font list with bundled OFL fonts; swapped `BuildFontPicker` calls for `BuildFontFacePicker` / `BuildFontSizeInput` | Keep both sides: accept upstream changes to logic outside the font-list block; keep our `DEFAULT_FONT_FACE_OPTIONS` array and `BuildFontFacePicker` / `BuildFontSizeInput` calls |
| `app/src/components/composer-editor/toolbar-component-factories.tsx` | Added `BuildFontFacePicker` and `BuildFontSizeInput` export functions | Keep both: append our two new exported functions; accept upstream changes to everything else |
| `app/src/components/composer-editor/clipboard-plugins.tsx` | Extended paste handler for rich-text preservation | Merge carefully; our additions are inside the `onPaste` handler block |
| `app/src/components/composer-editor/composer-editor.tsx` | Minor wiring for font-face persistence | Accept upstream; re-apply the font-default wiring if removed |
| `app/src/components/composer-editor/conversion.tsx` | Small addition for font-face round-trip | Accept upstream; check the conversion helpers still include font-face |
| `app/src/components/composer-editor/toolbar-utils.ts` | New helper utilities for toolbar rendering | Keep both: accept upstream; append our helpers |
| `app/src/sheet-toolbar.tsx` | Window-control order + flex-order wrappers | Keep both: accept upstream layout; re-apply our `style={{ order: ... }}` wrappers and button reorder |
| `app/internal_packages/composer/lib/main.tsx` | Added `export function activateConfig()` at bottom | Keep both: accept upstream changes; ensure `activateConfig` export remains at the end |
| `app/internal_packages/composer/styles/composer.less` | Font-face imports + minor composer UI tweaks | Keep both: accept upstream styles; keep our `@import 'bundled-fonts'` line and any custom rules |
| `app/internal_packages/message-list/lib/message-controls.tsx` | Added Export menu item import + render | Keep both: accept upstream changes to the menu; keep our `<ExportEmailMenuItem>` render |
| `app/internal_packages/preferences/lib/main.tsx` | Removed Subscription tab registration | After merge, verify the Subscription block did not get re-added; if it did, delete it again |
| `app/internal_packages/preferences/lib/tabs/preferences-mail-rules.tsx` | Added import/export buttons | Keep both: accept upstream rule-list changes; keep our import/export button row at the top |

### Files with zero conflict risk

Everything inside `app/internal_packages/ai-assistant/` and
`app/internal_packages/export-to-markdown/` is brand-new — upstream does not have these
packages at all, so `git merge` will never touch them.

The bundled font files (`app/internal_packages/composer/fonts/`) and
`app/internal_packages/composer/styles/bundled-fonts.less` are also additions with no
upstream equivalent.
