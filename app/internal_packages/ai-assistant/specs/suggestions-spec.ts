import { getGlobalSuggestions } from '../lib/suggestions';

describe('getGlobalSuggestions', () => {
  it('leads with the daily digest on a weekday morning', () => {
    const wedMorning = new Date('2026-07-01T08:00:00'); // Wednesday
    expect(getGlobalSuggestions(wedMorning)[0]).toBe("What's new today?");
  });
  it('swaps in last-week summary on Mondays', () => {
    const monday = new Date('2026-06-29T10:00:00');
    const pills = getGlobalSuggestions(monday);
    expect(pills).toContain('Summarize last week');
    expect(pills.length).toBe(4);
  });
  it('keeps this-week summary available on Fridays', () => {
    const friday = new Date('2026-07-03T15:00:00');
    expect(getGlobalSuggestions(friday)).toContain('Summarize this week');
  });
});
