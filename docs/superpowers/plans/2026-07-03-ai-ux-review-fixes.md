# AI Assistant UX Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 12 findings from the 2026-07-03 dogfooding UX review: chat-history DB split with migration, latency affordances, empty-state fix, composer cold-start mitigation, local-model preset, new-chat button, history list improvements, signature stripping, menu formatting hint, time-aware pills, thread-change chip, and preferences polish.

**Architecture:** All changes live in `app/internal_packages/ai-assistant/` except one CSS-only rule in the composer package. New pure-function modules (`chat-status.ts`, `suggestions.ts`, `history-utils.ts`) keep logic unit-testable outside React; `chat-store.ts` gains a standalone `migrateChats()` used by the constructor.

**Tech Stack:** TypeScript + React 16 (class components), better-sqlite3, LESS, Jasmine specs run via `npm test` (Electron harness).

**Spec:** `docs/superpowers/specs/2026-07-03-ai-ux-review-fixes-design.md`

## Global Constraints

- Never use em dashes (—) in user-visible strings; use a hyphen (-), middle dot (·), or parentheses instead.
- Never auto-cancel a running model request; Stop is the only cancellation path.
- No changes to upstream `app/src/` files; the only file outside `ai-assistant/` is `app/internal_packages/composer/styles/composer.less` (CSS-only).
- All user-visible strings wrapped in `localized()`.
- Gate before finishing: `npm run lint:check`, `npm run typecheck`, `npm test` all green (1599+ specs).
- Commit after each task with a conventional-commit message.

---

### Task 1: Chat DB split + migration

**Files:**
- Modify: `app/internal_packages/ai-assistant/lib/chat-store.ts`
- Modify: `app/internal_packages/ai-assistant/lib/chat-panel.tsx:491-497` (`_chatStore()`)
- Test: `app/internal_packages/ai-assistant/specs/chat-store-spec.ts` (new)

**Interfaces:**
- Produces: `migrateChats(newDbPath: string, legacyDbPath: string): 'none' | 'migrated'` (exported from `chat-store.ts`); `ChatStore` constructor becomes `constructor(dbPath: string, legacyDbPath?: string)`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Create `app/internal_packages/ai-assistant/specs/chat-store-spec.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import Sqlite3 from 'better-sqlite3';
import { ChatStore, migrateChats } from '../lib/chat-store';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ms-chatstore-'));
}

function seedLegacy(dir: string, rows: Array<[string, string, string]>): string {
  const p = path.join(dir, 'ai-index.db');
  const db = new Sqlite3(p);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, threadId TEXT, role TEXT, content TEXT, createdAt INTEGER);
    CREATE TABLE IF NOT EXISTS chat_refs (chatId INTEGER, messageId TEXT, threadId TEXT);
    CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, messageId TEXT);
  `);
  const ins = db.prepare('INSERT INTO chats (threadId, role, content, createdAt) VALUES (?,?,?,?)');
  for (const [t, r, c] of rows) ins.run(t, r, c, Date.now());
  db.close();
  return p;
}

describe('migrateChats', () => {
  it('copies legacy chats into the new DB and drops the legacy tables', () => {
    const dir = tmpDir();
    const legacy = seedLegacy(dir, [
      ['s1', 'user', 'hello'],
      ['s1', 'assistant', 'hi'],
    ]);
    const newPath = path.join(dir, 'ai-chat.db');
    expect(migrateChats(newPath, legacy)).toBe('migrated');

    const newDb = new Sqlite3(newPath);
    expect((newDb.prepare('SELECT COUNT(*) c FROM chats').get() as any).c).toBe(2);
    newDb.close();

    const old = new Sqlite3(legacy);
    const t = old
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='chats'`)
      .get();
    expect(t).toBeUndefined();
    // vector tables untouched
    const chunks = old
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'`)
      .get();
    expect(chunks).toBeDefined();
    old.close();
  });

  it('is a no-op when the legacy DB is missing or already migrated', () => {
    const dir = tmpDir();
    const newPath = path.join(dir, 'ai-chat.db');
    expect(migrateChats(newPath, path.join(dir, 'nope.db'))).toBe('none');
    const legacy = seedLegacy(dir, [['s1', 'user', 'x']]);
    expect(migrateChats(newPath, legacy)).toBe('migrated');
    expect(migrateChats(newPath, legacy)).toBe('none'); // legacy tables gone now
  });

  it('recovers from a partial copy by wiping and re-copying', () => {
    const dir = tmpDir();
    const legacy = seedLegacy(dir, [
      ['s1', 'user', 'a'],
      ['s1', 'assistant', 'b'],
      ['s2', 'user', 'c'],
    ]);
    const newPath = path.join(dir, 'ai-chat.db');
    // simulate a partial copy: 1 of 3 rows landed
    const nd = new Sqlite3(newPath);
    nd.exec(`
      CREATE TABLE chats (id INTEGER PRIMARY KEY AUTOINCREMENT, threadId TEXT, role TEXT, content TEXT, createdAt INTEGER);
      CREATE TABLE chat_refs (chatId INTEGER, messageId TEXT, threadId TEXT);
    `);
    nd.prepare('INSERT INTO chats (threadId, role, content, createdAt) VALUES (?,?,?,?)').run(
      's1',
      'user',
      'a',
      1
    );
    nd.close();
    expect(migrateChats(newPath, legacy)).toBe('migrated');
    const check = new Sqlite3(newPath);
    expect((check.prepare('SELECT COUNT(*) c FROM chats').get() as any).c).toBe(3);
    check.close();
  });
});

