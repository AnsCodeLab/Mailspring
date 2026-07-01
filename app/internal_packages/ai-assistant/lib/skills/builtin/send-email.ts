import { Skill, ConfirmResult } from '../types';
import { AIConfig } from '../../config';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMarkdown(text: string): string {
  return (
    escapeHtml(text)
      // **bold** and __bold__
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      // *italic* and _italic_
      .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
      .replace(/_([^_\n]+?)_/g, '<em>$1</em>')
      // `code`
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  );
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

    // fenced code block
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

    // ATX headings
    const hm = line.match(/^(#{1,3}) (.+)/);
    if (hm) {
      flushList();
      const level = Math.min(hm[1].length + 2, 6);
      out.push(`<h${level}>${inlineMarkdown(hm[2])}</h${level}>`);
      i++;
      continue;
    }

    // unordered list
    const ulm = line.match(/^[-*] (.+)/);
    if (ulm) {
      if (listOrdered) flushList();
      listOrdered = false;
      listItems.push(inlineMarkdown(ulm[1]));
      i++;
      continue;
    }

    // ordered list
    const olm = line.match(/^\d+\. (.+)/);
    if (olm) {
      if (!listOrdered) flushList();
      listOrdered = true;
      listItems.push(inlineMarkdown(olm[1]));
      i++;
      continue;
    }

    // blank line = paragraph break
    if (line.trim() === '') {
      flushList();
      i++;
      continue;
    }

    // regular paragraph line — collect consecutive non-blank lines
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

async function buildAndOpenDraft(args: {
  to: string;
  subject?: string;
  body?: string;
  cc?: string;
}): Promise<string> {
  const {
    DraftFactory,
    Actions,
    SanitizeTransformer,
    SyncbackDraftTask,
    TaskQueue,
  } = require('mailspring-exports');
  const html = SanitizeTransformer.runSync(markdownToHtml(String(args.body || '')));
  const draft = await DraftFactory.createDraft({
    subject: args.subject || '',
    to: [{ email: args.to, name: args.to }],
    cc: args.cc ? [{ email: args.cc, name: args.cc }] : [],
  });
  draft.body = html + (draft.body || '');
  // Persist before opening composer so the session can find the draft.
  const syncTask = new SyncbackDraftTask({ draft });
  Actions.queueTask(syncTask);
  await TaskQueue.waitForPerformLocal(syncTask);
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
    const {
      DraftFactory,
      Actions,
      SanitizeTransformer,
      SyncbackDraftTask,
      TaskQueue,
    } = require('mailspring-exports');
    const html = SanitizeTransformer.runSync(markdownToHtml(String(args.body || '')));
    const draft = await DraftFactory.createDraft({
      subject: args.subject || '',
      to: [{ email: args.to, name: args.to }],
      cc: args.cc ? [{ email: args.cc, name: args.cc }] : [],
    });
    draft.body = html + (draft.body || '');
    // Persist the draft first so DraftEditingSession can find it and populate `from`.
    const syncTask = new SyncbackDraftTask({ draft });
    Actions.queueTask(syncTask);
    await TaskQueue.waitForPerformLocal(syncTask);
    Actions.sendDraft(draft.headerMessageId);
    return { sent: true, to: args.to, subject: args.subject };
  },
};
