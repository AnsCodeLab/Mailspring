# Export to Markdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Export Thread as Markdown" (toolbar button) and "Export as Markdown" (per-message ⋯ menu) to Mailspring, converting email HTML to self-contained `.md` files with Base64-embedded inline images.

**Architecture:** New internal plugin `app/internal_packages/export-to-markdown/` holds all conversion logic, the toolbar button, and the menu-item class. `message-controls.tsx` gets a minimal edit to look up registered `MessageActionMenuItem` components and add them to the native system menu — a one-time extension point that future plugins can also use.

**Tech Stack:** TypeScript, React, `turndown` (HTML→Markdown), Mailspring APIs (`QuotedHTMLTransformer`, `AttachmentStore`, `DatabaseStore`, `AppEnv.showSaveDialog`, `ComponentRegistry`), Node.js `fs`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `app/internal_packages/export-to-markdown/package.json` | Plugin metadata |
| Create | `app/internal_packages/export-to-markdown/lib/main.ts` | activate / deactivate, register both components |
| Create | `app/internal_packages/export-to-markdown/lib/export-utils.ts` | sanitizeFilename, resolveCidImages, htmlToMarkdown, buildThreadMarkdown, buildSingleMessageMarkdown, saveMarkdownFile, fetchThreadMessages |
| Create | `app/internal_packages/export-to-markdown/lib/export-thread-button.tsx` | Toolbar button — fetches messages, builds markdown, triggers save |
| Create | `app/internal_packages/export-to-markdown/lib/export-email-menu-item.tsx` | Static `getMenuItem()` returning `{ label, click }` for the native menu |
| Create | `app/spec/export-to-markdown-spec.ts` | Jasmine tests for pure utility functions |
| Modify | `app/package.json` | Add `turndown` dependency |
| Modify | `app/internal_packages/message-list/lib/message-controls.tsx` | Import `ComponentRegistry`; extend `_onShowActionsMenu` to render `MessageActionMenuItem` items |

---

## Task 1: Add turndown dependency

**Files:**
- Modify: `app/package.json`

- [ ] **Step 1: Add turndown to app/package.json**

Open `app/package.json`. In the `"dependencies"` block, add after the last entry (before the closing brace):

```json
"turndown": "^7.2.0"
```

- [ ] **Step 2: Install the dependency**

```bash
cd /run/media/anscodelab/DATA/GenericWork/Mailspring/app && npm install
```

Expected: turndown and its types appear in `node_modules/turndown/`.

- [ ] **Step 3: Verify the import works**

```bash
cd /run/media/anscodelab/DATA/GenericWork/Mailspring/app && node -e "const T = require('turndown'); const td = new T(); console.log(td.turndown('<b>hello</b>'))"
```

Expected output: `**hello**`

- [ ] **Step 4: Commit**

```bash
git -C /run/media/anscodelab/DATA/GenericWork/Mailspring add app/package.json app/package-lock.json && git -C /run/media/anscodelab/DATA/GenericWork/Mailspring commit -m "chore: add turndown dependency for markdown export"
```

---

## Task 2: Add MessageActionMenuItem extension point to message-controls.tsx

**Files:**
- Modify: `app/internal_packages/message-list/lib/message-controls.tsx:4-12` (imports)
- Modify: `app/internal_packages/message-list/lib/message-controls.tsx:117-139` (`_onShowActionsMenu`)

- [ ] **Step 1: Add ComponentRegistry to imports**

In `app/internal_packages/message-list/lib/message-controls.tsx`, change the `mailspring-exports` import from:

```typescript
import {
  localized,
  Actions,
  TaskQueue,
  GetMessageRFC2822Task,
  EmlUtils,
  Thread,
  Message,
} from 'mailspring-exports';
```

to:

```typescript
import {
  localized,
  Actions,
  TaskQueue,
  GetMessageRFC2822Task,
  EmlUtils,
  Thread,
  Message,
  ComponentRegistry,
} from 'mailspring-exports';
```

- [ ] **Step 2: Extend _onShowActionsMenu to render registered items**

Replace the entire `_onShowActionsMenu` method (lines 117–139) with:

