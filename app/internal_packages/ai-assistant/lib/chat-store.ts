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

export class ChatStore {
  private db: Sqlite3.Database;
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
  append(threadId: string, role: 'user' | 'assistant', content: string, refs: string[] = []): void {
    const info = this.db
      .prepare('INSERT INTO chats (threadId, role, content, createdAt) VALUES (?,?,?,?)')
      .run(threadId, role, content, Date.now());
    const ins = this.db.prepare(
      'INSERT INTO chat_refs (chatId, messageId, threadId) VALUES (?,?,?)'
    );
    for (const m of refs) ins.run(info.lastInsertRowid, m, threadId);
  }
  history(threadId: string): Array<{ id: number; role: string; content: string; refs: string[] }> {
    const rows = this.db
      .prepare('SELECT * FROM chats WHERE threadId = ? ORDER BY id')
      .all(threadId) as any[];
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      refs: (
        this.db.prepare('SELECT messageId FROM chat_refs WHERE chatId = ?').all(r.id) as any[]
      ).map((x) => x.messageId),
    }));
  }
  clearThread(threadId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chat_refs WHERE threadId = ?').run(threadId);
      this.db.prepare('DELETE FROM chats WHERE threadId = ?').run(threadId);
    });
    tx();
  }
  threadIdsWithHistory(): string[] {
    return (
      this.db.prepare('SELECT DISTINCT threadId FROM chats').all() as Array<{ threadId: string }>
    ).map((r) => r.threadId);
  }

  conversationSummaries(): Array<{
    sessionId: string;
    lastAt: number;
    count: number;
    title: string;
    preview: string;
  }> {
    return (
      this.db
        .prepare(
          `SELECT threadId,
                  MAX(createdAt) AS lastAt,
                  COUNT(*) AS count,
                  (SELECT content FROM chats c2
                   WHERE c2.threadId = c1.threadId AND c2.role = 'user'
                   ORDER BY c2.id ASC LIMIT 1) AS title,
                  (SELECT content FROM chats c2
                   WHERE c2.threadId = c1.threadId AND c2.role = 'assistant'
                   ORDER BY c2.id DESC LIMIT 1) AS preview
           FROM chats c1
           GROUP BY threadId
           ORDER BY lastAt DESC`
        )
        .all() as any[]
    ).map((r) => ({
      sessionId: r.threadId as string,
      lastAt: r.lastAt as number,
      count: r.count as number,
      title: String(r.title || 'Conversation').slice(0, 80),
      preview: String(r.preview || '').slice(0, 120),
    }));
  }

  clearAll(): void {
    this.db.exec('DELETE FROM chats; DELETE FROM chat_refs;');
  }
  close(): void {
    this.db.close();
  }
}
