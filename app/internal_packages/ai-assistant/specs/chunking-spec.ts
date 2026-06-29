import { htmlToText, chunkText, contentHash } from '../lib/chunking';

describe('htmlToText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>\n<p>bye</p>')).toBe('Hello world bye');
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
});
describe('contentHash', () => {
  it('is stable and differs on change', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
});