describe('ChatStore with legacy path', () => {
  it('opens the new DB and reads migrated history', () => {
    const dir = tmpDir();
    const legacy = seedLegacy(dir, [['sX', 'user', 'migrated message']]);
    const store = new ChatStore(path.join(dir, 'ai-chat.db'), legacy);
    const hist = store.history('sX');
    expect(hist.length).toBe(1);
    expect(hist[0].content).toBe('migrated message');
    store.close();
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npm test -- -f chat-store-spec 2>&1 | tail -20` (if `-f` filtering is unavailable, run `npm test` and grep for `migrateChats`)
Expected: FAIL - `migrateChats` is not exported.

- [ ] **Step 3: Implement migration + constructor change**

In `chat-store.ts`, add imports and the migration function above the class, and change the constructor:

```ts
import fs from 'fs';
import Sqlite3 from 'better-sqlite3';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, threadId TEXT, role TEXT, content TEXT, createdAt INTEGER);
  CREATE INDEX IF NOT EXISTS idx_chats_thread ON chats(threadId);
  CREATE TABLE IF NOT EXISTS chat_refs (chatId INTEGER, messageId TEXT, threadId TEXT);
`;

// One-time move of conversation history out of ai-index.db (the rebuildable vector
// cache) into its own file, so no "clear the index" path can ever destroy chats.
// Idempotent: safe to call on every launch.
export function migrateChats(newDbPath: string, legacyDbPath: string): 'none' | 'migrated' {
  if (!fs.existsSync(legacyDbPath)) return 'none';
  const db = new Sqlite3(newDbPath, { timeout: 10000 });
  try {
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    db.exec(`ATTACH DATABASE '${legacyDbPath.replace(/'/g, "''")}' AS legacy`);
    const legacyHasChats = db
      .prepare(`SELECT name FROM legacy.sqlite_master WHERE type='table' AND name='chats'`)
      .get();
    if (!legacyHasChats) return 'none';
    const legacyCount = (db.prepare('SELECT COUNT(*) c FROM legacy.chats').get() as any).c;
    if (legacyCount === 0) {
      db.exec('DROP TABLE legacy.chats; DROP TABLE IF EXISTS legacy.chat_refs;');
      return 'migrated';
    }
    const newCount = (db.prepare('SELECT COUNT(*) c FROM chats').get() as any).c;
    if (newCount === legacyCount) {
      // Copy finished previously but the drop didn't - just finish the drop.
      db.exec('DROP TABLE legacy.chats; DROP TABLE IF EXISTS legacy.chat_refs;');
      return 'migrated';
    }
    if (newCount > 0) {
      // Partial copy from an interrupted run - wipe and re-copy.
      db.exec('DELETE FROM chats; DELETE FROM chat_refs;');
    }
    const legacyHasRefs = db
      .prepare(`SELECT name FROM legacy.sqlite_master WHERE type='table' AND name='chat_refs'`)
      .get();
    db.exec('BEGIN');
    db.exec('INSERT INTO chats SELECT * FROM legacy.chats');
    if (legacyHasRefs) db.exec('INSERT INTO chat_refs SELECT * FROM legacy.chat_refs');
    const copied = (db.prepare('SELECT COUNT(*) c FROM chats').get() as any).c;
    if (copied !== legacyCount) {
      db.exec('ROLLBACK');
      throw new Error(`chat migration count mismatch: copied ${copied}, expected ${legacyCount}`);
    }
    db.exec('COMMIT');
    // Only after the verified copy: remove the legacy tables.
    db.exec('DROP TABLE legacy.chats; DROP TABLE IF EXISTS legacy.chat_refs;');
    return 'migrated';
  } finally {
    try {
      db.exec('DETACH DATABASE legacy');
    } catch {
      /* not attached */
    }
    db.close();
  }
}
```

Constructor (replace the existing one; reuse `SCHEMA` for the exec):

```ts
  constructor(dbPath: string, legacyDbPath?: string) {
    let openPath = dbPath;
    if (legacyDbPath) {
      try {
        migrateChats(dbPath, legacyDbPath);
      } catch (err) {
        // Never lose data: keep reading from the legacy DB this session and
        // retry the migration on next launch.
        console.warn('[AI] chat migration failed, using legacy DB:', (err as Error).message);
        openPath = legacyDbPath;
      }
    }
    this.db = new Sqlite3(openPath, { timeout: 10000 });
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }
```

In `chat-panel.tsx` `_chatStore()`:

```ts
  private _chatStore(): ChatStore {
    if (!this.__chatStore) {
      const path = require('path');
      this.__chatStore = new ChatStore(
        path.join(AppEnv.getConfigDirPath(), 'ai-chat.db'),
        path.join(AppEnv.getConfigDirPath(), 'ai-index.db')
      );
    }
    return this.__chatStore;
  }
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npm test 2>&1 | grep -A2 "migrateChats\|ChatStore with legacy"`
Expected: all new assertions PASS; zero other failures.

- [ ] **Step 5: Commit**

```bash
git add app/internal_packages/ai-assistant/lib/chat-store.ts app/internal_packages/ai-assistant/lib/chat-panel.tsx app/internal_packages/ai-assistant/specs/chat-store-spec.ts
git commit -m "fix(ai): move chat history to its own ai-chat.db with verified one-time migration"
```

---

### Task 2: Latency status helper + wiring

**Files:**
- Create: `app/internal_packages/ai-assistant/lib/chat-status.ts`
- Modify: `app/internal_packages/ai-assistant/lib/chat-panel.tsx` (state, `_send`, bubble render, Stop button)
- Modify: `app/internal_packages/ai-assistant/styles/ai-assistant.less`
- Test: `app/internal_packages/ai-assistant/specs/chat-status-spec.ts` (new)

**Interfaces:**
- Produces: `type SendPhase = 'idle' | 'retrieving' | 'waiting' | 'streaming'`; `statusForPhase(phase: SendPhase, elapsedSec: number): string | null`; `stopHighlighted(phase: SendPhase, elapsedSec: number): boolean` (all exported from `chat-status.ts`).

- [ ] **Step 1: Write the failing test**

Create `app/internal_packages/ai-assistant/specs/chat-status-spec.ts`:

```ts
import { statusForPhase, stopHighlighted } from '../lib/chat-status';

