// PURE reciprocal-rank fusion of the two retrieval lists (dense vector + BM25 keyword).
// RRF only looks at ranks, so the incomparable score scales (cosine vs BM25) never mix.

const RRF_C = 60;

export function fuseHybrid(args: {
  vector: Array<{ id: string; score: number }>;
  keyword: Array<{ id: string }>;
  k: number;
  minScore?: number;
  c?: number;
}): Array<{ id: string; score: number }> {
  const c = args.c ?? RRF_C;
  const minScore = args.minScore ?? 0;
  // The relevance floor applies to the vector list only: a low cosine score means "probably
  // unrelated", while any BM25 hit is an exact-term match and stays in.
  const lists = [args.vector.filter((v) => v.score >= minScore), args.keyword];
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (c + rank + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, args.k);
}
