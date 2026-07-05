import { getEmbeddingProvider } from './embeddings/provider';
import { topK } from './similarity';
import { fuseHybrid } from './fusion';
import { VectorStore } from './vector-store';
import { RetrievedSource } from './prompts';
import { AIConfig } from './config';

// Hybrid retrieval: dense-vector similarity catches paraphrases, the BM25 keyword index
// catches exact terms small embedding models miss (names, invoice/order numbers). The two
// ranked lists are merged with reciprocal-rank fusion; vector candidates below the
// configured relevance floor are dropped rather than padding the prompt with noise.
export async function retrieve(
  query: string,
  store: VectorStore,
  k?: number
): Promise<RetrievedSource[]> {
  const limit = k ?? AIConfig.getRetrieveK();
  const all = store.allVectors();
  if (!all.length) return [];
  const [qv] = await getEmbeddingProvider().embed([query]);
  const vector = topK(
    qv,
    all.map((c) => ({ id: c.id, vector: c.vector })),
    limit
  );
  const keyword = store.keywordSearch(query, limit);
  const fused = fuseHybrid({ vector, keyword, k: limit, minScore: AIConfig.getMinScore() });
  const byId = new Map(all.map((c) => [c.id, c]));
  return fused
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
