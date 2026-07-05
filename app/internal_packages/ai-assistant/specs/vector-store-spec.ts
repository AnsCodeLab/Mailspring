import path from 'path';
import os from 'os';
import fs from 'fs';
import { VectorStore } from '../lib/vector-store';

describe('VectorStore', () => {
  let dir: string;
  let store: VectorStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-vs-'));
    store = new VectorStore(path.join(dir, 'i.db'));
  });
  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const meta = (id: string, hash = 'h1') => ({
    messageId: id,
    threadId: 't',
    accountId: 'a',
    date: '2026-01-01',
    sender: 'Bob',
    subject: 'Re',
    contentHash: hash,
    model: 'm',
    dim: 2,
  });

  it('upserts and returns vectors', () => {
    store.upsertMessage(meta('m1'), [{ text: 'hello', vector: [1, 0] }]);
    const all = store.allVectors();
    expect(all.length).toBe(1);
    expect(all[0].messageId).toBe('m1');
    expect(Array.from(all[0].vector)).toEqual([1, 0]);
  });
  it('isIndexed reflects content hash (idempotency)', () => {
    store.upsertMessage(meta('m1', 'h1'), [{ text: 'x', vector: [1, 0] }]);
    expect(store.isIndexed('m1', 'h1')).toBe(true);
    expect(store.isIndexed('m1', 'h2')).toBe(false);
  });
  it('re-upsert replaces old chunks (no duplicates)', () => {
    store.upsertMessage(meta('m1', 'h1'), [{ text: 'x', vector: [1, 0] }]);
    store.upsertMessage(meta('m1', 'h2'), [{ text: 'y', vector: [0, 1] }]);
    expect(store.allVectors().length).toBe(1);
    expect(store.allVectors()[0].chunkText).toBe('y');
  });
  it('removeMessage drops chunks and the indexed row', () => {
    store.upsertMessage(meta('m1'), [{ text: 'x', vector: [1, 0] }]);
    store.removeMessage('m1');
    expect(store.allVectors().length).toBe(0);
    expect(store.isIndexed('m1', 'h1')).toBe(false);
  });
  it('persists and reads back meta', () => {
    store.setMeta('model', 'abc');
    expect(store.getMeta('model')).toBe('abc');
  });

  describe('keywordSearch', () => {
    it('finds chunks containing the query terms', () => {
      store.upsertMessage(meta('m1'), [{ text: 'invoice INV-4421 attached', vector: [1, 0] }]);
      store.upsertMessage(meta('m2'), [{ text: 'lunch on friday?', vector: [0, 1] }]);
      const hits = store.keywordSearch('INV-4421', 10);
      expect(hits.length).toBe(1);
      expect(hits[0].messageId).toBe('m1');
      expect(hits[0].chunkText).toBe('invoice INV-4421 attached');
    });
    it('limits results to k', () => {
      for (let i = 0; i < 5; i++) {
        store.upsertMessage(meta(`m${i}`), [{ text: `budget report ${i}`, vector: [1, 0] }]);
      }
      expect(store.keywordSearch('budget', 3).length).toBe(3);
    });
    it('returns empty for no matches and for empty queries', () => {
      store.upsertMessage(meta('m1'), [{ text: 'hello world', vector: [1, 0] }]);
      expect(store.keywordSearch('zebra', 10)).toEqual([]);
      expect(store.keywordSearch('', 10)).toEqual([]);
      expect(store.keywordSearch('   ', 10)).toEqual([]);
    });
    it('does not throw on FTS operator syntax in the query', () => {
      store.upsertMessage(meta('m1'), [{ text: 'quarterly numbers', vector: [1, 0] }]);
      expect(() => store.keywordSearch('numbers AND (NOT "', 10)).not.toThrow();
      expect(store.keywordSearch('numbers AND (NOT "', 10).length).toBe(1);
    });
    it('drops removed messages from keyword results', () => {
      store.upsertMessage(meta('m1'), [{ text: 'invoice attached', vector: [1, 0] }]);
      store.removeMessage('m1');
      expect(store.keywordSearch('invoice', 10)).toEqual([]);
    });
    it('re-upsert replaces old keyword entries', () => {
      store.upsertMessage(meta('m1', 'h1'), [{ text: 'old invoice text', vector: [1, 0] }]);
      store.upsertMessage(meta('m1', 'h2'), [{ text: 'new receipt text', vector: [0, 1] }]);
      expect(store.keywordSearch('invoice', 10)).toEqual([]);
      expect(store.keywordSearch('receipt', 10).length).toBe(1);
    });
    it('clear() empties the keyword index', () => {
      store.upsertMessage(meta('m1'), [{ text: 'invoice attached', vector: [1, 0] }]);
      store.clear();
      expect(store.keywordSearch('invoice', 10)).toEqual([]);
    });
    it('backfills the keyword index when opening a pre-FTS database', () => {
      // Simulate a database created by the previous release: chunks exist, no FTS table.
      const Sqlite3 = require('better-sqlite3');
      const oldPath = path.join(dir, 'old.db');
      const raw = new Sqlite3(oldPath);
      raw.exec(`
        CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, messageId TEXT, threadId TEXT, accountId TEXT, date TEXT, sender TEXT, subject TEXT, chunkText TEXT, embedding BLOB, dim INTEGER);
        CREATE INDEX idx_chunks_msg ON chunks(messageId);
        CREATE TABLE indexed_messages (messageId TEXT PRIMARY KEY, contentHash TEXT, model TEXT, dim INTEGER, indexedAt INTEGER);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      `);
      raw
        .prepare(
          'INSERT INTO chunks (messageId, threadId, accountId, date, sender, subject, chunkText, embedding, dim) VALUES (?,?,?,?,?,?,?,?,?)'
        )
        .run('mOld', 't', 'a', '2026-01-01', 'Bob', 'Re', 'legacy invoice row', Buffer.alloc(8), 2);
      raw.close();
      const upgraded = new VectorStore(oldPath);
      const hits = upgraded.keywordSearch('legacy', 10);
      upgraded.close();
      expect(hits.length).toBe(1);
      expect(hits[0].messageId).toBe('mOld');
    });
  });
});