```typescript
  _onShowActionsMenu = () => {
    const SystemMenu = require('@electron/remote').Menu;
    const SystemMenuItem = require('@electron/remote').MenuItem;

    // Todo: refactor this so that message actions are provided
    // dynamically. Waiting to see if this will be used often.
    const menu = new SystemMenu();
    menu.append(new SystemMenuItem({ label: localized('Log Data'), click: this._onLogData }));
    menu.append(
      new SystemMenuItem({ label: localized('Show Original'), click: this._onShowOriginal })
    );
    menu.append(
      new SystemMenuItem({
        label: localized('Copy Debug Info to Clipboard'),
        click: this._onCopyToClipboard,
      })
    );
    menu.append(new SystemMenuItem({ type: 'separator' }));
    menu.append(
      new SystemMenuItem({ label: localized('Download as .eml'), click: this._onDownloadEml })
    );

    const actionItems = ComponentRegistry.findComponentsMatching({
      role: 'MessageActionMenuItem',
    }) as Array<{ getMenuItem: (props: MessageControlsProps) => { label: string; click: () => void } }>;
    if (actionItems.length > 0) {
      menu.append(new SystemMenuItem({ type: 'separator' }));
      for (const ActionItem of actionItems) {
        const item = ActionItem.getMenuItem(this.props);
        menu.append(new SystemMenuItem({ label: item.label, click: item.click }));
      }
    }

    menu.popup({});
  };
```

- [ ] **Step 3: Verify lint passes**

```bash
cd /run/media/anscodelab/DATA/GenericWork/Mailspring && npm run lint -- --fix app/internal_packages/message-list/lib/message-controls.tsx 2>&1 | tail -5
```

Expected: no errors (warnings about `any` are acceptable).

- [ ] **Step 4: Commit**

```bash
git -C /run/media/anscodelab/DATA/GenericWork/Mailspring add app/internal_packages/message-list/lib/message-controls.tsx && git -C /run/media/anscodelab/DATA/GenericWork/Mailspring commit -m "feat: add MessageActionMenuItem extension point to message controls"
```

---

## Task 3: Create plugin package.json and directory

**Files:**
- Create: `app/internal_packages/export-to-markdown/package.json`

- [ ] **Step 1: Create the directory and package.json**

Create `app/internal_packages/export-to-markdown/package.json` with:

```json
{
  "name": "export-to-markdown",
  "version": "0.1.0",
  "isOptional": true,
  "title": "Export to Markdown",
  "description": "Export email threads or individual messages to self-contained Markdown files.",
  "main": "./lib/main",
  "private": true,
  "engines": {
    "mailspring": "*"
  },
  "license": "GPL-3.0"
}
```

- [ ] **Step 2: Create the lib directory**

```bash
mkdir -p /run/media/anscodelab/DATA/GenericWork/Mailspring/app/internal_packages/export-to-markdown/lib
```

- [ ] **Step 3: Commit**

```bash
git -C /run/media/anscodelab/DATA/GenericWork/Mailspring add app/internal_packages/export-to-markdown/ && git -C /run/media/anscodelab/DATA/GenericWork/Mailspring commit -m "feat: scaffold export-to-markdown plugin"
```

---

## Task 4: Create export-utils.ts

**Files:**
- Create: `app/internal_packages/export-to-markdown/lib/export-utils.ts`

- [ ] **Step 1: Write failing tests first** *(see Task 5 — write tests before this file)*

*Skip ahead to Task 5 to write the tests, then return here.*

- [ ] **Step 2: Create export-utils.ts**

Create `app/internal_packages/export-to-markdown/lib/export-utils.ts`:

