// Skills integration spec — runs in the Electron test harness.
// require('mailspring-exports') and require('@electron/remote') are the real modules;
// we spy on their methods so skills never touch the real DB, sync engine, or OS dialogs.

import { fetchUrlSkill } from '../lib/skills/builtin/fetch-url';
import { webSearchSkill } from '../lib/skills/builtin/web-search';
import { sendEmailSkill } from '../lib/skills/builtin/send-email';
import { trashThreadSkill, archiveThreadSkill } from '../lib/skills/builtin/manage-thread';
import { createDraftSkill } from '../lib/skills/builtin/create-draft';
import { openEmailSkill } from '../lib/skills/builtin/open-email';
import { kbSearchSkill } from '../lib/skills/builtin/kb-search';
import { mailboxSearchSkill } from '../lib/skills/builtin/mailbox-search';

// ─── helpers ────────────────────────────────────────────────────────────────

function fakeConfig(overrides: Record<string, any> = {}) {
  spyOn(AppEnv.config, 'get').andCallFake((key: string) => overrides[key] ?? undefined);
}

function fakeExports(overrides: Record<string, any> = {}) {
  const ms = require('mailspring-exports');
  const fakeDraft = { headerMessageId: 'hdr-1', body: '', subject: '', to: [], cc: [] };
  const defaults = {
    DraftFactory: {
      createDraft: jasmine.createSpy('createDraft').andReturn(Promise.resolve(fakeDraft)),
      createDraftForReply: jasmine.createSpy('createDraftForReply').andReturn(Promise.resolve(fakeDraft)),
    },
    SanitizeTransformer: {
      runSync: jasmine.createSpy('runSync').andCallFake((h: string) => h),
    },
    Actions: {
      sendDraft: jasmine.createSpy('sendDraft'),
      composePopoutDraft: jasmine.createSpy('composePopoutDraft'),
      queueTasks: jasmine.createSpy('queueTasks'),
      setFocus: jasmine.createSpy('setFocus'),
    },
    TaskFactory: {
      tasksForMovingToTrash: jasmine.createSpy('tasksForMovingToTrash').andReturn([{}]),
      tasksForArchiving: jasmine.createSpy('tasksForArchiving').andReturn([{}]),
    },
    DatabaseStore: {
      // Supports both direct await and .include() chaining (open_email)
      find: jasmine.createSpy('find').andCallFake(() => {
        const val = { id: 'm1', subject: 'Re: Test', threadId: 't1', from: [{ email: 'a@b.com', name: 'A' }], date: new Date(), body: '' };
        const chain: any = {
          include: function () { return this; },
          then: function (res: any, rej?: any) { return Promise.resolve(val).then(res, rej); },
          catch: function (rej: any) { return Promise.resolve(val).catch(rej); },
        };
        return chain;
      }),
      findAll: jasmine.createSpy('findAll').andReturn({
        where: function () { return this; },
        limit: function () { return this; },
        then: (resolve: any) => resolve([{ id: 'm1', subject: 'Test', threadId: 't1', from: [{ email: 'a@b.com', name: 'A' }], date: new Date(), snippet: 'hi' }]),
      }),
    },
    Thread: class Thread {},
    FocusedContentStore: {
      focused: jasmine.createSpy('focused').andReturn({ id: 't1' }),
    },
  };
  // Spy on each top-level property method
  Object.entries({ ...defaults, ...overrides }).forEach(([group, methods]: [string, any]) => {
    if (typeof methods === 'object' && methods !== null) {
      Object.entries(methods).forEach(([method, impl]) => {
        if (ms[group] && typeof ms[group][method] !== 'undefined') {
          spyOn(ms[group], method).andCallFake(
            typeof impl === 'function' ? impl : () => (impl as any)
          );
        }
      });
    }
  });
  return { ms, fakeDraft };
}

function fakeDialog(response: number) {
  const remote = require('@electron/remote');
  spyOn(remote.dialog, 'showMessageBox').andReturn(Promise.resolve({ response }));
  return remote;
}

// ─── fetch_url ───────────────────────────────────────────────────────────────

