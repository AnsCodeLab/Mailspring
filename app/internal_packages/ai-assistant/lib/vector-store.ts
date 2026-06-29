import Sqlite3 from 'better-sqlite3';
import { vectorToBuffer, bufferToVector } from './similarity';

export type MsgMeta = {
  messageId: string;
  threadId: string;
  accountId: string;
  date: string;
  sender: string;
  subject: string;
  contentHash: string;
  model: string;
  dim: number;
};

export class VectorStore {
  private db: Sqlite3.Database;
  constructor(dbPath: string) {
    this.db = new Sqlite3(dbPath, { timeout: 10000 });
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, messageId TEXT, threadId TEXT, accountId TEXT, date TEXT, sender TEXT, subject TEXT, chunkText TEXT, embedding BLOB, dim INTEGER);
      CREATE INDEX IF NOT EXISTS idx_chunks_msg ON chunks(messageId);
      CREATE TABLE IF NOT EXISTS indexed_messages (messageId TEXT PRIMARY KEY, contentHash TEXT, model TEXT, dim INTEGER, indexedAt INTEGER);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    `);
  }
  upsertMessage(meta: MsgMeta, chunks: Array<{ text: string; vector: number[] }>): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE messageId = ?').run(meta.messageId);
      const ins = this.db.prepare(
        'INSERT INTO chunks (messageId, threadId, accountId, date, sender, subject, chunkText, embedding, dim) VALUES (?,?,?,?,?,?,?,?,?)'
      );
      for (const c of chunks)
        ins.run(
          meta.messageId,
          meta.threadId,
          meta.accountId,
          meta.date,
          meta.sender,
          meta.subject,
          c.text,
          vectorToBuffer(c.vector),
          meta.dim
        );
      this.db
        .prepare(
          'INSERT OR REPLACE INTO indexed_messages (messageId, contentHash, model, dim, indexedAt) VALUES (?,?,?,?,?)'
        )
        .run(meta.messageId, meta.contentHash, meta.model, meta.dim, Date.now());
    });
    tx();
  }
  removeMessage(messageId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE messageId = ?').run(messageId);
      this.db.prepare('DELETE FROM indexed_messages WHERE messageId = ?').run(messageId);
    });
    tx();
  }
  isIndexed(messageId: string, contentHash: string): boolean {
    const row = this.db
      .prepare('SELECT contentHash FROM indexed_messages WHERE messageId = ?')
      .get(messageId) as any;
    return !!row && row.contentHash === contentHash;
  }
  indexedMessageIds(): Set<string> {
    return new Set(
      (this.db.prepare('SELECT messageId FROM indexed_messages').all() as any[]).map(
        (r) => r.messageId
      )
    );
  }
  allVectors() {
    return (this.db.prepare('SELECT * FROM chunks').all() as any[]).map((r) => ({
      id: String(r.id),
      messageId: r.messageId,
      threadId: r.threadId,
      sender: r.sender,
      subject: r.subject,
      date: r.date,
      chunkText: r.chunkText,
      vector: bufferToVector(r.embedding),
    }));
  }
  getMeta(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as any;
    return r?.value;
  }
  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }
  clear(): void {
    this.db.exec('DELETE FROM chunks; DELETE FROM indexed_messages;');
  }
  close(): void {
    this.db.close();
  }
}
