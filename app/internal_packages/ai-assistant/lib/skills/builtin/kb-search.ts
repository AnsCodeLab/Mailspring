import { Skill } from '../types';
import { retrieve } from '../../retriever';
import { Indexer } from '../../indexer';
import { AIConfig } from '../../config';

export const kbSearchSkill: Skill = {
  name: 'search_email_knowledge_base',
  tier: 'read',
  description:
    "Semantic search across all of the user's indexed email. Returns relevant passages with sender/subject/date.",
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' }, k: { type: 'number' } },
    required: ['query'],
  },
  enabled: () => AIConfig.isKnowledgeBaseEnabled(),
  async run({ query, k }) {
    return (await retrieve(query, Indexer.store(), k || 6)).map((s) => ({
      from: s.sender,
      subject: s.subject,
      date: s.date,
      text: s.text,
      messageId: s.messageId,
      threadId: s.threadId,
    }));
  },
};
