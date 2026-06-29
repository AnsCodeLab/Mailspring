import { RetrievedSource } from './prompts';

export function extractCitedIds(answer: string): number[] {
  const ids = new Set<number>();
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(answer))) ids.add(parseInt(m[1], 10));
  return Array.from(ids).sort((a, b) => a - b);
}

export function validateCitations(
  answer: string,
  sources: RetrievedSource[]
): { citedSources: RetrievedSource[]; invalid: number[] } {
  const cited = extractCitedIds(answer);
  const byId = new Map(sources.map((s) => [parseInt(s.id, 10), s]));
  const citedSources: RetrievedSource[] = [];
  const invalid: number[] = [];
  for (const n of cited) {
    const s = byId.get(n);
    if (s) citedSources.push(s);
    else invalid.push(n);
  }
  return { citedSources, invalid };
}
