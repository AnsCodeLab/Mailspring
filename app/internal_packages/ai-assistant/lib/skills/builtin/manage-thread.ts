import { Skill, ConfirmResult } from '../types';
import { AIConfig } from '../../config';

async function confirmAndRun(
  title: string,
  message: string,
  confirmLabel: string,
  action: () => Promise<any>
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
  return 'done'; // handled entirely here, skip run()
}

async function fetchThread(threadId: string) {
  const { DatabaseStore, Thread, FocusedContentStore } = require('mailspring-exports');
  const thread = threadId ? await DatabaseStore.find(Thread, threadId) : null;
  // Fall back to the currently focused thread when id is missing or stale
  return thread || (FocusedContentStore.focused('thread') ?? null);
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

  async confirmDialog(args): Promise<ConfirmResult> {
    const label = args.subject ? `"${args.subject}"` : 'this thread';
    return confirmAndRun(
      'Move to Trash?',
      `${label} will be moved to Trash.`,
      'Move to Trash',
      async () => {
        const { Actions, TaskFactory } = require('mailspring-exports');
        const thread = await fetchThread(args.threadId);
        if (!thread) return;
        const tasks = TaskFactory.tasksForMovingToTrash({
          threads: [thread],
          source: 'AI Assistant',
        });
        Actions.queueTasks(tasks);
      }
    );
  },

  // run() is never called because confirmDialog returns 'done' or 'deny'
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

  async confirmDialog(args): Promise<ConfirmResult> {
    const label = args.subject ? `"${args.subject}"` : 'this thread';
    return confirmAndRun('Archive Thread?', `${label} will be archived.`, 'Archive', async () => {
      const { Actions, TaskFactory } = require('mailspring-exports');
      const thread = await fetchThread(args.threadId);
      if (!thread) return;
      const tasks = TaskFactory.tasksForArchiving({ threads: [thread], source: 'AI Assistant' });
      Actions.queueTasks(tasks);
    });
  },

  async run() {
    return { error: 'should not be reached' };
  },
};