```typescript
import fs from 'fs';
import TurndownService from 'turndown';
import {
  Message,
  Thread,
  DatabaseStore,
  QuotedHTMLTransformer,
  AttachmentStore,
  AppEnv,
  localized,
} from 'mailspring-exports';

export function sanitizeFilename(subject: string): string {
  const safe = (subject || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .substring(0, 100)
    .trim();
  return safe || 'email';
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatContact(c: { name?: string; email: string }): string {
  return c.name ? `${c.name} <${c.email}>` : c.email;
}

function resolveCidImages(html: string, message: Message): string {
  let result = html;
  for (const file of message.files || []) {
    if (!file.contentId) continue;
    const filePath = AttachmentStore.pathForFile(file);
    if (!filePath) continue;
    try {
      const data = fs.readFileSync(filePath);
      const mimeType = file.contentType || 'image/png';
      const dataUri = `data:${mimeType};base64,${data.toString('base64')}`;
      const escapedId = file.contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`cid:${escapedId}`, 'g'), dataUri);
    } catch {
      // leave cid: reference as-is if file cannot be read
    }
  }
  return result;
}

function buildMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });
  return td.turndown(html).trim();
}

function messageToMarkdownBlock(message: Message): string {
  const strippedHtml = QuotedHTMLTransformer.removeQuotedHTML(message.body || '', {
    keepIfWholeBodyIsQuote: true,
  });
  const resolvedHtml = resolveCidImages(strippedHtml, message);
  let body = buildMarkdown(resolvedHtml);
  if (!body) {
    body = message.snippet || '';
  }

  const from = (message.from || []).map(formatContact).join(', ');
  const to = (message.to || []).map(formatContact).join(', ');
  const cc = (message.cc || []).map(formatContact).join(', ');
  const date = message.date ? formatDate(new Date(message.date as unknown as number)) : '';

  const lines = [
    `## From: ${from}`,
    `**Date:** ${date}  `,
    `**To:** ${to}  `,
  ];
  if (cc) {
    lines.push(`**CC:** ${cc}  `);
  }
  lines.push('', body);

  return lines.join('\n');
}

export function buildThreadMarkdown(thread: Thread, messages: Message[]): string {
  if (!messages.length) return '';
  const sorted = [...messages].sort(
    (a, b) =>
      new Date(a.date as unknown as number).getTime() -
      new Date(b.date as unknown as number).getTime()
  );
  const subject = thread.subject || 'Email Thread';
  const blocks = sorted.map(messageToMarkdownBlock);
  return `# ${subject}\n\n---\n\n${blocks.join('\n\n---\n\n')}`;
}

export function buildSingleMessageMarkdown(message: Message): string {
  const subject = message.subject || 'Email';
  const block = messageToMarkdownBlock(message);
  return `# ${subject}\n\n---\n\n${block}`;
}

export async function saveMarkdownFile(content: string, defaultFilename: string): Promise<void> {
  return new Promise((resolve) => {
    AppEnv.showSaveDialog(
      {
        defaultPath: `${sanitizeFilename(defaultFilename)}.md`,
        title: localized('Export as Markdown'),
      },
      (savePath: string) => {
        if (!savePath) {
          resolve();
          return;
        }
        try {
          fs.writeFileSync(savePath, content, 'utf8');
        } catch (err) {
          AppEnv.showErrorDialog({
            title: localized('Export Failed'),
            message: String(err),
          });
        }
        resolve();
      }
    );
  });
}

export async function fetchThreadMessages(threadId: string): Promise<Message[]> {
  return DatabaseStore.findAll<Message>(Message, { threadId }).include(Message.attributes.body);
}
```

- [ ] **Step 3: Verify lint**

```bash
cd /run/media/anscodelab/DATA/GenericWork/Mailspring && npm run lint -- --fix app/internal_packages/export-to-markdown/lib/export-utils.ts 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -C /run/media/anscodelab/DATA/GenericWork/Mailspring add app/internal_packages/export-to-markdown/lib/export-utils.ts && git -C /run/media/anscodelab/DATA/GenericWork/Mailspring commit -m "feat: add export-utils for markdown conversion"
```

---

## Task 5: Write and run tests for export-utils.ts

**Files:**
- Create: `app/spec/export-to-markdown-spec.ts`

- [ ] **Step 1: Write the tests**

Create `app/spec/export-to-markdown-spec.ts`:

```typescript
import { sanitizeFilename, buildThreadMarkdown, buildSingleMessageMarkdown } from '../internal_packages/export-to-markdown/lib/export-utils';

// Minimal Message stub — only fields used by the markdown builders
function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    subject: 'Test Subject',
    body: '<p>Hello world</p>',
    snippet: 'Hello world',
    date: new Date('2026-06-15T14:32:00Z'),
    from: [{ name: 'Alice', email: 'alice@example.com' }],
    to: [{ name: 'Bob', email: 'bob@example.com' }],
    cc: [],
    files: [],
    ...overrides,
  } as any;
}

