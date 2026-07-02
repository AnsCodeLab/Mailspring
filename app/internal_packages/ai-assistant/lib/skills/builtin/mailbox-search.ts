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
  },
  async run({ sender, subject }: { sender?: string; subject?: string }) {
    let q = DatabaseStore.findAll<Message>(Message).order(Message.attributes.date.descending());
    // AttributeString supports substring search directly.
    if (subject) q = q.where(Message.attributes.subject.like(subject));
    // AttributeCollection.contains() only matches an exact joined Contact id, not a
    // substring - it can't filter "from" by a partial name/email. Fetch a bounded window
    // ordered newest-first and filter by sender client-side instead.
    const msgs = await q.limit(sender ? 500 : 20);
    const filtered = sender
      ? msgs.filter((m) => {
          const from = m.from?.[0];
          const haystack = `${from?.name || ''} ${from?.email || ''}`.toLowerCase();
          return haystack.includes(sender.toLowerCase());
        })
      : msgs;
    return filtered.slice(0, 20).map((m) => ({
      messageId: m.id,
      threadId: m.threadId,
      sender: m.from?.[0]?.name || m.from?.[0]?.email || '',
      subject: m.subject || '',
      snippet: htmlToText(m.body || '').slice(0, 200),
      date: m.date ? new Date(m.date).toISOString().slice(0, 10) : '',
    }));
  },
};
