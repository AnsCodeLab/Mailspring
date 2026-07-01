import React from 'react';
import { ChatActivityStore } from './chat-activity-store';

const ThreadChatBadge: React.FC<{ thread: any }> = ({ thread }) => {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    return ChatActivityStore.subscribe(tick);
  }, []);

  const id = thread?.id;
  if (!id) return null;

  const active = ChatActivityStore.isActive(id);
  const hist = ChatActivityStore.hasHistory(id);
  if (!active && !hist) return null;

  return (
    <div
      className={`ai-thread-badge${active ? ' active' : ''}`}
      title={active ? 'AI is responding...' : 'Has AI chat history'}
    >
      ✦
    </div>
  );
};
ThreadChatBadge.displayName = 'ThreadChatBadge';
export default ThreadChatBadge;
