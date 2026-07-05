import { fuseHybrid } from '../lib/fusion';

describe('fuseHybrid', () => {
  it('ranks an item found by both retrievers above single-list items', () => {
    const fused = fuseHybrid({
      vector: [
        { id: 'a', score: 0.9 },
        { id: 'b', score: 0.8 },
      ],
      keyword: [{ id: 'b' }, { id: 'c' }],
      k: 10,
    });
    expect(fused[0].id).toBe('b');
    expect(fused.map((f) => f.id)).toEqual(['b', 'a', 'c']);
  });
  it('filters vector candidates below minScore', () => {
    const fused = fuseHybrid({
      vector: [
        { id: 'a', score: 0.9 },
        { id: 'b', score: 0.1 },
      ],
      keyword: [],
      k: 10,
      minScore: 0.25,
    });
    expect(fused.map((f) => f.id)).toEqual(['a']);
  });
  it('keeps keyword matches even when every vector score is below the threshold', () => {
    const fused = fuseHybrid({
      vector: [{ id: 'a', score: 0.05 }],
      keyword: [{ id: 'k1' }],
      k: 10,
      minScore: 0.25,
    });
    expect(fused.map((f) => f.id)).toEqual(['k1']);
  });
  it('returns empty when nothing passes', () => {
    expect(
      fuseHybrid({ vector: [{ id: 'a', score: 0.1 }], keyword: [], k: 5, minScore: 0.25 })
    ).toEqual([]);
    expect(fuseHybrid({ vector: [], keyword: [], k: 5 })).toEqual([]);
  });
  it('limits results to k', () => {
    const vector = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, score: 0.9 - i * 0.1 }));
    expect(fuseHybrid({ vector, keyword: [], k: 2 }).length).toBe(2);
  });
  it('preserves the original order for a single list', () => {
    const vector = [
      { id: 'first', score: 0.9 },
      { id: 'second', score: 0.7 },
      { id: 'third', score: 0.5 },
    ];
    expect(fuseHybrid({ vector, keyword: [], k: 10 }).map((f) => f.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});