describe('fetchUrlSkill', () => {
  it('is a read-tier skill', () => {
    expect(fetchUrlSkill.tier).toBe('read');
  });

  it('rejects SSRF targets and returns an error', async () => {
    const result = await fetchUrlSkill.run({ url: 'http://localhost/secret' }, {});
    expect(result.error).toBeTruthy();
  });

  it('rejects private-range IPs', async () => {
    const result = await fetchUrlSkill.run({ url: 'http://192.168.1.1/data' }, {});
    expect(result.error).toBeTruthy();
  });

  it('fetches a public URL and returns text', async () => {
    spyOn(window, 'fetch').andReturn(
      Promise.resolve({ ok: true, text: () => Promise.resolve('<h1>Hello</h1>') } as any)
    );
    const result = await fetchUrlSkill.run({ url: 'https://example.com' }, {});
    expect(result.content).toContain('Hello');
  });

  it('returns an error when fetch fails', async () => {
    spyOn(window, 'fetch').andReturn(Promise.reject(new Error('ECONNREFUSED')));
    const result = await fetchUrlSkill.run({ url: 'https://example.com' }, {});
    expect(result.error).toBeTruthy();
  });
});

// ─── web_search ──────────────────────────────────────────────────────────────

describe('webSearchSkill', () => {
  it('is a read-tier skill', () => {
    expect(webSearchSkill.tier).toBe('read');
  });

  it('is disabled when web search is off in config', () => {
    fakeConfig({ 'ai-assistant.webSearch.enabled': false });
    expect(webSearchSkill.enabled!()).toBe(false);
  });

  it('is disabled when no URL is configured', () => {
    fakeConfig({ 'ai-assistant.webSearch.enabled': true, 'ai-assistant.webSearch.url': '' });
    expect(webSearchSkill.enabled!()).toBe(false);
  });

  it('calls SearXNG and returns results', async () => {
    fakeConfig({
      'ai-assistant.webSearch.enabled': true,
      'ai-assistant.webSearch.url': 'http://searx.example.com',
      'ai-assistant.webSearch.results': 3,
    });
    spyOn(window, 'fetch').andReturn(
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              { title: 'T1', url: 'https://a.com', content: 'Snippet 1' },
              { title: 'T2', url: 'https://b.com', content: 'Snippet 2' },
            ],
          }),
      } as any)
    );
    const result = await webSearchSkill.run({ query: 'test query' }, {});
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[])[0].title).toBe('T1');
  });
});

// ─── mailbox_search ──────────────────────────────────────────────────────────

