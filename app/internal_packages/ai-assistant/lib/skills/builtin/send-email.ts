import { Skill, ConfirmResult } from '../types';
import { AIConfig } from '../../config';

async function buildAndOpenDraft(args: {
  to: string;
  subject?: string;
  body?: string;
  cc?: string;
}): Promise<string> {
  const { DraftFactory, Actions, SanitizeTransformer } = require('mailspring-exports');
  const html = SanitizeTransformer.runSync(
    `<div>${String(args.body || '').replace(/\n/g, '<br/>')}</div>`
  );
  const draft = await DraftFactory.createDraft({
    subject: args.subject || '',
    to: [{ email: args.to, name: args.to }],
    cc: args.cc ? [{ email: args.cc, name: args.cc }] : [],
  });
  draft.body = html + (draft.body || '');
  if (Actions.composePopoutDraft) Actions.composePopoutDraft(draft.headerMessageId);
  return draft.headerMessageId;
}

export const sendEmailSkill: Skill = {
  name: 'send_email',
  tier: 'confirm',
  description:
    'Compose and immediately send an email. Only use when the user explicitly says "send" — prefer create_draft when they say "write" or "compose".',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      subject: { type: 'string' },
      body: { type: 'string', description: 'Plain text body' },
      cc: { type: 'string', description: 'CC address (optional)' },
    },
    required: ['to', 'subject', 'body'],
  },
  enabled: () => AIConfig.isSkillSendEmailEnabled(),

  async confirmDialog(args): Promise<ConfirmResult> {
    const toLine = `To: ${args.to}`;
    const ccLine = args.cc ? `\nCc: ${args.cc}` : '';
    const subjectLine = `\nSubject: ${args.subject || '(no subject)'}`;
    const { response } = await require('@electron/remote').dialog.showMessageBox({
      type: 'question',
      buttons: ['Cancel', 'Open in Composer', 'Send Now'],
      defaultId: 1, // safer default: open in composer rather than send
      cancelId: 0,
      title: 'Send Email?',
      message: toLine + ccLine + subjectLine,
      detail: String(args.body || '').slice(0, 600),
    });
    if (response === 0) return 'deny';
    if (response === 1) {
      // Open in Composer: create draft, open it, done — no call to run()
      await buildAndOpenDraft(args);
      return 'done';
    }
    return 'proceed'; // Send Now
  },

  async run(args) {
    const { DraftFactory, Actions, SanitizeTransformer } = require('mailspring-exports');
    const html = SanitizeTransformer.runSync(
      `<div>${String(args.body || '').replace(/\n/g, '<br/>')}</div>`
    );
    const draft = await DraftFactory.createDraft({
      subject: args.subject || '',
      to: [{ email: args.to, name: args.to }],
      cc: args.cc ? [{ email: args.cc, name: args.cc }] : [],
    });
    draft.body = html + (draft.body || '');
    Actions.sendDraft(draft.headerMessageId);
    return { sent: true, to: args.to, subject: args.subject };
  },
};
