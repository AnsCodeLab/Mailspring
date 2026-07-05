import {
  buildChatPrompt,
  buildRewritePrompt,
  buildReplyPrompt,
  GROUNDED_SYSTEM,
} from '../lib/prompts';

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
      retrieved: [],
      budgetChars: 2000,
    });
    expect(msgs.map((m) => m.content).join('').length).toBeLessThan(4000);
  });
});

describe('buildChatPrompt knowledge-base miss note', () => {
  it('notes that the knowledge base had no relevant sources when searched and empty', () => {
    const msgs = buildChatPrompt({
      question: 'q',
      threadMessages: [],
      history: [],
      retrieved: [],
      kbSearched: true,
    });
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('found no relevant sources');
  });
  it('adds no note when sources were retrieved', () => {
    const msgs = buildChatPrompt({
      question: 'q',
      threadMessages: [],
      history: [],
      retrieved: [src('1', 'hello world')],
      kbSearched: true,
    });
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).not.toContain('found no relevant sources');
  });
  it('adds no note when the knowledge base was not searched', () => {
    const msgs = buildChatPrompt({
      question: 'q',
      threadMessages: [],
      history: [],
      retrieved: [],
    });
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).not.toContain('found no relevant sources');
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

  it('tells the model who the sender is when provided', () => {
    const msgs = buildRewritePrompt({
      text: 'Dear sir',
      style: 'shorter',
      sender: { name: 'Jane Doe', email: 'jane@example.com' },
    });
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('Jane Doe');
    expect(joined).toContain('jane@example.com');
  });

  it('omits sender identity when none is provided', () => {
    const msgs = buildRewritePrompt({ text: 'Dear sir', style: 'shorter' });
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).not.toContain('writing as the email account owner');
  });
});

describe('buildReplyPrompt', () => {
  it('tells the model who the sender is when provided', () => {
    const msgs = buildReplyPrompt({
      threadMessages: [{ from: 'Bob', date: '2026-01-01', text: 'Hi' }],
      instruction: '',
      sender: { name: 'Jane Doe', email: 'jane@example.com' },
    });
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('Jane Doe');
    expect(joined).toContain('jane@example.com');
  });
});

describe('buildChatPrompt sender identity', () => {
  it('includes the sender in the system prompt when provided', () => {
    const msgs = buildChatPrompt({
      question: 'hi',
      threadMessages: [],
      history: [],
      retrieved: [],
      sender: { name: 'Jane Doe', email: 'jane@example.com' },
    });
    expect(msgs[0].content).toContain('Jane Doe <jane@example.com>');
  });
});
