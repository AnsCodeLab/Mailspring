export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export function topK(
  query: number[],
  items: Array<{ id: string; vector: Float32Array }>,
  k: number
): Array<{ id: string; score: number }> {
  return items
    .map((it) => ({ id: it.id, score: cosine(query, it.vector) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}

export function vectorToBuffer(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}
export function bufferToVector(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