describe('statusForPhase', () => {
  it('shows retrieving text during retrieval', () => {
    expect(statusForPhase('retrieving', 2)).toContain('Retrieving context');
  });
  it('shows waiting without elapsed under 10s', () => {
    expect(statusForPhase('waiting', 5)).toBe('Waiting for the model…');
  });
  it('adds elapsed seconds from 10s', () => {
    expect(statusForPhase('waiting', 12)).toContain('(12s)');
  });
  it('softens to a reassurance after 30s and never suggests cancel', () => {
    const s = statusForPhase('waiting', 45);
    expect(s).toContain('Still waiting');
    expect(s).toContain('(45s)');
  });
  it('returns null while streaming and when idle', () => {
    expect(statusForPhase('streaming', 60)).toBeNull();
    expect(statusForPhase('idle', 0)).toBeNull();
  });
});

describe('stopHighlighted', () => {
  it('highlights Stop only in waiting phase after 30s', () => {
    expect(stopHighlighted('waiting', 31)).toBe(true);
    expect(stopHighlighted('waiting', 29)).toBe(false);
    expect(stopHighlighted('streaming', 90)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test 2>&1 | grep -B1 -A3 "statusForPhase"`
Expected: FAIL - module `../lib/chat-status` not found.

- [ ] **Step 3: Implement the helper**

Create `app/internal_packages/ai-assistant/lib/chat-status.ts`:

```ts
import { localized } from 'mailspring-exports';

export type SendPhase = 'idle' | 'retrieving' | 'waiting' | 'streaming';

// Status text for the pending assistant bubble. Never suggests cancelling -
// local models legitimately take minutes to load; Stop stays the user's call.
export function statusForPhase(phase: SendPhase, elapsedSec: number): string | null {
  if (phase === 'retrieving') return localized('Retrieving context…');
  if (phase === 'waiting') {
    if (elapsedSec >= 30) {
      return `${localized('Still waiting - local models can take a while to load.')} (${elapsedSec}s)`;
    }
    if (elapsedSec >= 10) return `${localized('Waiting for the model…')} (${elapsedSec}s)`;
    return localized('Waiting for the model…');
  }
  return null;
}

export function stopHighlighted(phase: SendPhase, elapsedSec: number): boolean {
  return phase === 'waiting' && elapsedSec >= 30;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test 2>&1 | grep -A8 "statusForPhase"`
Expected: 5 + 1 new specs PASS.

- [ ] **Step 5: Wire phases into chat-panel**

In `chat-panel.tsx`:

1. Import: `import { SendPhase, statusForPhase, stopHighlighted } from './chat-status';`
2. Add to state initializer: `sendPhase: 'idle' as SendPhase, sendStartedAt: 0, nowTick: 0,`
3. Add instance field: `private _phaseInterval: ReturnType<typeof setInterval> | null = null;`
4. In `_send`, right after `this._abort = new AbortController();`:

```ts
    this.setState({ sendPhase: 'retrieving', sendStartedAt: Date.now(), nowTick: Date.now() });
    this._phaseInterval = setInterval(() => this.setState({ nowTick: Date.now() }), 1000);
```

5. Immediately before the `if (Skills.list().length > 0 ...)` branch (after the prompt is built): `this.setState({ sendPhase: 'waiting' });`
6. In the agent path's `onToken` callback and the plain path's `for await` loop, on the first token: `if (this.state.sendPhase !== 'streaming') this.setState({ sendPhase: 'streaming' });`
7. Inside the agent path's `doStream`, before calling `AIService.chatWithToolsStream`, set `this.setState({ sendPhase: 'waiting' });` (each round-trip returns to waiting).
8. In `_send`'s `finally` block:

```ts
      if (this._phaseInterval) {
        clearInterval(this._phaseInterval);
        this._phaseInterval = null;
      }
      this.setState({ busy: false, sendPhase: 'idle' });
```

(replacing the existing `this.setState({ busy: false })`)
9. Bubble render - replace the assistant streaming fragment:

```tsx
{t.role === 'assistant' ? (
  <>
    {t.content ? renderMarkdown(t.content) : null}
    {isStreaming && !t.content && (
      <span className="ai-status-text">
        {statusForPhase(
          this.state.sendPhase,
          Math.floor((this.state.nowTick - this.state.sendStartedAt) / 1000)
        )}
      </span>
    )}
    {isStreaming && <span className="ai-cursor">▊</span>}
  </>
```

10. Stop button - add the urgent class:

```tsx
<button
  className={`ai-send-btn cancel${
    stopHighlighted(
      this.state.sendPhase,
      Math.floor((this.state.nowTick - this.state.sendStartedAt) / 1000)
    )
      ? ' urgent'
      : ''
  }`}
  onClick={this._cancel}
>
  {localized('Stop')}
</button>
```

11. In `componentWillUnmount` (if present; otherwise add): clear `this._phaseInterval`.

LESS (in `ai-assistant.less`, near the `.ai-cursor` rule):

```less
.ai-status-text {
  font-style: italic;
  font-size: 12px;
  color: var(--text-color-subtle);
  margin-right: 4px;
}

.ai-send-btn.cancel.urgent {
  border-color: var(--color-danger, #d9534f);
  color: var(--color-danger, #d9534f);
}
```

- [ ] **Step 6: Verify suite + lint**

Run: `npm test 2>&1 | tail -3 && npx eslint --fix app/internal_packages/ai-assistant/lib/chat-panel.tsx app/internal_packages/ai-assistant/lib/chat-status.ts`
Expected: exit 0, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add app/internal_packages/ai-assistant/lib/chat-status.ts app/internal_packages/ai-assistant/lib/chat-panel.tsx app/internal_packages/ai-assistant/styles/ai-assistant.less app/internal_packages/ai-assistant/specs/chat-status-spec.ts
git commit -m "feat(ai): staged status text, elapsed time, and 30s soft warning for slow model requests"
```

---

### Task 3: Empty-state fix + time-aware global pills

**Files:**
- Create: `app/internal_packages/ai-assistant/lib/suggestions.ts`
- Modify: `app/internal_packages/ai-assistant/lib/chat-panel.tsx` (empty-state render, `getInitialSuggestions`)
- Test: `app/internal_packages/ai-assistant/specs/suggestions-spec.ts` (new)

**Interfaces:**
- Produces: `getGlobalSuggestions(now: Date): string[]` exported from `suggestions.ts`.

- [ ] **Step 1: Write the failing test**

Create `app/internal_packages/ai-assistant/specs/suggestions-spec.ts`:

```ts
import { getGlobalSuggestions } from '../lib/suggestions';

describe('getGlobalSuggestions', () => {
  it('leads with the daily digest on a weekday morning', () => {
    const wedMorning = new Date('2026-07-01T08:00:00'); // Wednesday
    expect(getGlobalSuggestions(wedMorning)[0]).toBe("What's new today?");
  });
  it('swaps in last-week summary on Mondays', () => {
    const monday = new Date('2026-06-29T10:00:00');
    const pills = getGlobalSuggestions(monday);
    expect(pills).toContain('Summarize last week');
    expect(pills.length).toBe(4);
  });
  it('keeps this-week summary available on Fridays', () => {
    const friday = new Date('2026-07-03T15:00:00');
    expect(getGlobalSuggestions(friday)).toContain('Summarize this week');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test 2>&1 | grep -B1 -A3 getGlobalSuggestions`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Create `app/internal_packages/ai-assistant/lib/suggestions.ts`:

```ts
// Global (no-thread) suggestion pills, lightly time-aware. Pure function so specs
// can pin the date.
const BASE = ["What's new today?", 'Summarize this week', 'Summarize this month', 'Find unread emails'];

export function getGlobalSuggestions(now: Date): string[] {
  const pills = [...BASE];
  if (now.getDay() === 1) pills[2] = 'Summarize last week'; // Monday: last week beats this month
  return pills;
}
```

In `chat-panel.tsx`, import it and change the no-thread branch of `getInitialSuggestions`:

```ts
import { getGlobalSuggestions } from './suggestions';
// ...
function getInitialSuggestions(thread: any): string[] {
  if (!thread) return getGlobalSuggestions(new Date());
  // (rest unchanged)
```

- [ ] **Step 4: Fix the empty-state condition**

In the messages render, change the empty-state gate so the whole block (icon, title, hint, pills) only shows for an empty conversation:

```tsx
{!thread && turns.length === 0 && (
  <div className="ai-empty-state">
    <div className="ai-empty-icon">✦</div>
    <div className="ai-empty-title">{localized('AI Assistant')}</div>
    <div className="ai-empty-hint">
      {localized('Ask about your mailbox, or open a thread to chat about it.')}
    </div>
    <div className="ai-suggestions">
      {getInitialSuggestions(null).map((s) => (
        <button key={s} className="ai-suggestion-chip" onClick={() => this._send(s)}>
          {s}
        </button>
      ))}
    </div>
  </div>
)}
```

(The inner `{turns.length === 0 && ...}` guard around the pills is removed - the outer condition covers it. The thread-focused pills block below it is unchanged.)

- [ ] **Step 5: Run tests, lint, verify**

Run: `npm test 2>&1 | tail -3 && npx eslint --fix app/internal_packages/ai-assistant/lib/chat-panel.tsx app/internal_packages/ai-assistant/lib/suggestions.ts`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/internal_packages/ai-assistant/lib/suggestions.ts app/internal_packages/ai-assistant/lib/chat-panel.tsx app/internal_packages/ai-assistant/specs/suggestions-spec.ts
git commit -m "fix(ai): hide empty-state header once chatting; time-aware global suggestion pills"
```

---

### Task 4: New-chat button + thread-change chip

**Files:**
- Modify: `app/internal_packages/ai-assistant/lib/chat-panel.tsx`
- Modify: `app/internal_packages/ai-assistant/styles/ai-assistant.less`

**Interfaces:**
- Consumes: `_clearHistory` (existing method that starts a fresh session).
- Produces: instance field `_conversationThreadId: string | null`; state field `chipDismissedFor: string | null`.

- [ ] **Step 1: Rename the button**

In the header controls, change the clear button:

```tsx
<button className="ai-clear-btn" title={localized('New chat')} onClick={this._clearHistory}>
  ＋
</button>
```

- [ ] **Step 2: Track the conversation's origin thread**

1. Instance field: `private _conversationThreadId: string | null = null;`
2. State field in initializer: `chipDismissedFor: null as string | null,`
3. In `_send`, before building the `turns` array: `if (this.state.turns.length === 0) this._conversationThreadId = this.state.thread?.id ?? null;`
4. In `_resumeConversation`, after setting state: `this._conversationThreadId = this.state.thread?.id ?? null;`
5. In `_clearHistory`, also reset: `this._conversationThreadId = null;` and include `chipDismissedFor: null` in its `setState`.

- [ ] **Step 3: Render the chip above the input**

Immediately above the textarea's container (inside the input area, before the textarea):

```tsx
{thread && turns.length > 0 && this._conversationThreadId !== thread.id && this.state.chipDismissedFor !== thread.id && (
  <div className="ai-thread-chip">
    <span className="ai-thread-chip-label">
      {localized('Now chatting about:')} <em>{thread.subject || localized('(no subject)')}</em>
    </span>
    <button className="ai-thread-chip-new" onClick={this._clearHistory}>
      {localized('New chat')}
    </button>
    <button
      className="ai-thread-chip-dismiss"
      title={localized('Dismiss')}
      onClick={() => this.setState({ chipDismissedFor: thread.id })}
    >
      ✕
    </button>
  </div>
)}
```

LESS:

```less
.ai-thread-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 6px;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 11px;
  background: color-mix(in srgb, var(--accent-primary, #6366f1) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-primary, #6366f1) 25%, transparent);
  color: var(--text-color);

  .ai-thread-chip-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    em {
      font-style: normal;
      font-weight: 600;
    }
  }
  .ai-thread-chip-new {
    border: none;
    background: none;
    color: var(--accent-primary, #6366f1);
    font-weight: 600;
    cursor: pointer;
    padding: 0;
  }
  .ai-thread-chip-dismiss {
    border: none;
    background: none;
    color: var(--text-color-subtle);
    cursor: pointer;
    padding: 0 2px;
  }
}
```

- [ ] **Step 4: Verify, lint, commit**

Run: `npm test 2>&1 | tail -3 && npx eslint --fix app/internal_packages/ai-assistant/lib/chat-panel.tsx`
Expected: exit 0.

```bash
git add app/internal_packages/ai-assistant/lib/chat-panel.tsx app/internal_packages/ai-assistant/styles/ai-assistant.less
git commit -m "feat(ai): honest New-chat button and thread-change chip mid-conversation"
```

---

### Task 5: History list - filter, date grouping, hover delete, deduped titles

**Files:**
- Create: `app/internal_packages/ai-assistant/lib/history-utils.ts`
- Modify: `app/internal_packages/ai-assistant/lib/chat-panel.tsx` (`_renderHistory`, state)
- Modify: `app/internal_packages/ai-assistant/styles/ai-assistant.less`
- Test: `app/internal_packages/ai-assistant/specs/history-utils-spec.ts` (new)

**Interfaces:**
- Produces (from `history-utils.ts`):
  - `type HistoryItem = { sessionId: string; subject: string; preview: string; lastAt: number; count: number }`
  - `dedupeTitles(items: HistoryItem[]): HistoryItem[]` (appends " · <Mon D>" to repeated subjects)
  - `groupByDate(items: HistoryItem[], now: Date): Array<{ label: string; items: HistoryItem[] }>` (labels: `Today`, `This week`, `Older`; empty groups omitted)

- [ ] **Step 1: Write the failing test**

Create `app/internal_packages/ai-assistant/specs/history-utils-spec.ts`:

```ts
import { dedupeTitles, groupByDate, HistoryItem } from '../lib/history-utils';

const item = (over: Partial<HistoryItem>): HistoryItem => ({
  sessionId: Math.random().toString(36),
  subject: 'Draft a reply',
  preview: '',
  lastAt: Date.parse('2026-07-03T10:00:00'),
  count: 2,
  ...over,
});

describe('dedupeTitles', () => {
  it('appends the date to repeated titles only', () => {
    const items = [
      item({ subject: 'Draft a reply', lastAt: Date.parse('2026-07-02T10:00:00') }),
      item({ subject: 'Draft a reply', lastAt: Date.parse('2026-07-01T10:00:00') }),
      item({ subject: 'Unique title' }),
    ];
    const out = dedupeTitles(items);
    expect(out[0].subject).toContain('·');
    expect(out[1].subject).toContain('·');
    expect(out[2].subject).toBe('Unique title');
  });
});

describe('groupByDate', () => {
  it('buckets into Today, This week, Older and omits empty groups', () => {
    const now = new Date('2026-07-03T12:00:00');
    const items = [
      item({ lastAt: Date.parse('2026-07-03T08:00:00') }), // today
      item({ lastAt: Date.parse('2026-06-30T08:00:00') }), // this week
      item({ lastAt: Date.parse('2026-05-01T08:00:00') }), // older
    ];
    const groups = groupByDate(items, now);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'This week', 'Older']);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
    const onlyOld = groupByDate([items[2]], now);
    expect(onlyOld.map((g) => g.label)).toEqual(['Older']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test 2>&1 | grep -B1 -A3 "dedupeTitles\|groupByDate"`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Create `app/internal_packages/ai-assistant/lib/history-utils.ts`:

```ts
import { localized } from 'mailspring-exports';

export type HistoryItem = {
  sessionId: string;
  subject: string;
  preview: string;
  lastAt: number;
  count: number;
};

// "Draft a reply" x12 is useless - suffix repeated titles with their date.
export function dedupeTitles(items: HistoryItem[]): HistoryItem[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.subject, (counts.get(i.subject) || 0) + 1);
  return items.map((i) =>
    (counts.get(i.subject) || 0) > 1
      ? {
          ...i,
          subject: `${i.subject} · ${new Date(i.lastAt).toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
          })}`,
        }
      : i
  );
}

export function groupByDate(
  items: HistoryItem[],
  now: Date
): Array<{ label: string; items: HistoryItem[] }> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = now.getTime() - 7 * 86400000;
  const buckets: Array<{ label: string; items: HistoryItem[] }> = [
    { label: localized('Today'), items: [] },
    { label: localized('This week'), items: [] },
    { label: localized('Older'), items: [] },
  ];
  for (const i of items) {
    if (i.lastAt >= startOfToday) buckets[0].items.push(i);
    else if (i.lastAt >= weekAgo) buckets[1].items.push(i);
    else buckets[2].items.push(i);
  }
  return buckets.filter((b) => b.items.length > 0);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test 2>&1 | grep -A5 "dedupeTitles\|groupByDate"`
Expected: PASS.

- [ ] **Step 5: Wire into `_renderHistory`**

1. Import: `import { dedupeTitles, groupByDate } from './history-utils';`
2. State field: `historyFilter: '',`
3. Replace the list rendering inside `_renderHistory` (keep the existing header + Clear All button):

```tsx
    const filter = this.state.historyFilter.trim().toLowerCase();
    const visible = dedupeTitles(historyItems).filter(
      (i) =>
        !filter ||
        i.subject.toLowerCase().includes(filter) ||
        i.preview.toLowerCase().includes(filter)
    );
    const groups = groupByDate(visible, new Date());
```

After the `.ai-history-header` div, add the filter input:

```tsx
        <input
          className="ai-history-filter"
          type="text"
          placeholder={localized('Search conversations…')}
          value={this.state.historyFilter}
          onChange={(e) => this.setState({ historyFilter: e.target.value })}
        />
```

Replace the flat `historyItems.map(...)` list with grouped rendering (item row JSX unchanged inside):

```tsx
          <div className="ai-history-list">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="ai-history-group-label">{g.label}</div>
                {g.items.map((item) => (
                  /* existing .ai-history-item JSX, unchanged */
                ))}
              </div>
            ))}
          </div>
```

Keep the "no conversations" empty branch keyed on `historyItems.length === 0`; when `visible.length === 0` but a filter is active, show `<div className="ai-history-empty">{localized('No conversations match your search.')}</div>`.

LESS additions:

```less
.ai-history-filter {
  margin: 8px 12px 2px;
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid @input-border-color;
  background: @background-primary;
  color: var(--text-color);
  outline: none;
}

.ai-history-group-label {
  padding: 8px 14px 2px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-color-subtle);
}

.ai-history-delete-btn {
  opacity: 0;
  transition: opacity 0.12s;
}
.ai-history-item:hover .ai-history-delete-btn {
  opacity: 1;
}
```

(The `.ai-history-delete-btn` base styles from the earlier feature remain; only the opacity rules are added.)

- [ ] **Step 6: Verify, lint, commit**

Run: `npm test 2>&1 | tail -3 && npx eslint --fix app/internal_packages/ai-assistant/lib/chat-panel.tsx app/internal_packages/ai-assistant/lib/history-utils.ts`
Expected: exit 0.

```bash
git add app/internal_packages/ai-assistant/lib/history-utils.ts app/internal_packages/ai-assistant/lib/chat-panel.tsx app/internal_packages/ai-assistant/styles/ai-assistant.less app/internal_packages/ai-assistant/specs/history-utils-spec.ts
git commit -m "feat(ai): history search, date grouping, hover-delete, and deduped titles"
```

---

### Task 6: Signature stripping + composer menu hint

**Files:**
- Modify: `app/internal_packages/ai-assistant/lib/composer-assist.tsx`
- Modify: `app/internal_packages/ai-assistant/styles/ai-assistant.less`
- Test: `app/internal_packages/ai-assistant/specs/composer-assist-spec.ts` (new)

**Interfaces:**
- Produces: `splitSignature(body: string): { content: string; signature: string }` exported from `composer-assist.tsx`.
- Consumes: `RegExpUtils.mailspringSignatureRegex()` from `mailspring-exports` (matches `<signature id="...">...</signature>`).

- [ ] **Step 1: Write the failing test**

Create `app/internal_packages/ai-assistant/specs/composer-assist-spec.ts`:

```ts
import { splitSignature } from '../lib/composer-assist';

describe('splitSignature', () => {
  const SIG = '<signature id="abc-123">Sent from <a href="https://getmailspring.com">Mailspring</a></signature>';

  it('separates the signature from the content', () => {
    const body = `<div>Hello world</div>${SIG}`;
    const { content, signature } = splitSignature(body);
    expect(content).toBe('<div>Hello world</div>');
    expect(signature).toBe(SIG);
  });

  it('keeps trailing quoted text with the content', () => {
    const body = `<div>Reply text</div>${SIG}<blockquote class="gmail_quote">old</blockquote>`;
    const { content, signature } = splitSignature(body);
    expect(content).toContain('gmail_quote');
    expect(signature).toBe(SIG);
  });

  it('returns the body unchanged when there is no signature', () => {
    const { content, signature } = splitSignature('<div>plain</div>');
    expect(content).toBe('<div>plain</div>');
    expect(signature).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test 2>&1 | grep -B1 -A4 splitSignature`
Expected: FAIL - `splitSignature` is not exported.

- [ ] **Step 3: Implement and wire**

In `composer-assist.tsx`, add to imports: `RegExpUtils` from `'mailspring-exports'`, then above the component:

```ts
// The Mailspring signature element ("Sent from Mailspring...") is metadata, not prose:
// never send it to the model (wasted tokens, branding leaks into rewrites) and never
// let the model rewrite it. Split it out before every AI command, re-append after.
export function splitSignature(body: string): { content: string; signature: string } {
  const match = RegExpUtils.mailspringSignatureRegex().exec(body || '');
  if (!match) return { content: body || '', signature: '' };
  const idx = match.index;
  return {
    content: (body || '').slice(0, idx) + (body || '').slice(idx + match[0].length),
    signature: match[0],
  };
}
```

In `_run`, right after the privacy gate:

```ts
    const { content: bodySansSig, signature } = splitSignature(draft.body || '');
```

Then replace every use of `draft.body` in the command paths:
- nextline: `const s = await suggestNextLine(bodySansSig, this._sender());` and the apply becomes `session.changes.add({ body: bodySansSig + SanitizeTransformer.runSync('<span>' + s + '</span>') + signature });`
- `inputText`: derive from `bodySansSig` instead of `draft.body` (both the HTML/grammar branch and the tag-stripping branch).
- Result apply: `session.changes.add({ body: html + signature });` (both grammar and plain paths - `html` is the sanitized AI output).

- [ ] **Step 4: Add the menu footer note**

In the menu portal JSX after the `COMMANDS.map(...)` items:

```tsx
          <div className="note">
            {localized('Rewrite commands output plain text · Fix grammar keeps formatting')}
          </div>
```

LESS (inside the top-level `.ai-assist-menu` rule):

```less
  .note {
    font-size: 10px;
    color: var(--text-color-subtle);
    padding: 6px 10px 4px;
    border-top: 1px solid @border-color-divider;
    margin-top: 4px;
  }
```

- [ ] **Step 5: Verify, lint, commit**

Run: `npm test 2>&1 | tail -3 && npx eslint --fix app/internal_packages/ai-assistant/lib/composer-assist.tsx`
Expected: exit 0, splitSignature specs PASS.

```bash
git add app/internal_packages/ai-assistant/lib/composer-assist.tsx app/internal_packages/ai-assistant/styles/ai-assistant.less app/internal_packages/ai-assistant/specs/composer-assist-spec.ts
git commit -m "fix(ai): keep signatures out of AI input and intact in output; disclose formatting behavior in menu"
```

---

### Task 7: Composer action-bar stable height (CSS only)

**Files:**
- Modify: `app/internal_packages/composer/styles/composer.less:426-431`

- [ ] **Step 1: Add min-height**

In `.composer-action-bar-content` (currently `display: flex; margin: 0 auto; flex-direction: row; padding: 9px 22.5px;`):

```less
    .composer-action-bar-content {
      display: flex;
      margin: 0 auto;
      flex-direction: row;
      padding: 9px 22.5px;
      // Plugin buttons register a beat after the window opens; reserve the bar's
      // height so their arrival never shifts the layout.
      min-height: 46px;
      align-items: center;
```

- [ ] **Step 2: Commit**

```bash
git add app/internal_packages/composer/styles/composer.less
git commit -m "fix(composer): reserve action-bar height so late-loading plugin buttons don't shift layout"
```

---

### Task 8: Preferences - local-model preset, Advanced affordance, centering

**Files:**
- Modify: `app/internal_packages/ai-assistant/lib/config.ts`
- Modify: `app/internal_packages/ai-assistant/lib/preferences.tsx`
- Modify: `app/internal_packages/ai-assistant/styles/ai-assistant.less`

**Interfaces:**
- Produces: `LOCAL_FAST_PRESET` const exported from `config.ts`; `ragMode` union gains `'local-fast'`.

- [ ] **Step 1: Add the preset to config.ts**

```ts
// Preset for small local models (4-8B): a 24k-char context means minutes of prompt
// processing on llama.cpp-class hardware; trade recall for latency.
export const LOCAL_FAST_PRESET = {
  ...RAG_DEFAULTS,
  contextBudget: 6000,
  retrieveK: 4,
  maxAgentSteps: 4,
} as const;
```

And widen the mode getter: `getRagMode: () => get<'default' | 'auto-tune' | 'custom' | 'local-fast'>(K.ragMode, 'default'),`

- [ ] **Step 2: Wire the mode into preferences.tsx**

1. Import `LOCAL_FAST_PRESET` from `./config`.
2. Widen the state type and `_setRagMode` parameter to include `'local-fast'`.
3. In `_setRagMode`, add the branch (mirroring the `default` branch structure):

```ts
    } else if (mode === 'local-fast') {
      this._applyParamValues(LOCAL_FAST_PRESET as AutoTuneResult);
      this.setState({
        ragMode: 'local-fast',
        advancedResetKey: this.state.advancedResetKey + 1,
        adv: { ...LOCAL_FAST_PRESET },
      });
    }
```

4. Add the selector entry after `['auto-tune', ...]`:

```ts
                        ['local-fast', localized('Local model (fast)')],
```

(and widen the tuple type annotation on that array accordingly)
5. Mode description block:

```tsx
                    {ragMode === 'local-fast' &&
                      localized(
                        'Smaller context tuned for small local models (faster responses, less recall).'
                      )}
```

6. Mode content grid: `{ragMode === 'local-fast' && readOnlyGrid(LOCAL_FAST_PRESET as AutoTuneResult)}`

- [ ] **Step 3: Advanced affordance + centering**

1. Summary element - prepend a chevron span and use accent color in its inline style (`color: 'var(--accent-primary, #6366f1)'`), text becomes:

```tsx
              <span className="ai-adv-chevron">▸</span> {localized('Advanced settings')}
```

2. LESS:

```less
.ai-adv-chevron {
  display: inline-block;
  transition: transform 0.12s;
}
details[open] .ai-adv-chevron {
  transform: rotate(90deg);
}
```

3. Root container style: `style={{ maxWidth: 600, margin: '0 auto' }}`.

- [ ] **Step 4: Verify, lint, commit**

Run: `npm test 2>&1 | tail -3 && npx eslint --fix app/internal_packages/ai-assistant/lib/preferences.tsx app/internal_packages/ai-assistant/lib/config.ts && npx tsc -p app/tsconfig.json --noEmit`
Expected: exit 0 for all three.

```bash
git add app/internal_packages/ai-assistant/lib/config.ts app/internal_packages/ai-assistant/lib/preferences.tsx app/internal_packages/ai-assistant/styles/ai-assistant.less
git commit -m "feat(ai): Local model (fast) RAG preset, clickable Advanced expander, centered prefs column"
```

---

### Task 9: Full gate + live verification

**Files:** none (verification only)

- [ ] **Step 1: Full CI-equivalent gate**

Run: `npm run lint:check && npm run typecheck && npm test 2>&1 | tail -5`
Expected: all exit 0, 1610+ specs passing, 0 failures.

- [ ] **Step 2: Live smoke via the Playwright harness** (per `dev-verify-workflow` memory)

Launch the dev app with the established `_electron` + CDP driver and verify:
1. History panel opens and prior conversations are present (migration worked against the real dev profile; `ai-chat.db` now exists and `ai-index.db` no longer has a `chats` table).
2. Empty panel with no thread shows pills; sending a message removes the empty-state header; the pending bubble shows "Retrieving context…" then "Waiting for the model…".
3. History shows group labels and the filter input narrows the list; Delete appears on hover.
4. Composer: type text, run Fix grammar, confirm the signature survives verbatim; ✨ AI menu shows the footer note.
5. Preferences: RAG selector shows 4 modes; choosing "Local model (fast)" shows the 6000-char grid; column is centered.

- [ ] **Step 3: Final commit if any fixups, then push**

```bash
git push origin refs/heads/master
```

---

## Self-Review Notes

- Spec coverage: §1→Task 1, §2→Task 2, §3→Task 3, §4→Task 7, §5→Task 8, §6→Task 4, §7→Tasks 4+5, §8→Task 6, §9→Task 6, §10→Task 3, §11→Task 8, testing→every task + Task 9.
- Type consistency: `SendPhase`/`statusForPhase`/`stopHighlighted` (Tasks 2), `HistoryItem`/`dedupeTitles`/`groupByDate` (Task 5), `splitSignature` (Task 6), `LOCAL_FAST_PRESET` (Task 8) - names match across steps.
- No placeholders: every code step contains the code.
