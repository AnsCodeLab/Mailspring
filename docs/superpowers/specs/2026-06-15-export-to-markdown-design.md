# Export to Markdown — Design Spec

**Date:** 2026-06-15  
**Inspired by:** [OutlookExportMarkdown](https://github.com/AnsCodeLab/OutlookExportMarkdown)

---

## Overview

Add an "Export to Markdown" feature to Mailspring that exports email threads or individual messages to self-contained `.md` files. Inline images are embedded as Base64 data URIs, quoted replies are stripped, and the output matches the format of the OutlookExportMarkdown Outlook add-in.

---

## Plugin Structure

New internal package: `app/internal_packages/export-to-markdown/`

```
export-to-markdown/
├── package.json
└── lib/
    ├── main.ts                    — activate/deactivate, registers both components
    ├── export-thread-button.tsx   — toolbar "Export Thread" button
    ├── export-email-menu-item.tsx — per-message dropdown "Export as Markdown" item
    └── export-utils.ts            — shared: fetch messages, strip quotes, HTML→Markdown, save file
```

**New dependency:** `turndown` added to `app/package.json` for HTML→Markdown conversion.

---

## UI Integration

### Export Thread — Toolbar Button

- Registered via `ComponentRegistry.register(ExportThreadButton, { role: 'ThreadActionsToolbarButton' })`
- Appears in the message list toolbar alongside Compose, Refresh, Apply Rules, Preferences
- Receives `{ thread: Thread }` as props
- Exports all messages in the thread to a single `.md` file

### Export Email — Per-Message Dropdown

- `app/internal_packages/message-list/lib/message-controls.tsx` gets a small edit to render components registered under a new `MessageActionMenuItem` role
- The plugin registers `ExportEmailMenuItem` into this role
- Receives `{ message: Message, thread: Thread }` as props
- Exports the single message to a `.md` file
- This extension point is reusable by future plugins

---

## Output Format

```markdown
# Email Subject

---

## From: Jane Smith <jane@example.com>
**Date:** 2026-06-15 14:32  
**To:** John Doe <john@example.com>  
**CC:** team@example.com  

Body text converted from HTML.

![inline-image](data:image/png;base64,iVBORw0KGgo...)

---

## From: John Doe <john@example.com>
**Date:** 2026-06-14 09:11  
**To:** Jane Smith <jane@example.com>  

Reply body here.
```

Rules:
- Thread export: messages sorted **oldest first** (chronological)
- Single email export: same block format; `# Subject` heading included
- `CC:` line omitted when empty
- Messages separated by `---` horizontal rules
- Filename: subject sanitised (invalid chars → `_`, truncated to 100 chars) + `.md`

---

## Data Flow

### Export Thread

1. User clicks toolbar button; `thread` prop is available
2. `DatabaseStore.findAll(Message, { threadId: thread.id }).include(Message.attributes.body)` fetches all messages with bodies
3. Sort messages oldest-first by `date`
4. For each message:
   a. Strip quoted replies via `QuotedHTMLTransformer.removeQuotedHTML(message.body, { keepIfWholeBodyIsQuote: true })`
   b. Resolve `cid:` image references from `message.files` → read attachment data → encode as Base64 → replace `cid:` src with `data:image/...;base64,...`
   c. Convert cleaned HTML to Markdown via `turndown`
5. Assemble full `.md` string with headers and separators
6. `AppEnv.showSaveDialog({ defaultPath: sanitisedSubject + '.md' })` → `fs.writeFileSync(filepath, content, 'utf8')`

### Export Email

Same as steps 3b–6 for a single message. No DB fetch needed — `message-controls.tsx` already has the `message` object with body included.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| HTML→Markdown produces empty output | Fall back to `message.snippet` or plain-text body (tags stripped) |
| `cid:` reference has no matching attachment | Leave `![](cid:...)` reference as-is |
| User cancels save dialog | No-op, no error |
| `fs.writeFileSync` throws | Show `AppEnv.showErrorDialog({ title: 'Export Failed', message: err.toString() })` |
| Thread has no messages | Guard with early return before building file string |
| Very large thread / large images | Base64 encoding runs synchronously in render process — acceptable for now, can move async if needed |

---

## Files to Create

| File | Purpose |
|---|---|
| `app/internal_packages/export-to-markdown/package.json` | Plugin metadata |
| `app/internal_packages/export-to-markdown/lib/main.ts` | Activate/deactivate, register components |
| `app/internal_packages/export-to-markdown/lib/export-thread-button.tsx` | Toolbar button component |
| `app/internal_packages/export-to-markdown/lib/export-email-menu-item.tsx` | Per-message dropdown item |
| `app/internal_packages/export-to-markdown/lib/export-utils.ts` | Shared conversion and save logic |

## Files to Modify

| File | Change |
|---|---|
| `app/package.json` | Add `turndown` dependency |
| `app/internal_packages/message-list/lib/message-controls.tsx` | Render `MessageActionMenuItem` role components in dropdown |
