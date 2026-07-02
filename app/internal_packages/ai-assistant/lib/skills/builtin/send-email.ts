import { Skill } from '../types';
import { AIConfig } from '../../config';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SAFE_PROTOCOLS = new Set(['http', 'https', 'mailto']);

function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+?)_/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const proto = href.trim().split(':')[0].toLowerCase();
      if (!SAFE_PROTOCOLS.has(proto)) return label; // strip unsafe links entirely
      return `<a href="${href.replace(/"/g, '&quot;')}">${label}</a>`;
    });
}

function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  let listItems: string[] = [];
  let listOrdered = false;

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listOrdered ? 'ol' : 'ul';
    out.push(`<${tag}>${listItems.map((li) => `<li>${li}</li>`).join('')}</${tag}>`);
    listItems = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flushList();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
      i++;
      continue;
    }
    const hm = line.match(/^(#{1,3}) (.+)/);
    if (hm) {
      flushList();
      const level = Math.min(hm[1].length + 2, 6);
      out.push(`<h${level}>${inlineMarkdown(hm[2])}</h${level}>`);
      i++;
      continue;
    }
    const ulm = line.match(/^[-*] (.+)/);
    if (ulm) {
      if (listOrdered) flushList();
      listOrdered = false;
      listItems.push(inlineMarkdown(ulm[1]));
      i++;
      continue;
    }
    const olm = line.match(/^\d+\. (.+)/);
    if (olm) {
      if (!listOrdered) flushList();
      listOrdered = true;
      listItems.push(inlineMarkdown(olm[1]));
      i++;
      continue;
    }
    if (line.trim() === '') {
      flushList();
      i++;
      continue;
    }
    flushList();
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !/^[-*\d]/.test(lines[i])
    ) {
      para.push(inlineMarkdown(lines[i]));
      i++;
    }
    out.push(`<p>${para.join('<br>')}</p>`);
  }
  flushList();
  return out.join('\n');
}

export const sendEmailSkill: Skill = {
  name: 'send_email',
  tier: 'confirm',
  description:
    'Compose and open an email in the Composer for the user to review and send. Only use when the user explicitly says "send" — prefer create_draft when they say "write" or "compose".',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      subject: { type: 'string' },
      body: {
        type: 'string',
        description: 'Raw email body text only — no preamble, no wrapper prose',
      },
      cc: { type: 'string', description: 'CC address (optional)' },
    },
    required: ['to', 'subject', 'body'],
  },
  enabled: () => AIConfig.isSkillSendEmailEnabled(),

  async confirmDialog(args): Promise<import('../types').ConfirmResult> {
    const to = String(args.to || '').trim();
    const subject = String(args.subject || '').trim();
    const preview = String(args.body || '').slice(0, 300);
    const detail = `To: ${to}\nSubject: ${subject}\n\n${preview}${preview.length === 300 ? '...' : ''}`;
    const { response } = await require('@electron/remote').dialog.showMessageBox({
      type: 'question',
      buttons: ['Cancel', 'Open in Composer', 'Send Now'],
      defaultId: 1,
      cancelId: 0,
      title: 'Send email?',
      message: detail,
    });
    if (response === 0) return 'deny';
    if (response === 2) return 'proceed'; // run() will send
    // Button 1: Open in Composer
    const {
      DraftFactory,
      DraftStore,
      SanitizeTransformer,
      Contact,
    } = require('mailspring-exports');
    const html = SanitizeTransformer.runSync(markdownToHtml(String(args.body || '')));
    const draft = await DraftFactory.createDraft({
      subject: args.subject || '',
      to: args.to ? [new Contact({ email: args.to, name: args.to })] : [],
      cc: args.cc ? [new Contact({ email: args.cc, name: args.cc })] : [],
    });
    draft.body = html + (draft.body || '');
    await DraftStore._finalizeAndPersistNewMessage(draft, { popout: true });
    return 'done';
  },

  async run(args) {
    const {
      DraftFactory,
      DraftStore,
      Actions,
      SanitizeTransformer,
      Contact,
    } = require('mailspring-exports');
    const html = SanitizeTransformer.runSync(markdownToHtml(String(args.body || '')));
    const draft = await DraftFactory.createDraft({
      subject: args.subject || '',
      to: args.to ? [{ email: args.to, name: args.to }] : [],
      cc: args.cc ? [{ email: args.cc, name: args.cc }] : [],
    });
    draft.body = html + (draft.body || '');
    await DraftStore._finalizeAndPersistNewMessage(draft);
    Actions.sendDraft(draft.headerMessageId);
    return { sent: true, to: args.to, subject: args.subject, body: args.body };
  },
};
