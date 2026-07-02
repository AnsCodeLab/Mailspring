import { Skill } from '../types';
import { DatabaseStore, Message } from 'mailspring-exports';
import { htmlToText } from '../../chunking';

export const openEmailSkill: Skill = {
  name: 'open_email',
  tier: 'read',
  description: 'Load the full body of a specific email by its messageId.',
  parameters: {
    type: 'object',
    properties: { messageId: { type: 'string' } },
    required: ['messageId'],
  },
  async run({ messageId }: { messageId: string }) {
    const msg = await DatabaseStore.find<Message>(Message, messageId).include(
      Message.attributes.body
    );
    if (!msg) throw new Error(`Message ${messageId} not found`);
    return {
      messageId: msg.id,
      threadId: msg.threadId,
      sender: msg.from?.[0]?.name || msg.from?.[0]?.email || '',
      subject: msg.subject || '',
      body: htmlToText(msg.body || '').slice(0, 8000),
      date: msg.date ? new Date(msg.date).toISOString().slice(0, 10) : '',
    };
  },
};