describe('mailboxSearchSkill', () => {
  it('is a read-tier skill', () => {
    expect(mailboxSearchSkill.tier).toBe('read');
  });

  it('returns message summaries from DatabaseStore', async () => {
    fakeExports();
    const result = await mailboxSearchSkill.run({ query: 'test' }, {});
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── open_email ──────────────────────────────────────────────────────────────

describe('openEmailSkill', () => {
  it('is a read-tier skill', () => {
    expect(openEmailSkill.tier).toBe('read');
  });

  it('loads the message by messageId and returns structured data', async () => {
    fakeExports();
    const result = await openEmailSkill.run({ messageId: 'm1' }, {});
    expect(result.messageId).toBe('m1');
    expect(result.threadId).toBe('t1');
  });

  it('throws when message is not found', async () => {
    const { ms } = fakeExports();
    (ms.DatabaseStore.find as jasmine.Spy).andCallFake(() => {
      const chain: any = {
        include: function () { return this; },
        then: function (res: any, rej?: any) { return Promise.resolve(null).then(res, rej); },
        catch: function (rej: any) { return Promise.resolve(null).catch(rej); },
      };
      return chain;
    });
    let threw = false;
    try { await openEmailSkill.run({ messageId: 'missing' }, {}); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});

// ─── create_draft ─────────────────────────────────────────────────────────────

describe('createDraftSkill', () => {
  it('is a write-reversible tier skill', () => {
    expect(createDraftSkill.tier).toBe('write-reversible');
  });

  it('creates a new draft and returns the headerMessageId', async () => {
    const { ms, fakeDraft } = fakeExports();
    const result = await createDraftSkill.run(
      { to: 'alice@example.com', subject: 'Hello', body: 'Hi there' },
      {}
    );
    expect(ms.DraftFactory.createDraft).toHaveBeenCalled();
    expect(result.headerMessageId).toBe('hdr-1');
  });

  it('calls composePopoutDraft so the user sees the draft', async () => {
    const { ms } = fakeExports();
    await createDraftSkill.run({ body: 'draft body' }, {});
    expect(ms.Actions.composePopoutDraft).toHaveBeenCalledWith('hdr-1');
  });
});

// ─── kb_search ──────────────────────────────────────────────────────────────

describe('kbSearchSkill', () => {
  it('is a read-tier skill', () => {
    expect(kbSearchSkill.tier).toBe('read');
  });

  it('is disabled when knowledge base is off', () => {
    fakeConfig({ 'ai-assistant.knowledgeBase.enabled': false });
    expect(kbSearchSkill.enabled!()).toBe(false);
  });
});

// ─── send_email ──────────────────────────────────────────────────────────────

describe('sendEmailSkill', () => {
  it('is a confirm-tier skill', () => {
    expect(sendEmailSkill.tier).toBe('confirm');
  });

  it('is disabled by default', () => {
    fakeConfig({});
    expect(sendEmailSkill.enabled!()).toBe(false);
  });

  it('is enabled when config key is true', () => {
    fakeConfig({ 'ai-assistant.skills.sendEmail': true });
    expect(sendEmailSkill.enabled!()).toBe(true);
  });

  it('confirmDialog: Cancel (button 0) returns deny without calling any API', async () => {
    fakeDialog(0);
    fakeExports();
    const result = await sendEmailSkill.confirmDialog!({
      to: 'alice@example.com',
      subject: 'Test',
      body: 'Hello',
    });
    expect(result).toBe('deny');
    const ms = require('mailspring-exports');
    expect(ms.DraftFactory.createDraft).not.toHaveBeenCalled();
    expect(ms.Actions.sendDraft).not.toHaveBeenCalled();
  });

  it('confirmDialog: Open in Composer (button 1) creates draft, opens popout, returns done', async () => {
    fakeDialog(1);
    const { ms } = fakeExports();
    const result = await sendEmailSkill.confirmDialog!({
      to: 'alice@example.com',
      subject: 'Test',
      body: 'Hello',
    });
    expect(result).toBe('done');
    expect(ms.DraftFactory.createDraft).toHaveBeenCalled();
    expect(ms.Actions.composePopoutDraft).toHaveBeenCalledWith('hdr-1');
    expect(ms.Actions.sendDraft).not.toHaveBeenCalled();
  });

  it('confirmDialog: Send Now (button 2) returns proceed without sending yet', async () => {
    fakeDialog(2);
    fakeExports();
    const result = await sendEmailSkill.confirmDialog!({
      to: 'alice@example.com',
      subject: 'Test',
      body: 'Hello',
    });
    expect(result).toBe('proceed');
    const ms = require('mailspring-exports');
    // confirmDialog only says "proceed" — run() is what actually sends
    expect(ms.Actions.sendDraft).not.toHaveBeenCalled();
  });

  it('run() creates draft and calls sendDraft', async () => {
    const { ms } = fakeExports();
    const result = await sendEmailSkill.run(
      { to: 'alice@example.com', subject: 'Test', body: 'Hello' },
      {}
    );
    expect(ms.DraftFactory.createDraft).toHaveBeenCalledWith(
      jasmine.objectContaining({ subject: 'Test' })
    );
    expect(ms.Actions.sendDraft).toHaveBeenCalledWith('hdr-1');
    expect(result.sent).toBe(true);
    expect(result.to).toBe('alice@example.com');
  });

  it('run() includes cc when provided', async () => {
    const { ms } = fakeExports();
    await sendEmailSkill.run(
      { to: 'alice@example.com', cc: 'bob@example.com', subject: 'Test', body: 'Hi' },
      {}
    );
    const callArgs = ms.DraftFactory.createDraft.mostRecentCall.args[0];
    expect(callArgs.cc).toEqual([{ email: 'bob@example.com', name: 'bob@example.com' }]);
  });
});

// ─── trash_thread ─────────────────────────────────────────────────────────────

describe('trashThreadSkill', () => {
  it('is a confirm-tier skill', () => {
    expect(trashThreadSkill.tier).toBe('confirm');
  });

  it('is disabled by default', () => {
    fakeConfig({});
    expect(trashThreadSkill.enabled!()).toBe(false);
  });

  it('is enabled when config key is true', () => {
    fakeConfig({ 'ai-assistant.skills.trashThread': true });
    expect(trashThreadSkill.enabled!()).toBe(true);
  });

  it('confirmDialog: Cancel returns deny and does not queue any task', async () => {
    fakeDialog(0);
    const { ms } = fakeExports();
    const result = await trashThreadSkill.confirmDialog!({ threadId: 't1', subject: 'Re: Test' });
    expect(result).toBe('deny');
    expect(ms.Actions.queueTasks).not.toHaveBeenCalled();
  });

  it('confirmDialog: Move to Trash queues task and returns done', async () => {
    fakeDialog(1);
    const { ms } = fakeExports();
    const result = await trashThreadSkill.confirmDialog!({ threadId: 't1', subject: 'Re: Test' });
    expect(result).toBe('done');
    expect(ms.DatabaseStore.find).toHaveBeenCalled();
    expect(ms.TaskFactory.tasksForMovingToTrash).toHaveBeenCalled();
    expect(ms.Actions.queueTasks).toHaveBeenCalled();
  });

  it('confirmDialog: handles missing thread gracefully', async () => {
    fakeDialog(1);
    const { ms } = fakeExports();
    (ms.DatabaseStore.find as jasmine.Spy).andReturn(Promise.resolve(null));
    const result = await trashThreadSkill.confirmDialog!({ threadId: 'missing' });
    expect(result).toBe('done'); // dialog completed; no tasks queued
    expect(ms.Actions.queueTasks).not.toHaveBeenCalled();
  });

  it('includes thread subject in dialog message', async () => {
    const remote = fakeDialog(0);
    fakeExports();
    await trashThreadSkill.confirmDialog!({ threadId: 't1', subject: 'Project Alpha' });
    const callArgs = remote.dialog.showMessageBox.mostRecentCall.args[0];
    expect(callArgs.message).toContain('Project Alpha');
  });
});

// ─── archive_thread ──────────────────────────────────────────────────────────

describe('archiveThreadSkill', () => {
  it('is a confirm-tier skill', () => {
    expect(archiveThreadSkill.tier).toBe('confirm');
  });

  it('is disabled by default', () => {
    fakeConfig({});
    expect(archiveThreadSkill.enabled!()).toBe(false);
  });

  it('is enabled when config key is true', () => {
    fakeConfig({ 'ai-assistant.skills.archiveThread': true });
    expect(archiveThreadSkill.enabled!()).toBe(true);
  });

  it('confirmDialog: Cancel returns deny without queuing', async () => {
    fakeDialog(0);
    const { ms } = fakeExports();
    const result = await archiveThreadSkill.confirmDialog!({ threadId: 't1', subject: 'Newsletter' });
    expect(result).toBe('deny');
    expect(ms.Actions.queueTasks).not.toHaveBeenCalled();
  });

  it('confirmDialog: Archive queues task and returns done', async () => {
    fakeDialog(1);
    const { ms } = fakeExports();
    const result = await archiveThreadSkill.confirmDialog!({ threadId: 't1', subject: 'Newsletter' });
    expect(result).toBe('done');
    expect(ms.TaskFactory.tasksForArchiving).toHaveBeenCalled();
    expect(ms.Actions.queueTasks).toHaveBeenCalled();
  });

  it('includes thread subject in dialog message', async () => {
    const remote = fakeDialog(0);
    fakeExports();
    await archiveThreadSkill.confirmDialog!({ threadId: 't1', subject: 'Weekly Digest' });
    const callArgs = remote.dialog.showMessageBox.mostRecentCall.args[0];
    expect(callArgs.message).toContain('Weekly Digest');
  });
});
