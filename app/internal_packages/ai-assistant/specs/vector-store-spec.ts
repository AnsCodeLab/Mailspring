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
});
