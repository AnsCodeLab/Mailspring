import { parseSSEChunk, extractDelta } from '../lib/sse';

describe('parseSSEChunk', () => {
  it('splits complete events and keeps the trailing partial', () => {
    const { events, rest } = parseSSEChunk('data: a\n\ndata: b\n\ndata: par');
    expect(events).toEqual(['data: a', 'data: b']);
    expect(rest).toBe('data: par');
  });
  it('returns no events when nothing is complete', () => {
    expect(parseSSEChunk('data: partial')).toEqual({ events: [], rest: 'data: partial' });
  });
});

describe('extractDelta', () => {
  it('pulls the content delta out of an OpenAI chunk', () => {
    expect(extractDelta('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] }))).toBe('Hi');
  });
  it('returns null for the [DONE] sentinel', () => {
    expect(extractDelta('data: [DONE]')).toBeNull();
  });
  it('returns null for a role-only / empty delta', () => {
    expect(extractDelta('data: ' + JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }))).toBeNull();
  });
});
