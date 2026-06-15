import fs from 'fs';
import TurndownService from 'turndown';
import {
  Message,
  Thread,
  DatabaseStore,
  QuotedHTMLTransformer,
  AttachmentStore,
  localized,
} from 'mailspring-exports';

export function sanitizeFilename(subject: string): string {
  const safe = (subject || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .substring(0, 100)
    .trim();
  return safe || 'email';
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatContact(c: { name?: string; email: string }): string {
  return c.name ? `${c.name} <${c.email}>` : c.email;
}

function resolveCidImages(html: string, message: Message): string {
  let result = html;
  for (const file of message.files || []) {
    if (!file.contentId) continue;
    const filePath = AttachmentStore.pathForFile(file);
    if (!filePath) continue;
    try {
      const data = fs.readFileSync(filePath);
      const mimeType = file.contentType || 'image/png';
      const dataUri = `data:${mimeType};base64,${data.toString('base64')}`;
      const escapedId = file.contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`cid:${escapedId}`, 'g'), dataUri);
    } catch {
      // leave cid: reference as-is if file cannot be read
    }
  }
  return result;
}

function buildMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });
  return td.turndown(html).trim();
}

function messageToMarkdownBlock(message: Message): string {
  const strippedHtml = QuotedHTMLTransformer.removeQuotedHTML(message.body || '', {
    keepIfWholeBodyIsQuote: true,
  });
  const resolvedHtml = resolveCidImages(strippedHtml, message);
  let body = buildMarkdown(resolvedHtml);
  if (!body) {
    body = message.snippet || '';
  }

  const from = (message.from || []).map(formatContact).join(', ');
  const to = (message.to || []).map(formatContact).join(', ');
  const cc = (message.cc || []).map(formatContact).join(', ');
  const date = message.date ? formatDate(message.date) : '';

  const lines = [`## From: ${from}`, `**Date:** ${date}  `, `**To:** ${to}  `];
  if (cc) {
    lines.push(`**CC:** ${cc}  `);
  }
  lines.push('', body);

  return lines.join('\n');
}

export function buildThreadMarkdown(thread: Thread, messages: Message[]): string {
  if (!messages.length) return '';
  const sorted = [...messages].sort((a, b) => {
    const aTime = a.date ? a.date.getTime() : 0;
    const bTime = b.date ? b.date.getTime() : 0;
    return aTime - bTime;
  });
  const subject = thread.subject || 'Email Thread';
  const blocks = sorted.map(messageToMarkdownBlock);
  return `# ${subject}\n\n---\n\n${blocks.join('\n\n---\n\n')}`;
}

export function buildSingleMessageMarkdown(message: Message): string {
  const subject = message.subject || 'Email';
  const block = messageToMarkdownBlock(message);
  return `# ${subject}\n\n---\n\n${block}`;
}

export async function saveMarkdownFile(content: string, defaultFilename: string): Promise<void> {
  return new Promise((resolve) => {
    AppEnv.showSaveDialog(
      {
        defaultPath: `${sanitizeFilename(defaultFilename)}.md`,
        title: localized('Export as Markdown'),
      },
      (savePath: string) => {
        if (!savePath) {
          resolve();
          return;
        }
        try {
          fs.writeFileSync(savePath, content, 'utf8');
        } catch (err) {
          AppEnv.showErrorDialog({
            title: localized('Export Failed'),
            message: String(err),
          });
        }
        resolve();
      }
    );
  });
}

export async function fetchThreadMessages(threadId: string): Promise<Message[]> {
  const messages = await DatabaseStore.findAll<Message>(Message, { threadId }).include(
    Message.attributes.body
  );
  return messages.filter((m) => !m.isHidden());
}
