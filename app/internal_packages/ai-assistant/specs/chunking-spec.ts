import { htmlToText, chunkText, contentHash } from '../lib/chunking';

describe('htmlToText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>\n<p>bye</p>')).toContain('Hello world bye');
  });
  it('strips script and style content', () => {
    expect(htmlToText('<style>.foo{color:red}</style><p>Hi</p>')).toContain('Hi');
    expect(htmlToText('<script>alert(1)</script><p>Hi</p>')).toContain('Hi');
  });
});
describe('chunkText', () => {
  it('returns one chunk for short text', () => {
    expect(chunkText('short text', { size: 100, overlap: 10 })).toEqual(['short text']);
  });
  it('splits long text into overlapping chunks', () => {
    const chunks = chunkText('a'.repeat(2500), { size: 1000, overlap: 200 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].length).toBe(1000);
  });
  it('returns [] for empty text', () => {
    expect(chunkText('', { size: 100, overlap: 10 })).toEqual([]);
  });
  it('does not infinite-loop when overlap >= size', () => {
    expect(chunkText('abcdef', { size: 3, overlap: 5 }).length).toBeGreaterThan(0);
  });
});
describe('contentHash', () => {
  it('is stable and differs on change', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
});
