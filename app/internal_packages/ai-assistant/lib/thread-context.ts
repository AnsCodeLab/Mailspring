import { ThreadMsg } from './prompts';

function strip(html: string): string {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function loadThreadMessages(thread: any): Promise<ThreadMsg[]> {
  if (!thread) return [];
  const messages = await thread.messages({ includeHidden: false });
  return messages.map((m: any) => ({
    from: (m.from && m.from[0] && (m.from[0].name || m.from[0].email)) || 'Unknown',
    date: m.date ? new Date(m.date).toISOString().slice(0, 10) : '',
    text: strip(m.body),
  }));
}
