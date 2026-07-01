import Sqlite3 from 'better-sqlite3';

export class ChatStore {
  private db: Sqlite3.Database;
  constructor(dbPath: string) {
    this.db = new Sqlite3(dbPath, { timeout: 10000 });
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, threadId TEXT, role TEXT, content TEXT, createdAt INTEGER);
      CREATE INDEX IF NOT EXISTS idx_chats_thread ON chats(threadId);
      CREATE TABLE IF NOT EXISTS chat_refs (chatId INTEGER, messageId TEXT, threadId TEXT);
    `);
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

  clearAll(): void {
    this.db.exec('DELETE FROM chats; DELETE FROM chat_refs;');
  }
  close(): void {
    this.db.close();
  }
}
