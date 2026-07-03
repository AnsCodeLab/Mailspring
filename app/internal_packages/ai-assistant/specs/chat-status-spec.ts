import { statusForPhase, stopHighlighted } from '../lib/chat-status';

describe('statusForPhase', () => {
  it('shows retrieving text during retrieval', () => {
    expect(statusForPhase('retrieving', 2)).toContain('Retrieving context');
  });
  it('shows waiting without elapsed under 10s', () => {
    expect(statusForPhase('waiting', 5)).toBe('Waiting for the model…');
  });
  it('adds elapsed seconds from 10s', () => {
    expect(statusForPhase('waiting', 12)).toContain('(12s)');
  });
  it('softens to a reassurance after 30s and never suggests cancel', () => {
    const s = statusForPhase('waiting', 45);
    expect(s).toContain('Still waiting');
    expect(s).toContain('(45s)');
  });
  it('returns null while streaming and when idle', () => {
    expect(statusForPhase('streaming', 60)).toBeNull();
    expect(statusForPhase('idle', 0)).toBeNull();
  });
});

describe('stopHighlighted', () => {
  it('highlights Stop only in waiting phase after 30s', () => {
    expect(stopHighlighted('waiting', 31)).toBe(true);
    expect(stopHighlighted('waiting', 29)).toBe(false);
    expect(stopHighlighted('streaming', 90)).toBe(false);
  });
});
