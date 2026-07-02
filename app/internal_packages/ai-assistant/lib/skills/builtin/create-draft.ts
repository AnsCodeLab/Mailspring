import { Skill } from '../types';

export const createDraftSkill: Skill = {
  name: 'create_draft',
  tier: 'write-reversible',
  description:
    'Create an email draft (a reply if threadId is given, else a new message). Never sends; opens it for the user to review.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
      body: {
        type: 'string',
        description: 'Raw email body text only — no preamble, no wrapper prose',
      },
      threadId: { type: 'string' },
    },
    required: ['body'],
  },
  async run({ to, subject, body, threadId }, ctx) {
    const {
      DraftFactory,
      DraftStore,
      SanitizeTransformer,
      Contact,
    } = require('mailspring-exports');
    const html = SanitizeTransformer.runSync(`<div>${String(body).replace(/\n/g, '<br/>')}</div>`);
    const draft =
      threadId && ctx?.thread
        ? await DraftFactory.createDraftForReply({ thread: ctx.thread, type: 'reply' })
        : await DraftFactory.createDraft({
            subject: subject || '',
            to: to ? [new Contact({ email: to, name: to })] : [],
          });
    draft.body = html + (draft.body || '');
    // _finalizeAndPersistNewMessage registers the session (so the Composer can find the
    // draft) and persists it to the DB before opening the popout Composer window.
    await DraftStore._finalizeAndPersistNewMessage(draft, { popout: true });
    return {
      created: true,
      headerMessageId: draft.headerMessageId,
      subject: subject || draft.subject,
      body,
    };
  },
};
