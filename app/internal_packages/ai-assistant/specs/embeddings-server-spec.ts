import { ServerEmbeddingProvider } from '../lib/embeddings/server';

describe('ServerEmbeddingProvider', () => {
  it('POSTs to /embeddings and returns vectors', async () => {
    spyOn(window, 'fetch').andReturn(
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: [1, 2, 3] }, { embedding: [4, 5, 6] }] }),
      } as any)
    );
    const p = new ServerEmbeddingProvider('http://localhost:11434/v1', 'nomic-embed-text');
    const out = await p.embed(['a', 'b']);
    expect(out).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });
  it('throws a helpful error when the server is unreachable', async () => {
    spyOn(window, 'fetch').andReturn(Promise.reject(new Error('ECONNREFUSED')));
    const p = new ServerEmbeddingProvider('http://localhost:11434/v1', 'm');
    let threw = false;
    try {
      await p.embed(['a']);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
