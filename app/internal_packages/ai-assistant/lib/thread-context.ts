import fs from 'fs';
import { ThreadMsg } from './prompts';

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'csv',
  'json',
  'xml',
  'html',
  'htm',
  'log',
  'yaml',
  'yml',
]);
const MAX_ATTACHMENT_CHARS = 4000;
const MAX_ATTACHMENT_BYTES = 512 * 1024; // skip reading files larger than 512 KB

function strip(html: string): string {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ext(filename: string): string {
  return filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
}

async function readAttachment(file: any): Promise<string | null> {
  try {
    const { AttachmentStore } = require('mailspring-exports');
    const filePath: string | null = AttachmentStore.pathForFile(file);
    if (!filePath || !fs.existsSync(filePath)) return null;
    if (!TEXT_EXTENSIONS.has(ext(file.displayName()))) return null;
    if (file.size > MAX_ATTACHMENT_BYTES) return null; // too large — just list the filename
    const content = fs.readFileSync(filePath, 'utf8');
    return content.length > MAX_ATTACHMENT_CHARS
      ? content.slice(0, MAX_ATTACHMENT_CHARS) + '\n…[truncated]'
      : content;
  } catch {
    return null;
  }
}

export async function loadThreadMessages(thread: any): Promise<ThreadMsg[]> {
  if (!thread) return [];
  const messages = await thread.messages({ includeHidden: false });
  return Promise.all(
    messages.map(async (m: any) => {
      const files: any[] = m.files || [];
      const attachments: string[] = [];
      for (const file of files) {
        const name = file.displayName?.() || file.filename || 'attachment';
        const content = await readAttachment(file);
        if (content !== null) {
          attachments.push(`${name}:\n${content}`);
        } else {
          attachments.push(name);
        }
      }
      return {
        from: (m.from && m.from[0] && (m.from[0].name || m.from[0].email)) || 'Unknown',
        date: m.date ? new Date(m.date).toISOString().slice(0, 10) : '',
        text: strip(m.body) || strip(m.snippet) || '',
        attachments: attachments.length ? attachments : undefined,
      };
    })
  );
}
