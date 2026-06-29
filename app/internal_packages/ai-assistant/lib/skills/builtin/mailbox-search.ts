import { Skill } from '../types';
import { DatabaseStore, Message } from 'mailspring-exports';
import { htmlToText } from '../../chunking';

export const mailboxSearchSkill: Skill = {
  name: 'search_mailbox',
  tier: 'read',
  description:
    'Search email by sender address or subject keyword. Returns message IDs, subjects, senders, and snippets.',
  parameters: {
    type: 'object',
    properties: { sender: { type: 'string' }, subject: { type: 'string' } },
    required: [],
  },
  async run({ sender, subject }: { sender?: string; subject?: string }) {
    let q = DatabaseStore.findAll(Message);
    if (sender) q = (q as any).where(Message.attributes.from.containsString(sender));
    if (subject) q = (q as any).where(Message.attributes.subject.containsString(subject));
    const msgs = await (q as any).limit(20);
    return msgs.map((m: any) => ({
      messageId: m.id,
      threadId: m.threadId,
      sender: m.from?.[0]?.name || m.from?.[0]?.email || '',
      subject: m.subject || '',
      snippet: htmlToText(m.body || '').slice(0, 200),
      date: m.date ? new Date(m.date).toISOString().slice(0, 10) : '',
    }));
  },
};
