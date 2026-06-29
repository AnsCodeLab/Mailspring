import { Skill } from '../types';
import { DraftFactory, Actions, SanitizeTransformer } from 'mailspring-exports';

export const createDraftSkill: Skill = {
  name: 'create_draft',
  tier: 'write-reversible',
  description:
    'Create an email draft (a reply if threadId is given, else a new message). Never sends — opens it for the user to review.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
      threadId: { type: 'string' },
    },
    required: ['body'],
  },
  async run({ to, subject, body, threadId }, ctx) {
    const html = SanitizeTransformer.runSync(`<div>${String(body).replace(/\n/g, '<br/>')}</div>`);
    const draft =
      threadId && ctx?.thread
        ? await DraftFactory.createDraftForReply({ thread: ctx.thread, type: 'reply' })
        : await DraftFactory.createDraft({
            subject: subject || '',
            to: to ? [{ email: to, name: to }] : [],
          });
    draft.body = html + (draft.body || '');
    if (Actions.composePopoutDraft) Actions.composePopoutDraft(draft.headerMessageId);
    return { created: true, headerMessageId: draft.headerMessageId };
  },
};
