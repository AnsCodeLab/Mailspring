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
    // BM25 keyword index for hybrid retrieval. rowid mirrors chunks.id; kept in sync by
    // upsertMessage/removeMessage/clear (the only write paths). Databases created before
    // this table existed are backfilled from their chunks on first open.
    const hadFts = !!this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'`)
      .get();
    if (!hadFts) {
      this.db.exec(`CREATE VIRTUAL TABLE chunks_fts USING fts5(chunkText, subject, sender)`);
      this.db.exec(
        `INSERT INTO chunks_fts (rowid, chunkText, subject, sender) SELECT id, chunkText, subject, sender FROM chunks`
      );
    }
  }
  private deleteFtsForMessage(messageId: string): void {
    this.db
      .prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE messageId = ?)')
      .run(messageId);
  }
  upsertMessage(meta: MsgMeta, chunks: Array<{ text: string; vector: number[] }>): void {
    const tx = this.db.transaction(() => {
      this.deleteFtsForMessage(meta.messageId);
      this.db.prepare('DELETE FROM chunks WHERE messageId = ?').run(meta.messageId);
      const ins = this.db.prepare(
        'INSERT INTO chunks (messageId, threadId, accountId, date, sender, subject, chunkText, embedding, dim) VALUES (?,?,?,?,?,?,?,?,?)'
      );
      const insFts = this.db.prepare(
        'INSERT INTO chunks_fts (rowid, chunkText, subject, sender) VALUES (?,?,?,?)'
      );
      for (const c of chunks) {
        const { lastInsertRowid } = ins.run(
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
        insFts.run(lastInsertRowid, c.text, meta.subject, meta.sender);
      }
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
      this.deleteFtsForMessage(messageId);
      this.db.prepare('DELETE FROM chunks WHERE messageId = ?').run(messageId);
      this.db.prepare('DELETE FROM indexed_messages WHERE messageId = ?').run(messageId);
    });
    tx();
  }
  // BM25 keyword search over chunk text/subject/sender. The query is reduced to quoted
  // phrase terms so user input can never hit FTS5 operator syntax (AND, NOT, parens).
  keywordSearch(query: string, k: number) {
    const terms = (query || '')
      .split(/\s+/)
      .map((t) => t.replace(/"/g, '').trim())
      .filter(Boolean);
    if (!terms.length) return [];
    const match = terms.map((t) => `"${t}"`).join(' OR ');
    const rows = this.db
      .prepare(
        `SELECT c.id, c.messageId, c.threadId, c.sender, c.subject, c.date, c.chunkText
         FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
         WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?`
      )
      .all(match, k) as any[];
    return rows.map((r) => ({
      id: String(r.id),
      messageId: r.messageId,
      threadId: r.threadId,
      sender: r.sender,
      subject: r.subject,
      date: r.date,
      chunkText: r.chunkText,
    }));
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
  indexedMessageCount(): number {
    return (
      (this.db.prepare('SELECT COUNT(*) as n FROM indexed_messages').get() as any) || { n: 0 }
    ).n;
  }
  chunkTextLengths(): number[] {
    return (this.db.prepare('SELECT length(chunkText) as len FROM chunks').all() as any[]).map(
      (r) => r.len as number
    );
  }
  getMeta(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as any;
    return r?.value;
  }
  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }
  clear(): void {
    this.db.exec('DELETE FROM chunks_fts; DELETE FROM chunks; DELETE FROM indexed_messages;');
  }
  close(): void {
    this.db.close();
  }
}
