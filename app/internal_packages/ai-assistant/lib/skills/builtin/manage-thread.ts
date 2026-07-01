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
  const { DatabaseStore, Thread } = require('mailspring-exports');
  return DatabaseStore.find(Thread, threadId);
}

export const trashThreadSkill: Skill = {
  name: 'trash_thread',
  tier: 'confirm',
  description: 'Move a thread to Trash. Provide the threadId; include the subject for context.',
  parameters: {
    type: 'object',
    properties: {
      threadId: { type: 'string' },
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
  description: 'Archive a thread. Provide the threadId; include the subject for context.',
  parameters: {
    type: 'object',
    properties: {
      threadId: { type: 'string' },
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
