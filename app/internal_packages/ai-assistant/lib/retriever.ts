import { getEmbeddingProvider } from './embeddings/provider';
import { topK } from './similarity';
import { VectorStore } from './vector-store';
import { RetrievedSource } from './prompts';

export async function retrieve(
  query: string,
  store: VectorStore,
  k = 6
): Promise<RetrievedSource[]> {
  const all = store.allVectors();
  if (!all.length) return [];
  const [qv] = await getEmbeddingProvider().embed([query]);
  const ranked = topK(
    qv,
    all.map((c) => ({ id: c.id, vector: c.vector })),
    k
  );
  const byId = new Map(all.map((c) => [c.id, c]));
  return ranked
    .map((r, i) => {
      const c = byId.get(r.id);
      if (!c) return undefined;
      return {
        id: String(i + 1),
        messageId: c.messageId,
        threadId: c.threadId,
        sender: c.sender,
        subject: c.subject,
        date: c.date,
        text: c.chunkText,
      };
    })
    .filter((x) => x !== undefined) as RetrievedSource[];
}
