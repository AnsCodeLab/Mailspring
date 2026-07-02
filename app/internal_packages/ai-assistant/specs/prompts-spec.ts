import { buildChatPrompt, buildRewritePrompt, GROUNDED_SYSTEM } from '../lib/prompts';

const src = (id: string, text: string) => ({
  id,
  messageId: 'm' + id,
  threadId: 't' + id,
  sender: 'Bob',
  subject: 'Re: x',
  date: '2026-01-01',
  text,
});

describe('buildChatPrompt', () => {
  it('starts with the grounded system prompt', () => {
    const msgs = buildChatPrompt({
      question: 'hi',
      threadMessages: [],
      history: [],
      pinned: [],
      retrieved: [],
    });
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain(GROUNDED_SYSTEM.slice(0, 20));
  });
  it('labels retrieved sources with ids the model can cite', () => {
    const msgs = buildChatPrompt({
      question: 'q',
      threadMessages: [],
      history: [],
      pinned: [],
      retrieved: [src('1', 'hello world')],
    });
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('[1]');
    expect(joined).toContain('hello world');
  });
  it('puts the question last as a user turn', () => {
    const msgs = buildChatPrompt({
      question: 'the question',
      threadMessages: [],
      history: [],
      pinned: [],
      retrieved: [],
    });
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'the question' });
  });
  it('trims context to the char budget', () => {
    const big = src('1', 'x'.repeat(10000));
    const msgs = buildChatPrompt({
      question: 'q',
      threadMessages: [],
      history: [],
      pinned: [],
      retrieved: [big],
      budgetChars: 500,
    });
    expect(msgs.map((m) => m.content).join('').length).toBeLessThan(4000);
  });
  it('bounds total size even with long history', () => {
    const history = Array.from({ length: 50 }, () => ({
      role: 'user' as const,
      content: 'x'.repeat(500),
    }));
    const msgs = buildChatPrompt({
      question: 'q',
      threadMessages: [],
      history,
      pinned: [],
      retrieved: [],
      budgetChars: 2000,
    });
    expect(msgs.map((m) => m.content).join('').length).toBeLessThan(4000);
  });
});

describe('buildRewritePrompt', () => {
  it('includes the text and the style instruction', () => {
    const msgs = buildRewritePrompt({ text: 'Dear sir', style: 'shorter' });
    const joined = msgs
      .map((m) => m.content)
      .join('\n')
      .toLowerCase();
    expect(joined).toContain('dear sir');
    expect(joined).toContain('shorter');
  });
});
