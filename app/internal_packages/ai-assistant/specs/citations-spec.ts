import { extractCitedIds, validateCitations } from '../lib/citations';

const s = (id: string) => ({
  id,
  messageId: 'm',
  threadId: 't',
  sender: 'B',
  subject: 'x',
  date: 'd',
  text: '',
});

describe('extractCitedIds', () => {
  it('parses bracketed numbers, unique + sorted', () => {
    expect(extractCitedIds('See [2] and [1], also [2].')).toEqual([1, 2]);
  });
});
describe('validateCitations', () => {
  it('keeps cited sources that exist and reports invalid markers', () => {
    const { citedSources, invalid } = validateCitations('per [1] and [3]', [s('1'), s('2')]);
    expect(citedSources.map((x) => x.id)).toEqual(['1']);
    expect(invalid).toEqual([3]);
  });
});
