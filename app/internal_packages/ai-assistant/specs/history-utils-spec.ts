import { dedupeTitles, groupByDate, HistoryItem } from '../lib/history-utils';

const item = (over: Partial<HistoryItem>): HistoryItem => ({
  sessionId: Math.random().toString(36),
  subject: 'Draft a reply',
  preview: '',
  lastAt: Date.parse('2026-07-03T10:00:00'),
  count: 2,
  ...over,
});

describe('dedupeTitles', () => {
  it('appends the date to repeated titles only', () => {
    const items = [
      item({ subject: 'Draft a reply', lastAt: Date.parse('2026-07-02T10:00:00') }),
      item({ subject: 'Draft a reply', lastAt: Date.parse('2026-07-01T10:00:00') }),
      item({ subject: 'Unique title' }),
    ];
    const out = dedupeTitles(items);
    expect(out[0].subject).toContain('·');
    expect(out[1].subject).toContain('·');
    expect(out[2].subject).toBe('Unique title');
  });
});

describe('groupByDate', () => {
  it('buckets into Today, This week, Older and omits empty groups', () => {
    const now = new Date('2026-07-03T12:00:00');
    const items = [
      item({ lastAt: Date.parse('2026-07-03T08:00:00') }), // today
      item({ lastAt: Date.parse('2026-06-30T08:00:00') }), // this week
      item({ lastAt: Date.parse('2026-05-01T08:00:00') }), // older
    ];
    const groups = groupByDate(items, now);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'This week', 'Older']);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
    const onlyOld = groupByDate([items[2]], now);
    expect(onlyOld.map((g) => g.label)).toEqual(['Older']);
  });
});
