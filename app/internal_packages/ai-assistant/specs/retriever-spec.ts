import path from 'path';
import os from 'os';
import fs from 'fs';
import { VectorStore } from '../lib/vector-store';
import { retrieve } from '../lib/retriever';
import * as providerModule from '../lib/embeddings/provider';

describe('retrieve (hybrid)', () => {
  let dir: string;
  let store: VectorStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rt-'));
    store = new VectorStore(path.join(dir, 'i.db'));
    // The query always embeds to [1, 0]; chunk vectors are chosen per-test so cosine
    // similarity is exactly 1 (same direction) or 0 (orthogonal).
    spyOn(providerModule, 'getEmbeddingProvider').andReturn({
      id: () => 'test',
      ready: async () => {},
      embed: async (texts: string[]) => texts.map(() => [1, 0]),
    });
  });
  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const meta = (id: string) => ({
    messageId: id,
    threadId: 't' + id,
    accountId: 'a',
    date: '2026-01-01',
    sender: 'Bob',
    subject: 'Re: ' + id,
    contentHash: 'h',
    model: 'test',
    dim: 2,
  });

  it('returns semantically similar chunks', async () => {
    store.upsertMessage(meta('m1'), [{ text: 'renewal quote for the contract', vector: [1, 0] }]);
    const out = await retrieve('what did the quote say', store, 5);
    expect(out.length).toBe(1);
    expect(out[0].messageId).toBe('m1');
    expect(out[0].text).toBe('renewal quote for the contract');
  });

  it('drops chunks below the relevance threshold', async () => {
    store.upsertMessage(meta('m1'), [{ text: 'renewal quote for the contract', vector: [1, 0] }]);
    store.upsertMessage(meta('m2'), [{ text: 'unrelated newsletter blurb', vector: [0, 1] }]);
    const out = await retrieve('what did the quote say', store, 5);
    expect(out.map((s) => s.messageId)).toEqual(['m1']);
  });

  it('finds exact-term matches the embeddings miss', async () => {
    // Orthogonal vector = cosine 0, below the 0.25 default floor. Only the keyword
    // index can surface this chunk.
    store.upsertMessage(meta('m1'), [
      { text: 'your invoice INV-4421 is attached', vector: [0, 1] },
    ]);
    const out = await retrieve('INV-4421', store, 5);
    expect(out.length).toBe(1);
    expect(out[0].messageId).toBe('m1');
  });

  it('returns empty when nothing is relevant', async () => {
    store.upsertMessage(meta('m1'), [{ text: 'unrelated newsletter blurb', vector: [0, 1] }]);
    const out = await retrieve('quarterly forecast numbers', store, 5);
    expect(out).toEqual([]);
  });

  it('assigns sequential display ids for citations', async () => {
    store.upsertMessage(meta('m1'), [{ text: 'quote alpha', vector: [1, 0] }]);
    store.upsertMessage(meta('m2'), [{ text: 'quote beta', vector: [0.9, 0.1] }]);
    const out = await retrieve('quote', store, 5);
    expect(out.map((s) => s.id)).toEqual(['1', '2']);
  });
});