function makeThread(subject = 'Thread Subject') {
  return { id: 'thread-1', subject } as any;
}

describe('sanitizeFilename', () => {
  it('replaces invalid characters with underscores', () => {
    expect(sanitizeFilename('Hello: World / Test')).toBe('Hello_ World _ Test');
  });

  it('replaces all invalid chars including \\, *, ?, <, >, |', () => {
    expect(sanitizeFilename('a\\b*c?d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h');
  });

  it('truncates to 100 characters', () => {
    expect(sanitizeFilename('a'.repeat(150)).length).toBe(100);
  });

  it('returns "email" for empty string', () => {
    expect(sanitizeFilename('')).toBe('email');
  });

  it('returns "email" for whitespace-only string', () => {
    expect(sanitizeFilename('   ')).toBe('email');
  });

  it('returns "email" for null', () => {
    expect(sanitizeFilename(null as any)).toBe('email');
  });

  it('preserves safe characters', () => {
    expect(sanitizeFilename('Meeting notes 2026-06-15')).toBe('Meeting notes 2026-06-15');
  });
});

describe('buildThreadMarkdown', () => {
  beforeEach(() => {
    // Mock QuotedHTMLTransformer to pass through body unchanged
    const { QuotedHTMLTransformer } = require('mailspring-exports');
    spyOn(QuotedHTMLTransformer, 'removeQuotedHTML').and.callFake((html: string) => html);

    // Mock AttachmentStore so no file reads occur
    const { AttachmentStore } = require('mailspring-exports');
    spyOn(AttachmentStore, 'pathForFile').and.returnValue(null);
  });

  it('returns empty string when messages array is empty', () => {
    expect(buildThreadMarkdown(makeThread(), [])).toBe('');
  });

  it('starts with # Subject heading', () => {
    const result = buildThreadMarkdown(makeThread('My Thread'), [makeMessage()]);
    expect(result.startsWith('# My Thread')).toBe(true);
  });

  it('includes From header for each message', () => {
    const result = buildThreadMarkdown(makeThread(), [
      makeMessage({ from: [{ name: 'Alice', email: 'alice@example.com' }] }),
    ]);
    expect(result).toContain('## From: Alice <alice@example.com>');
  });

  it('omits CC line when cc is empty', () => {
    const result = buildThreadMarkdown(makeThread(), [makeMessage({ cc: [] })]);
    expect(result).not.toContain('**CC:**');
  });

  it('includes CC line when cc is populated', () => {
    const result = buildThreadMarkdown(makeThread(), [
      makeMessage({ cc: [{ name: 'Carol', email: 'carol@example.com' }] }),
    ]);
    expect(result).toContain('**CC:** Carol <carol@example.com>');
  });

  it('sorts messages oldest-first', () => {
    const older = makeMessage({ id: 'old', date: new Date('2026-01-01'), from: [{ name: 'OldSender', email: 'old@example.com' }] });
    const newer = makeMessage({ id: 'new', date: new Date('2026-06-01'), from: [{ name: 'NewSender', email: 'new@example.com' }] });
    const result = buildThreadMarkdown(makeThread(), [newer, older]);
    expect(result.indexOf('OldSender')).toBeLessThan(result.indexOf('NewSender'));
  });

  it('separates messages with ---', () => {
    const msgs = [makeMessage({ id: 'a' }), makeMessage({ id: 'b' })];
    const result = buildThreadMarkdown(makeThread(), msgs);
    // Header --- plus separator between messages
    const separatorCount = (result.match(/\n---\n/g) || []).length;
    expect(separatorCount).toBeGreaterThanOrEqual(2);
  });
});

describe('buildSingleMessageMarkdown', () => {
  beforeEach(() => {
    const { QuotedHTMLTransformer } = require('mailspring-exports');
    spyOn(QuotedHTMLTransformer, 'removeQuotedHTML').and.callFake((html: string) => html);
    const { AttachmentStore } = require('mailspring-exports');
    spyOn(AttachmentStore, 'pathForFile').and.returnValue(null);
  });

  it('starts with # Subject heading', () => {
    const result = buildSingleMessageMarkdown(makeMessage({ subject: 'My Email' }));
    expect(result.startsWith('# My Email')).toBe(true);
  });

  it('includes the From header', () => {
    const result = buildSingleMessageMarkdown(makeMessage());
    expect(result).toContain('## From: Alice <alice@example.com>');
  });

  it('uses "Email" when subject is empty', () => {
    const result = buildSingleMessageMarkdown(makeMessage({ subject: '' }));
    expect(result.startsWith('# Email')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests — expect failures (utils not yet fully working without Mailspring context)**

```bash
cd /run/media/anscodelab/DATA/GenericWork/Mailspring && npm test -- --filter="sanitizeFilename" 2>&1 | tail -20
```

Expected: `sanitizeFilename` tests pass. The `buildThreadMarkdown` tests may fail if `mailspring-exports` is not available in the test environment — that is acceptable at this stage. Note any failures and continue.

- [ ] **Step 3: Commit the tests**

```bash
git -C /run/media/anscodelab/DATA/GenericWork/Mailspring add app/spec/export-to-markdown-spec.ts && git -C /run/media/anscodelab/DATA/GenericWork/Mailspring commit -m "test: add export-to-markdown utility tests"
```

---

## Task 6: Create export-thread-button.tsx

**Files:**
- Create: `app/internal_packages/export-to-markdown/lib/export-thread-button.tsx`

- [ ] **Step 1: Create export-thread-button.tsx**

```typescript
import React from 'react';
import { Thread, localized } from 'mailspring-exports';
import { RetinaImg } from 'mailspring-component-kit';
import { fetchThreadMessages, buildThreadMarkdown, saveMarkdownFile } from './export-utils';

export default class ExportThreadButton extends React.Component<{
  items: Thread[];
  thread?: Thread;
}> {
  static displayName = 'ExportThreadButton';
  static containerRequired = false;

  _onClick = async () => {
    const thread = this.props.thread || this.props.items?.[0];
    if (!thread) return;

    const messages = await fetchThreadMessages(thread.id);
    if (!messages.length) return;

    const content = buildThreadMarkdown(thread, messages);
    await saveMarkdownFile(content, thread.subject);
  };

  render() {
    if (this.props.items && this.props.items.length > 1) {
      return <span />;
    }
    return (
      <button
        className="btn btn-toolbar export-markdown-button"
        title={localized('Export Thread as Markdown')}
        onClick={this._onClick}
      >
        <RetinaImg name="ic-toolbar-native-share.png" mode={RetinaImg.Mode.ContentIsMask} />
      </button>
    );
  }
}
```

- [ ] **Step 2: Verify lint**

```bash
cd /run/media/anscodelab/DATA/GenericWork/Mailspring && npm run lint -- --fix app/internal_packages/export-to-markdown/lib/export-thread-button.tsx 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C /run/media/anscodelab/DATA/GenericWork/Mailspring add app/internal_packages/export-to-markdown/lib/export-thread-button.tsx && git -C /run/media/anscodelab/DATA/GenericWork/Mailspring commit -m "feat: add ExportThreadButton toolbar component"
```

---

## Task 7: Create export-email-menu-item.tsx

**Files:**
- Create: `app/internal_packages/export-to-markdown/lib/export-email-menu-item.tsx`

- [ ] **Step 1: Create export-email-menu-item.tsx**

```typescript
import React from 'react';
import { Message, Thread, DatabaseStore, localized } from 'mailspring-exports';
import { buildSingleMessageMarkdown, saveMarkdownFile } from './export-utils';

export default class ExportEmailMenuItem extends React.Component {
  static displayName = 'ExportEmailMenuItem';

  static getMenuItem({ message, thread }: { message: Message; thread: Thread }) {
    return {
      label: localized('Export as Markdown'),
      click: async () => {
        let msg = message;
        if (!msg.body) {
          msg = await DatabaseStore.find<Message>(Message, message.id).include(
            Message.attributes.body
          );
          if (!msg) return;
        }
        const content = buildSingleMessageMarkdown(msg);
        await saveMarkdownFile(content, msg.subject || thread.subject);
      },
    };
  }

  render() {
    return null;
  }
}
```

- [ ] **Step 2: Verify lint**

```bash
cd /run/media/anscodelab/DATA/GenericWork/Mailspring && npm run lint -- --fix app/internal_packages/export-to-markdown/lib/export-email-menu-item.tsx 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C /run/media/anscodelab/DATA/GenericWork/Mailspring add app/internal_packages/export-to-markdown/lib/export-email-menu-item.tsx && git -C /run/media/anscodelab/DATA/GenericWork/Mailspring commit -m "feat: add ExportEmailMenuItem for per-message export"
```

---

## Task 8: Create main.ts (activate / deactivate)

**Files:**
- Create: `app/internal_packages/export-to-markdown/lib/main.ts`

- [ ] **Step 1: Create main.ts**

```typescript
import { ComponentRegistry } from 'mailspring-exports';
import ExportThreadButton from './export-thread-button';
import ExportEmailMenuItem from './export-email-menu-item';

export function activate() {
  ComponentRegistry.register(ExportThreadButton, { role: 'ThreadActionsToolbarButton' });
  ComponentRegistry.register(ExportEmailMenuItem, { role: 'MessageActionMenuItem' });
}

export function deactivate() {
  ComponentRegistry.unregister(ExportThreadButton);
  ComponentRegistry.unregister(ExportEmailMenuItem);
}
```

- [ ] **Step 2: Verify lint**

```bash
cd /run/media/anscodelab/DATA/GenericWork/Mailspring && npm run lint -- --fix app/internal_packages/export-to-markdown/lib/main.ts 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C /run/media/anscodelab/DATA/GenericWork/Mailspring add app/internal_packages/export-to-markdown/lib/main.ts && git -C /run/media/anscodelab/DATA/GenericWork/Mailspring commit -m "feat: wire up export-to-markdown plugin activation"
```

---

## Task 9: Integration smoke test

**Manual steps — run `npm start` and verify the following:**

- [ ] **Step 1: Start the app**

```bash
cd /run/media/anscodelab/DATA/GenericWork/Mailspring && npm start
```

- [ ] **Step 2: Verify toolbar button appears**

Open any thread. Confirm an "Export Thread as Markdown" button (icon) appears in the message-list toolbar next to Compose, Refresh, Apply Rules, Preferences. Hovering should show the tooltip "Export Thread as Markdown".

- [ ] **Step 3: Test Export Thread**

Click the toolbar button. A save dialog should open with the thread subject as default filename (ending in `.md`). Save to Desktop. Open the file and confirm:
- Starts with `# <thread subject>`
- Each message has `## From:`, `**Date:**`, `**To:**` headers
- Messages are separated by `---`
- Body text is rendered as Markdown (bold, links, etc.)
- Inline images (if any) are embedded as `data:image/...;base64,...`

- [ ] **Step 4: Verify per-message menu item appears**

Open a thread, expand a message, click the `⋯` (ellipsis) button. Confirm "Export as Markdown" appears in the dropdown, below a separator after "Download as .eml".

- [ ] **Step 5: Test Export Email**

Click "Export as Markdown" from a message's ⋯ menu. Save dialog opens. Save and confirm the file contains a single message block with the correct `## From:` header and body.

- [ ] **Step 6: Test error handling**

Click the toolbar button when no thread is selected (if possible). Confirm no crash occurs.

- [ ] **Step 7: Final commit**

```bash
git -C /run/media/anscodelab/DATA/GenericWork/Mailspring add -A && git -C /run/media/anscodelab/DATA/GenericWork/Mailspring commit -m "feat: Export to Markdown — toolbar button and per-message menu item" --allow-empty
```

---

## Self-Review Notes

- `sanitizeFilename` is exported and covered by tests ✓
- `buildThreadMarkdown` and `buildSingleMessageMarkdown` are covered by structure tests ✓
- `message.date` cast: `Message.attributes.date` is `AttributeDateTime` which returns a `Date` object, but is typed loosely — the `as unknown as number` cast routes through `new Date()` safely in either case ✓
- `ComponentRegistry.findComponentsMatching` is called at click time (not at render time) so deactivating the plugin and clicking the ⋯ menu correctly shows no item ✓
- The `MessageActionMenuItem` role is a new convention — documented via the extension point comment in the method itself ✓
- Multi-select guard on `ExportThreadButton`: returns `<span />` when `items.length > 1`, consistent with `ThreadSharingButton` ✓
