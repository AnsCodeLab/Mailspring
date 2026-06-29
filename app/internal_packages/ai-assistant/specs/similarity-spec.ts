import { cosine, topK, vectorToBuffer, bufferToVector } from '../lib/similarity';

describe('cosine', () => {
  it('is 1 for identical vectors', () => expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 6));
  it('is 0 for orthogonal vectors', () => expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6));
});
describe('topK', () => {
  it('ranks by similarity', () => {
    const items = [
      { id: 'a', vector: new Float32Array([1, 0]) },
      { id: 'b', vector: new Float32Array([0, 1]) },
      { id: 'c', vector: new Float32Array([0.9, 0.1]) },
    ];
    const r = topK([1, 0], items, 2).map((x) => x.id);
    expect(r).toEqual(['a', 'c']);
  });
});
describe('buffer round-trip', () => {
  it('preserves values', () => {
    const v = bufferToVector(vectorToBuffer([0.5, -0.25, 1]));
    expect(Array.from(v)).toEqual([0.5, -0.25, 1]);
  });
});
