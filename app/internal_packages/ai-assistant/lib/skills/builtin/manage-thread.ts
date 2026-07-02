import { Skill, ConfirmResult } from '../types';
import { AIConfig } from '../../config';

async function resolveThread(args: { threadId?: string; subject?: string }, ctx: any) {
  const { DatabaseStore, Thread, FocusedContentStore } = require('mailspring-exports');
  // Prefer the live thread object from ctx (passed from chat-panel state) so we never
  // need a DB round-trip and avoid race conditions where the focused thread changed.
  if (ctx?.thread) return ctx.thread as typeof Thread;
  if (args.threadId) {
    const t = await DatabaseStore.find(Thread, args.threadId);
    if (t) return t;
  }
  const focused = FocusedContentStore.focused('thread');
  if (focused) return focused;
  throw new Error(
    `Could not find thread "${args.subject || args.threadId || '(unknown)'}". Please select the thread first.`
  );
}

// Resolve a thread strictly by threadId — used in batch operations where ctx.thread is only
// one of N threads and cannot be reused for all items.
async function resolveThreadById(args: { threadId?: string; subject?: string }, ctx: any) {
  const { DatabaseStore, Thread, FocusedContentStore } = require('mailspring-exports');
  if (args.threadId) {
    const t = await DatabaseStore.find(Thread, args.threadId);
    if (t) return t;
  }
  // Fallback to focused thread only when no threadId was provided at all.
  if (!args.threadId) {
    if (ctx?.thread) return ctx.thread;
    const focused = FocusedContentStore.focused('thread');
    if (focused) return focused;
  }
  throw new Error(`Could not find thread "${args.subject || args.threadId || '(unknown)'}".`);
}

async function confirmAndExecute(
  title: string,
  message: string,
  confirmLabel: string,
  action: () => Promise<void>
): Promise<ConfirmResult> {
  const { response } = await require('@electron/remote').dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', confirmLabel],
    defaultId: 1,
    cancelId: 0,
    title,
    message,
  });
  if (response === 0) return 'deny';
  await action();
  return 'done';
}

export const trashThreadSkill: Skill = {
  name: 'trash_thread',
  tier: 'confirm',
  description:
    'Move a thread to Trash. Pass the threadId from the CURRENT THREAD context header; also pass the subject.',
  parameters: {
    type: 'object',
    properties: {
      threadId: { type: 'string', description: 'Thread ID from the CURRENT THREAD context header' },
      subject: { type: 'string', description: 'Thread subject shown in the confirmation prompt' },
    },
    required: ['threadId'],
  },
  enabled: () => AIConfig.isSkillTrashThreadEnabled(),

  async confirmDialog(args, ctx): Promise<ConfirmResult> {
    const thread = await resolveThread(args, ctx);
    const label = thread.subject ? `"${thread.subject}"` : 'this thread';
    return confirmAndExecute(
      'Move to Trash?',
      `${label} will be moved to Trash.`,
      'Move to Trash',
      async () => {
        const { Actions, TaskFactory } = require('mailspring-exports');
        const tasks = TaskFactory.tasksForMovingToTrash({
          threads: [thread],
          source: 'AI Assistant',
        });
        if (!tasks || tasks.length === 0)
          throw new Error('No trash task could be created for this account.');
        Actions.queueTasks(tasks);
      }
    );
  },

  async confirmManyDialog(argsArray, ctx): Promise<ConfirmResult> {
    if (argsArray.length === 1) return trashThreadSkill.confirmDialog!(argsArray[0], ctx);
    const threads = (
      await Promise.all(argsArray.map((a) => resolveThreadById(a, ctx).catch(() => null)))
    ).filter(Boolean);
    if (!threads.length) throw new Error('Could not resolve any threads to trash.');
    const labels = threads.map((t: any) => (t.subject ? `"${t.subject}"` : '(no subject)'));
    const preview =
      labels.slice(0, 5).join('\n') +
      (labels.length > 5 ? `\n...and ${labels.length - 5} more` : '');
    return confirmAndExecute(
      `Move ${threads.length} threads to Trash?`,
      preview,
      'Move to Trash',
      async () => {
        const { Actions, TaskFactory } = require('mailspring-exports');
        const tasks = TaskFactory.tasksForMovingToTrash({ threads, source: 'AI Assistant' });
        if (!tasks || tasks.length === 0)
          throw new Error('No trash tasks could be created for this account.');
        Actions.queueTasks(tasks);
      }
    );
  },

  async run() {
    return { error: 'should not be reached' };
  },
};

export const archiveThreadSkill: Skill = {
  name: 'archive_thread',
  tier: 'confirm',
  description:
    'Archive a thread. Pass the threadId from the CURRENT THREAD context header; also pass the subject.',
  parameters: {
    type: 'object',
    properties: {
      threadId: { type: 'string', description: 'Thread ID from the CURRENT THREAD context header' },
      subject: { type: 'string', description: 'Thread subject shown in the confirmation prompt' },
    },
    required: ['threadId'],
  },
  enabled: () => AIConfig.isSkillArchiveThreadEnabled(),

  async confirmDialog(args, ctx): Promise<ConfirmResult> {
    const thread = await resolveThread(args, ctx);
    const label = thread.subject ? `"${thread.subject}"` : 'this thread';
    return confirmAndExecute(
      'Archive Thread?',
      `${label} will be archived.`,
      'Archive',
      async () => {
        const { Actions, TaskFactory } = require('mailspring-exports');
        const tasks = TaskFactory.tasksForArchiving({ threads: [thread], source: 'AI Assistant' });
        if (!tasks || tasks.length === 0)
          throw new Error('No archive task could be created for this account.');
        Actions.queueTasks(tasks);
      }
    );
  },

  async confirmManyDialog(argsArray, ctx): Promise<ConfirmResult> {
    if (argsArray.length === 1) return archiveThreadSkill.confirmDialog!(argsArray[0], ctx);
    const threads = (
      await Promise.all(argsArray.map((a) => resolveThreadById(a, ctx).catch(() => null)))
    ).filter(Boolean);
    if (!threads.length) throw new Error('Could not resolve any threads to archive.');
    const labels = threads.map((t: any) => (t.subject ? `"${t.subject}"` : '(no subject)'));
    const preview =
      labels.slice(0, 5).join('\n') +
      (labels.length > 5 ? `\n...and ${labels.length - 5} more` : '');
    return confirmAndExecute(`Archive ${threads.length} threads?`, preview, 'Archive', async () => {
      const { Actions, TaskFactory } = require('mailspring-exports');
      const tasks = TaskFactory.tasksForArchiving({ threads, source: 'AI Assistant' });
      if (!tasks || tasks.length === 0)
        throw new Error('No archive tasks could be created for this account.');
      Actions.queueTasks(tasks);
    });
  },

  async run() {
    return { error: 'should not be reached' };
  },
};
