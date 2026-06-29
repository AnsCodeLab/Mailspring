import path from 'path';
import os from 'os';
import fs from 'fs';
import { reconcile, needsModelReindex } from '../lib/indexer';
import { VectorStore } from '../lib/vector-store';

describe('reconcile', () => {
  it('marks indexed messages no longer in the mail DB for removal', () => {
    const r = reconcile(new Set(['a', 'b']), new Set(['b', 'c', 'd']));
    expect(r.toRemove.sort()).toEqual(['c', 'd']);
  });
});
describe('needsModelReindex', () => {
  it('true when the store model differs or is unset', () => {
    expect(needsModelReindex(undefined, 'm')).toBe(true);
    expect(needsModelReindex('old', 'new')).toBe(true);
    expect(needsModelReindex('m', 'm')).toBe(false);
  });
});
describe('indexer idempotency via store', () => {
  let dir: string;
  let store: VectorStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ix-'));
    store = new VectorStore(path.join(dir, 'i.db'));
  });
  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('skips re-indexing an unchanged message', () => {
    const meta = {
      messageId: 'm1',
      threadId: 't',
      accountId: 'a',
      date: 'd',
      sender: 's',
      subject: 'x',
      contentHash: 'h1',
      model: 'm',
      dim: 2,
    };
    store.upsertMessage(meta, [{ text: 'x', vector: [1, 0] }]);
    expect(store.isIndexed('m1', 'h1')).toBe(true); // unchanged -> indexer would no-op
    expect(store.isIndexed('m1', 'h2')).toBe(false); // changed -> indexer would re-embed
  });
});
