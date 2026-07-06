import {
  sanitizeFilename,
  buildThreadMarkdown,
  buildSingleMessageMarkdown,
} from '../internal_packages/export-to-markdown/lib/export-utils';
import * as ExportUtils from '../internal_packages/export-to-markdown/lib/export-utils';
import MessageControls from '../internal_packages/message-list/lib/message-controls';

// Minimal Message stub — only fields used by the markdown builders
function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    subject: 'Test Subject',
    body: '<p>Hello world</p>',
    snippet: 'Hello world',
    date: new Date('2026-06-15T14:32:00Z'),
    from: [{ name: 'Alice', email: 'alice@example.com' }],
    to: [{ name: 'Bob', email: 'bob@example.com' }],
    cc: [],
    files: [],
    ...overrides,
  } as any;
}

function makeThread(subject = 'Thread Subject') {
  return { id: 'thread-1', subject } as any;
}

describe('sanitizeFilename', () => {
  it('replaces invalid characters with underscores', () => {
    expect(sanitizeFilename('Hello: World / Test')).toBe('Hello_ World _ Test');
  });

  it('replaces all invalid chars including \\, *, ?, <, >, |', () => {
    expect(sanitizeFilename('a\\b*c?d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h');
  });

  it('truncates to 100 characters', () => {
    expect(sanitizeFilename('a'.repeat(150)).length).toBe(100);
  });

  it('returns "email" for empty string', () => {
    expect(sanitizeFilename('')).toBe('email');
  });

  it('returns "email" for whitespace-only string', () => {
    expect(sanitizeFilename('   ')).toBe('email');
  });

  it('returns "email" for null', () => {
    expect(sanitizeFilename(null as any)).toBe('email');
  });

  it('preserves safe characters', () => {
    expect(sanitizeFilename('Meeting notes 2026-06-15')).toBe('Meeting notes 2026-06-15');
  });
});

describe('buildThreadMarkdown', () => {
  beforeEach(() => {
    // Mock QuotedHTMLTransformer to pass through body unchanged
    const { QuotedHTMLTransformer } = require('mailspring-exports');
    spyOn(QuotedHTMLTransformer, 'removeQuotedHTML').andCallFake((html: string) => html);

    // Mock AttachmentStore so no file reads occur
    const { AttachmentStore } = require('mailspring-exports');
    spyOn(AttachmentStore, 'pathForFile').andReturn(null);
  });

  it('returns empty string when messages array is empty', () => {
    expect(buildThreadMarkdown(makeThread(), [])).toBe('');
  });

  it('starts with # Subject heading', () => {
    const result = buildThreadMarkdown(makeThread('My Thread'), [makeMessage()]);
    expect(result.startsWith('# My Thread')).toBe(true);
  });

  it('includes From header for each message', () => {
    const result = buildThreadMarkdown(makeThread(), [
      makeMessage({ from: [{ name: 'Alice', email: 'alice@example.com' }] }),
    ]);
    expect(result).toContain('## From: Alice <alice@example.com>');
  });

  it('omits CC line when cc is empty', () => {
    const result = buildThreadMarkdown(makeThread(), [makeMessage({ cc: [] })]);
    expect(result).not.toContain('**CC:**');
  });

  it('includes CC line when cc is populated', () => {
    const result = buildThreadMarkdown(makeThread(), [
      makeMessage({ cc: [{ name: 'Carol', email: 'carol@example.com' }] }),
    ]);
    expect(result).toContain('**CC:** Carol <carol@example.com>');
  });

  it('sorts messages oldest-first', () => {
    const older = makeMessage({
      id: 'old',
      date: new Date('2026-01-01'),
      from: [{ name: 'OldSender', email: 'old@example.com' }],
    });
    const newer = makeMessage({
      id: 'new',
      date: new Date('2026-06-01'),
      from: [{ name: 'NewSender', email: 'new@example.com' }],
    });
    const result = buildThreadMarkdown(makeThread(), [newer, older]);
    expect(result.indexOf('OldSender')).toBeLessThan(result.indexOf('NewSender'));
  });

  it('separates messages with ---', () => {
    const msgs = [makeMessage({ id: 'a' }), makeMessage({ id: 'b' })];
    const result = buildThreadMarkdown(makeThread(), msgs);
    // Header --- plus separator between messages
    const separatorCount = (result.match(/\n---\n/g) || []).length;
    expect(separatorCount).toBeGreaterThan(1);
  });
});

describe('buildSingleMessageMarkdown', () => {
  beforeEach(() => {
    const { QuotedHTMLTransformer } = require('mailspring-exports');
    spyOn(QuotedHTMLTransformer, 'removeQuotedHTML').andCallFake((html: string) => html);
    const { AttachmentStore } = require('mailspring-exports');
    spyOn(AttachmentStore, 'pathForFile').andReturn(null);
  });

  it('starts with # Subject heading', () => {
    const result = buildSingleMessageMarkdown(makeMessage({ subject: 'My Email' }));
    expect(result.startsWith('# My Email')).toBe(true);
  });

  it('includes the From header', () => {
    const result = buildSingleMessageMarkdown(makeMessage());
    expect(result).toContain('## From: Alice <alice@example.com>');
  });

  it('uses "Email" when subject is empty', () => {
    const result = buildSingleMessageMarkdown(makeMessage({ subject: '' }));
    expect(result.startsWith('# Email')).toBe(true);
  });
});

describe('MessageControls "Export as Markdown" dropdown item', () => {
  beforeEach(() => {
    spyOn(AppEnv.config, 'get').andReturn(undefined);
  });

  function makeControls(overrides: { thread?: any; message?: any } = {}) {
    return new MessageControls({
      thread: overrides.thread || makeThread(),
      message: overrides.message || { ...makeMessage(), canReplyAll: () => true },
    } as any);
  }

  it('includes an Export as Markdown entry in the reply-caret dropdown', () => {
    const items = makeControls()._items();
    expect(items.map((i) => i.name)).toContain('Export as Markdown');
  });

  it('exports only the open message (not the whole thread) when selected', async () => {
    spyOn(ExportUtils, 'buildSingleMessageMarkdown').andReturn('# md content');
    spyOn(ExportUtils, 'saveMarkdownFile').andCallFake(async () => {});
    spyOn(ExportUtils, 'fetchThreadMessages');

    const thread = makeThread('Some Thread');
    const message = { ...makeMessage({ subject: 'Just this message' }), canReplyAll: () => true };
    const items = makeControls({ thread, message })._items();
    const exportItem = items.find((i) => i.name === 'Export as Markdown');

    await exportItem.select();

    expect(ExportUtils.buildSingleMessageMarkdown).toHaveBeenCalledWith(message);
    expect(ExportUtils.saveMarkdownFile).toHaveBeenCalledWith('# md content', message.subject);
    expect(ExportUtils.fetchThreadMessages).not.toHaveBeenCalled();
  });

  it('loads the message body first when it is not already present', async () => {
    const { DatabaseStore, Message } = require('mailspring-exports');
    const loadedMessage = { ...makeMessage({ id: 'msg-2' }), canReplyAll: () => true };
    const chain: any = { include: () => Promise.resolve(loadedMessage) };
    spyOn(DatabaseStore, 'find').andReturn(chain);
    spyOn(ExportUtils, 'buildSingleMessageMarkdown').andReturn('# md content');
    spyOn(ExportUtils, 'saveMarkdownFile').andCallFake(async () => {});

    const bodylessMessage = {
      ...makeMessage({ id: 'msg-2', body: undefined }),
      canReplyAll: () => true,
    };
    const items = makeControls({ message: bodylessMessage })._items();
    const exportItem = items.find((i) => i.name === 'Export as Markdown');

    await exportItem.select();

    expect(DatabaseStore.find).toHaveBeenCalledWith(Message, 'msg-2');
    expect(ExportUtils.buildSingleMessageMarkdown).toHaveBeenCalledWith(loadedMessage);
  });
});
