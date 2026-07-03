import React from 'react';
import {
  FocusedContentStore,
  FocusedPerspectiveStore,
  AccountStore,
  DraftFactory,
  DatabaseStore,
  Thread,
  Actions,
  TaskQueue,
  SyncbackDraftTask,
  SanitizeTransformer,
  localized,
} from 'mailspring-exports';
import { AIService, ChatMessage } from './ai-service';
import { buildChatPrompt, RetrievedSource, SenderIdentity } from './prompts';
import { loadThreadMessages } from './thread-context';
import { ensurePrivacyNoticeAccepted } from './privacy-notice';
import { retrieve } from './retriever';
import { validateCitations } from './citations';
import { AIConfig } from './config';
import { ChatStore } from './chat-store';
import { ChatActivityStore } from './chat-activity-store';

type Turn = { role: 'user' | 'assistant'; content: string };

// Chat is global — one shared conversation. Sessions are named by the first user
// message and keyed by timestamp so history stays readable across restarts.

// Context-aware initial suggestions based on thread metadata.
function getInitialSuggestions(thread: any): string[] {
  if (!thread)
    return [
      "What's new today?",
      'Summarize this week',
      'Summarize this month',
      'Find unread emails',
    ];
  const sub = (thread.subject || '').toLowerCase();
  const snip = (thread.snippet || '').toLowerCase();
  const combined = sub + ' ' + snip;
  const participantCount: number = (thread.participants || []).length;

  if (/meeting|call|schedule|calendar|invite|agenda/.test(combined))
    return [
      'Summarize this thread',
      'What time is proposed?',
      'Draft an acceptance reply',
      "Who's invited?",
    ];
  if (/invoice|payment|receipt|billing|quote|order/.test(combined))
    return [
      'What is the amount due?',
      'Summarize this thread',
      'Draft a reply',
      'Find related emails',
    ];
  if (/urgent|asap|deadline|immediately|critical/.test(combined))
    return [
      'What action is needed?',
      'Summarize this thread',
      'What is the deadline?',
      'Draft a reply',
    ];
  if (/\?/.test(thread.subject || '') || /\?/.test(snip.slice(0, 120)))
    return [
      'What is being asked?',
      'Draft a reply',
      'Summarize this thread',
      'Find related emails',
    ];
  if (participantCount > 4)
    return [
      'Summarize this thread',
      'Who are the key participants?',
      'What are the main points?',
      'Draft a reply',
    ];
  if (thread.starred)
    return [
      'What is important here?',
      'What action is needed?',
      'Summarize this thread',
      'Draft a reply',
    ];
  if (thread.unread)
    return [
      'Summarize this thread',
      'Draft a reply',
      'What action items are here?',
      'Who sent this?',
    ];
  return [
    'Summarize this thread',
    'Draft a reply',
    'What action items are here?',
    "What's the main question?",
  ];
}

// Context-aware follow-up suggestions based on what the AI just said.
function getFollowUpSuggestions(turns: Turn[], hasThread: boolean): string[] {
  const last = [...turns].reverse().find((t) => t.role === 'assistant');
  if (!last?.content) return [];
  const c = last.content.toLowerCase();

  // After a draft or email was composed
  if (/subject:|draft|compos|repl|wrote|composer/.test(c))
    return ['Make it shorter', 'More formal tone', 'Send this email', 'Translate to Vietnamese'];

  // After action items / tasks listed
  if (/action item|next step|todo|task|follow.?up/.test(c))
    return [
      'Draft a reply addressing these',
      'Find related emails',
      'Summarize for me',
      'Archive this thread',
    ];

  // After a summary
  if (/summar|overview|main point|key point|highlight/.test(c))
    return [
      'Draft a reply',
      'What are the next steps?',
      'Find related emails',
      'Archive this thread',
    ];

  // After search results were returned
  if (/found|search|result|email from|here are/.test(c))
    return [
      'Summarize these results',
      'Draft a response',
      'Find more like this',
      'Open this thread',
    ];

  // After archive / trash / move action completed
  if (/archiv|trash|delet|mov/.test(c))
    return ['Find more from this sender', 'Search my inbox', 'Find unread emails'];

  // After answering who/when/what questions
  if (/sent by|from:|participants|cc'd|date:|on \w+ \d/.test(c))
    return ['Draft a reply', 'Summarize this thread', 'Find related emails'];

  // Default when a thread is open
  if (hasThread)
    return ['Draft a reply', 'Summarize this thread', 'Find related emails', "Who's CC'd?"];
  return ['Search recent emails', 'Find emails from today', 'Show unread messages'];
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function parseTableRow(line: string): string[] {
  // Split on | and drop the leading/trailing empty segments from border pipes.
  const parts = line.split('|');
  return (parts[0].trim() === '' ? parts.slice(1) : parts)
    .slice(0, parts[parts.length - 1].trim() === '' ? -1 : undefined)
    .map((c) => c.trim());
}

function renderInline(text: string, key?: string | number): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*\n]+?)\*|_([^_\n]+?)_|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2] !== undefined || m[3] !== undefined) {
      parts.push(<strong key={`${key}-b${idx++}`}>{m[2] ?? m[3]}</strong>);
    } else if (m[4] !== undefined) {
      parts.push(<s key={`${key}-s${idx++}`}>{m[4]}</s>);
    } else if (m[5] !== undefined || m[6] !== undefined) {
      parts.push(<em key={`${key}-i${idx++}`}>{m[5] ?? m[6]}</em>);
    } else {
      parts.push(
        <code key={`${key}-c${idx++}`} className="ai-inline-code">
          {m[7]}
        </code>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMarkdown(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let ulItems: React.ReactNode[] = [];
  let olItems: React.ReactNode[] = [];
  let tableRows: Array<{ cells: string[]; isHeader: boolean }> = [];
  let tableAligns: Array<'left' | 'center' | 'right' | undefined> = [];

  const flushUl = () => {
    if (!ulItems.length) return;
    nodes.push(<ul key={`ul-${i}`}>{ulItems}</ul>);
    ulItems = [];
  };
  const flushOl = () => {
    if (!olItems.length) return;
    nodes.push(<ol key={`ol-${i}`}>{olItems}</ol>);
    olItems = [];
  };
  const flushTable = () => {
    if (!tableRows.length) return;
    const headers = tableRows.filter((r) => r.isHeader);
    const body = tableRows.filter((r) => !r.isHeader);
    nodes.push(
      <div key={`tbl-${i}`} className="ai-md-table-wrap">
        <table className="ai-md-table">
          {headers.length > 0 && (
            <thead>
              {headers.map((row, ri) => (
                <tr key={ri}>
                  {row.cells.map((cell, ci) => (
                    <th key={ci} style={{ textAlign: tableAligns[ci] }}>
                      {renderInline(cell, `${i}-th-${ri}-${ci}`)}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
          )}
          {body.length > 0 && (
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>
                  {row.cells.map((cell, ci) => (
                    <td key={ci} style={{ textAlign: tableAligns[ci] }}>
                      {renderInline(cell, `${i}-td-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    );
    tableRows = [];
    tableAligns = [];
  };
  const flushAll = () => {
    flushUl();
    flushOl();
    flushTable();
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      flushAll();
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <pre key={`pre-${i}`} className="ai-code-block">
          {lang && <div className="ai-code-lang">{lang}</div>}
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      i++;
      continue;
    }

    // ATX headings
    if (/^#{1,3} /.test(line)) {
      flushAll();
      const level = (line.match(/^#+/) || [''])[0].length;
      const Tag = `h${Math.min(level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6';
      nodes.push(
        <Tag key={`h-${i}`} className="ai-md-heading">
          {renderInline(line.slice(level + 1), i)}
        </Tag>
      );
      i++;
      continue;
    }

    // Horizontal rule (standalone ---, ***, ___)
    if (/^([-*_])\1{2,}$/.test(line.trim()) && tableRows.length === 0) {
      flushAll();
      nodes.push(<hr key={`hr-${i}`} className="ai-md-hr" />);
      i++;
      continue;
    }

    // GFM table — header row followed by separator
    if (line.includes('|') && tableRows.length === 0) {
      const next = lines[i + 1] || '';
      if (/^\s*\|?[\s\-:|]+\|/.test(next)) {
        flushUl();
        flushOl();
        tableRows.push({ cells: parseTableRow(line), isHeader: true });
        i++;
        tableAligns = parseTableRow(next).map((c) => {
          if (c.startsWith(':') && c.endsWith(':')) return 'center';
          if (c.endsWith(':')) return 'right';
          if (c.startsWith(':')) return 'left';
          return undefined;
        });
        i++;
        continue;
      }
    }
    // Table body rows
    if (tableRows.length > 0 && line.includes('|')) {
      tableRows.push({ cells: parseTableRow(line), isHeader: false });
      i++;
      continue;
    }
    // End of table
    if (tableRows.length > 0) flushTable();

    // Unordered list
    if (/^[-*+] /.test(line)) {
      flushOl();
      ulItems.push(<li key={`li-${i}`}>{renderInline(line.slice(2), i)}</li>);
      i++;
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      flushUl();
      olItems.push(<li key={`oli-${i}`}>{renderInline(line.replace(/^\d+\. /, ''), i)}</li>);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushAll();
      nodes.push(
        <blockquote key={`bq-${i}`} className="ai-md-blockquote">
          {renderInline(line.slice(2), i)}
        </blockquote>
      );
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      flushAll();
      nodes.push(<div key={`gap-${i}`} className="ai-para-gap" />);
      i++;
      continue;
    }

    // Paragraph (collect consecutive plain lines)
    flushAll();
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,3} /.test(lines[i]) &&
      !lines[i].startsWith('```') &&
      !/^[-*+] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !lines[i].startsWith('> ') &&
      !(lines[i].includes('|') && /^\s*\|?[\s\-:|]+\|/.test(lines[i + 1] || ''))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      nodes.push(
        <p key={`p-${i}`}>
          {paraLines.flatMap((l, pi) =>
            pi < paraLines.length - 1
              ? [renderInline(l, `${i}-${pi}`), <br key={`br-${i}-${pi}`} />]
              : [renderInline(l, `${i}-${pi}`)]
          )}
        </p>
      );
    }
  }
  flushAll();
  return nodes;
}

// ─── AI Panel Toggle Button (in thread toolbar) ───────────────────────────────

export class AIToggleButton extends React.Component<Record<string, never>, { open: boolean }> {
  static displayName = 'AIToggleButton';
  static containerStyles = { order: -1 };

  private _sub: { dispose: () => void } | null = null;
  state = { open: AIConfig.isPanelOpen() };

  componentDidMount() {
    this._sub = AppEnv.config.onDidChange(AIConfig.keys.panelOpen, () => {
      this.setState({ open: AIConfig.isPanelOpen() });
    });
  }
  componentWillUnmount() {
    if (this._sub) this._sub.dispose();
  }

  render() {
    return (
      <div style={{ order: 999 }}>
        <button
          title={localized('Toggle AI chat panel')}
          className={`btn btn-toolbar ai-toggle-btn ${this.state.open ? 'active' : ''}`}
          onClick={() => AppEnv.config.set(AIConfig.keys.panelOpen, !this.state.open)}
        >
          ✨ AI
        </button>
      </div>
    );
  }
}

// ─── Floating Chat Panel ──────────────────────────────────────────────────────

export default class AIChatPanel extends React.Component<
  Record<string, never>,
  {
    thread: any;
    turns: Turn[];
    input: string;
    busy: boolean;
    retrieved: RetrievedSource[];
    citedSources: RetrievedSource[];
    sessionId: string;
    open: boolean;
    width: number;
    showHistory: boolean;
    historyItems: Array<{
      sessionId: string;
      subject: string;
      preview: string;
      lastAt: number;
      count: number;
    }>;
    pendingEmail: {
      to: string;
      subject: string;
      body: string;
      secondsLeft: number;
      resolve: (result: 'send' | 'cancel' | 'compose') => void;
    } | null;
  }
> {
  static displayName = 'AIChatPanel';

  _unsub: () => void;
  _configSub1: { dispose: () => void } | null = null;
  _configSub2: { dispose: () => void } | null = null;
  _abort: AbortController | null = null;
  _composing = false;
  private __chatStore: ChatStore | null = null;
  private _scrollRef = React.createRef<HTMLDivElement>();
  private _inputRef = React.createRef<HTMLTextAreaElement>();
  private _resizing = false;
  private _countdownInterval: any = null;

  state = {
    thread: FocusedContentStore.focused('thread'),
    turns: [] as Turn[],
    input: '',
    busy: false,
    retrieved: [] as RetrievedSource[],
    citedSources: [] as RetrievedSource[],
    sessionId: AIConfig.getCurrentSession(),
    open: AIConfig.isPanelOpen(),
    width: AIConfig.getPanelWidth(),
    showHistory: false,
    historyItems: [] as Array<{
      sessionId: string;
      subject: string;
      preview: string;
      lastAt: number;
      count: number;
    }>,
    pendingEmail: null,
  };

  private _chatStore(): ChatStore {
    if (!this.__chatStore) {
      const path = require('path');
      this.__chatStore = new ChatStore(
        path.join(AppEnv.getConfigDirPath(), 'ai-chat.db'),
        path.join(AppEnv.getConfigDirPath(), 'ai-index.db')
      );
    }
    return this.__chatStore;
  }

  private _loadHistory(): Turn[] {
    try {
      return this._chatStore()
        .history(this.state.sessionId)
        .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));
    } catch {
      return [];
    }
  }

  private _scrollToBottom() {
    const el = this._scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  componentDidMount() {
    // Load the single global conversation history.
    const turns = this._loadHistory();
    if (turns.length) this.setState({ turns });

    this._unsub = FocusedContentStore.listen(() => {
      const thread = FocusedContentStore.focused('thread');
      if (thread !== this.state.thread) {
        // Only update the thread reference used for context injection.
        // The conversation history is global and never resets on thread switch.
        this.setState({ thread, retrieved: [], citedSources: [] });
      }
    });
    this._configSub1 = AppEnv.config.onDidChange(AIConfig.keys.panelOpen, () => {
      this.setState({ open: AIConfig.isPanelOpen() });
    });
    this._configSub2 = AppEnv.config.onDidChange(AIConfig.keys.panelWidth, () => {
      this.setState({ width: AIConfig.getPanelWidth() });
    });
  }

  componentDidUpdate(_: any, prev: any) {
    if (this.state.turns !== prev.turns) this._scrollToBottom();
  }

  componentWillUnmount() {
    if (this._unsub) this._unsub();
    if (this._abort) this._abort.abort();
    if (this._configSub1) this._configSub1.dispose();
    if (this._configSub2) this._configSub2.dispose();
    if (this._countdownInterval) clearInterval(this._countdownInterval);
    this._stopResize();
  }

  // ─── Resize handle ─────────────────────────────────────────────────────────

  _startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = this.state.width;
    this._resizing = true;

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(280, Math.min(900, startWidth + (startX - ev.clientX)));
      this.setState({ width: newWidth });
    };
    const onUp = () => {
      AppEnv.config.set(AIConfig.keys.panelWidth, this.state.width);
      this._stopResize();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    (this as any)._onMove = onMove;
    (this as any)._onUp = onUp;
  };

  _stopResize() {
    if ((this as any)._onMove) document.removeEventListener('mousemove', (this as any)._onMove);
    if ((this as any)._onUp) document.removeEventListener('mouseup', (this as any)._onUp);
    this._resizing = false;
  }

  // ─── History ───────────────────────────────────────────────────────────────

  _openHistory = () => {
    const summaries = this._chatStore().conversationSummaries();
    const items = summaries.map((s) => ({
      sessionId: s.sessionId,
      subject: s.title || localized('Conversation'),
      preview: s.preview,
      lastAt: s.lastAt,
      count: s.count,
    }));
    this.setState({ showHistory: true, historyItems: items });
  };

  _resumeConversation = (sessionId: string) => {
    let turns: Turn[] = [];
    try {
      turns = this._chatStore()
        .history(sessionId)
        .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));
    } catch {
      /* ignore */
    }
    AppEnv.config.set(AIConfig.keys.currentSession, sessionId);
    this.setState({ showHistory: false, sessionId, turns });
  };

  _deleteConversation = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const { response } = await require('@electron/remote').dialog.showMessageBox({
      type: 'warning',
      buttons: [localized('Delete'), localized('Cancel')],
      defaultId: 1,
      cancelId: 1,
      message: localized('Delete this conversation?'),
      detail: localized('This cannot be undone.'),
    });
    if (response !== 0) return;
    this._chatStore().clearThread(sessionId);
    const historyItems = this.state.historyItems.filter((i) => i.sessionId !== sessionId);
    this.setState({ historyItems });
    // If the deleted conversation is the one currently open, start a fresh session so
    // the panel doesn't keep showing turns whose history record no longer exists.
    if (sessionId === this.state.sessionId) {
      const fresh = AIConfig.newSession();
      this.setState({ sessionId: fresh, turns: [], retrieved: [], citedSources: [] });
    }
  };

  _clearAllHistory = async () => {
    const { response } = await require('@electron/remote').dialog.showMessageBox({
      type: 'warning',
      buttons: [localized('Clear All'), localized('Cancel')],
      defaultId: 1,
      cancelId: 1,
      message: localized('Clear all conversation history?'),
      detail: localized('This deletes every saved AI conversation and cannot be undone.'),
    });
    if (response !== 0) return;
    this._chatStore().clearAll();
    const fresh = AIConfig.newSession();
    this.setState({
      historyItems: [],
      sessionId: fresh,
      turns: [],
      retrieved: [],
      citedSources: [],
    });
  };

  // ─── Email countdown ────────────────────────────────────────────────────────

  _showEmailCountdown = (data: {
    to: string;
    subject: string;
    body: string;
  }): Promise<'send' | 'cancel' | 'compose'> => {
    return new Promise((resolve) => {
      if (this._countdownInterval) {
        clearInterval(this._countdownInterval);
        this._countdownInterval = null;
      }
      this.setState({ pendingEmail: { ...data, secondsLeft: 30, resolve } });
      this._countdownInterval = setInterval(() => {
        // Read committed state directly — setInterval runs outside React's batch so
        // this.state always reflects the latest committed state here.
        const pe = this.state.pendingEmail;
        if (!pe) {
          clearInterval(this._countdownInterval);
          this._countdownInterval = null;
          return;
        }
        if (pe.secondsLeft <= 1) {
          clearInterval(this._countdownInterval);
          this._countdownInterval = null;
          this._resolveEmailCountdown('send');
          return;
        }
        this.setState((prev: any) => {
          if (!prev.pendingEmail) return null;
          return {
            pendingEmail: { ...prev.pendingEmail, secondsLeft: prev.pendingEmail.secondsLeft - 1 },
          };
        });
      }, 1000);
    });
  };

  _resolveEmailCountdown = (result: 'send' | 'cancel' | 'compose') => {
    if (this._countdownInterval) {
      clearInterval(this._countdownInterval);
      this._countdownInterval = null;
    }
    const { pendingEmail } = this.state;
    if (pendingEmail) {
      this.setState({ pendingEmail: null });
      pendingEmail.resolve(result);
    }
  };

  _renderEmailCountdown() {
    const { pendingEmail } = this.state;
    if (!pendingEmail) return null;
    const progress = pendingEmail.secondsLeft / 30;
    const r = 16;
    const circ = 2 * Math.PI * r;
    return (
      <div className="ai-pending-email">
        <div className="ai-pending-email-header">
          <div className="ai-pending-email-countdown">
            <svg width="40" height="40" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r={r} className="ai-countdown-bg" />
              <circle
                cx="20"
                cy="20"
                r={r}
                className="ai-countdown-ring"
                strokeDasharray={`${progress * circ} ${circ}`}
                transform="rotate(-90 20 20)"
              />
              <text x="20" y="25" textAnchor="middle" className="ai-countdown-num">
                {pendingEmail.secondsLeft}
              </text>
            </svg>
          </div>
          <div className="ai-pending-email-info">
            <div className="ai-pending-email-to">
              <strong>To:</strong> {pendingEmail.to}
            </div>
            <div className="ai-pending-email-subject">
              <strong>Subject:</strong> {pendingEmail.subject}
            </div>
          </div>
        </div>
        <div className="ai-pending-email-preview">
          {pendingEmail.body.slice(0, 800)}
          {pendingEmail.body.length > 800 ? '...' : ''}
        </div>
        <div className="ai-pending-email-actions">
          <button
            className="ai-pending-send-now"
            onClick={() => this._resolveEmailCountdown('send')}
          >
            {localized('Send Now')}
          </button>
          <button
            className="ai-pending-edit"
            onClick={() => this._resolveEmailCountdown('compose')}
          >
            {localized('Edit in Composer')}
          </button>
          <button
            className="ai-pending-cancel"
            onClick={() => this._resolveEmailCountdown('cancel')}
          >
            {localized('Cancel')}
          </button>
        </div>
      </div>
    );
  }

  // ─── Messaging ─────────────────────────────────────────────────────────────

  // The account identity to write/reply/send as - the focused thread's account when one
  // is open, otherwise the currently focused mailbox perspective's account. Without this
  // the LLM has no way to tell the account owner apart from other thread participants.
  _sender(): SenderIdentity | undefined {
    const thread = this.state.thread;
    const accountId = thread?.accountId || FocusedPerspectiveStore.current().accountIds[0];
    const account = accountId ? AccountStore.accountForId(accountId) : null;
    if (!account) return undefined;
    const me = account.defaultMe();
    return { name: me.name, email: me.email };
  }

  _send = async (text?: string) => {
    const q = (text ?? this.state.input).trim();
    if (!q || this.state.busy) return;
    if (!(await ensurePrivacyNoticeAccepted())) return;
    const turns: Turn[] = [
      ...this.state.turns,
      { role: 'user', content: q },
      { role: 'assistant', content: '' },
    ];
    this.setState({ turns, input: '', busy: true, retrieved: [], citedSources: [] });

    this._chatStore().append(this.state.sessionId, 'user', q, []);
    const currentThreadId = this.state.thread?.id;
    if (currentThreadId) ChatActivityStore.setActive(currentThreadId, true);

    this._abort = new AbortController();
    try {
      // Always include thread messages when a thread is focused.
      const threadMessages = await loadThreadMessages(this.state.thread);
      const history: ChatMessage[] = this.state.turns.map((t) => ({
        role: t.role,
        content: t.content,
      }));
      let retrieved: RetrievedSource[] = [];
      try {
        const { Indexer } = require('./indexer');
        if (AIConfig.isKnowledgeBaseEnabled() && Indexer.store()) {
          retrieved = await retrieve(q, Indexer.store());
        }
      } catch {
        // indexer not yet available
      }
      const thread = this.state.thread;
      const prompt = buildChatPrompt({
        question: q,
        threadMessages,
        history,
        retrieved,
        threadId: thread?.id,
        threadSubject: thread?.subject || undefined,
        sender: this._sender(),
      });
      let answer = '';
      const { Skills } = require('./skills/registry');
      const { runAgent } = require('./agent');

      if (Skills.list().length > 0 && AIConfig.getProvider() !== 'claude-cli') {
        const agentOut = await runAgent({
          messages: prompt,
          registry: Skills,
          callModel: async (msgs: any[], tools: any[]) => {
            const priorContent = turns[turns.length - 1].content;
            const doStream = (t: any[]) =>
              AIService.chatWithToolsStream({
                messages: msgs,
                tools: t,
                signal: this._abort?.signal,
                onToken: (tok: string) => {
                  tok && (answer += tok);
                  turns[turns.length - 1].content += tok;
                  this.setState({ turns: [...turns] });
                },
              }).then((r) => {
                if (r.tool_calls?.length) {
                  answer = '';
                  turns[turns.length - 1].content = priorContent;
                  this.setState({ turns: [...turns] });
                }
                return r;
              });
            try {
              return await doStream(tools);
            } catch (err: any) {
              // Some local LLM servers reject tool schemas (Jinja2 template parse error).
              // Surface a clear message rather than silently falling back to plain chat,
              // which would make the AI claim to perform actions it cannot execute.
              if (tools.length && /parser|template|function.call|tool/i.test(err?.message || '')) {
                throw new Error(
                  'Skills require function calling, which your AI model does not support. ' +
                    'To use Send Email, Move to Trash, etc., switch to a model with tool-use support ' +
                    '(e.g. gpt-4o, claude-3-haiku, llama-3.1 with tools). ' +
                    'To chat without skills, disable them in Preferences > AI Assistant > Agent skills.'
                );
              }
              throw err;
            }
          },
          confirm: async (skill: any, args: any, ctx: any) => {
            if (skill.confirmDialog) return skill.confirmDialog(args, ctx);
            const { response } = await require('@electron/remote').dialog.showMessageBox({
              type: 'question',
              buttons: ['Allow', 'Deny'],
              message: `AI wants to run: ${skill.name}`,
              detail: JSON.stringify(args, null, 2).slice(0, 500),
            });
            return response === 0 ? 'proceed' : 'deny';
          },
          confirmMany: async (skill: any, argsArray: any[], ctx: any) => {
            if (skill.confirmManyDialog) return skill.confirmManyDialog(argsArray, ctx);
            // Fallback: use the single-item dialog for the first item (and the batch proceeds
            // together). This is only hit for skills that don't implement confirmManyDialog.
            if (skill.confirmDialog) return skill.confirmDialog(argsArray[0], ctx);
            return 'deny';
          },
          ctx: { thread, showEmailCountdown: this._showEmailCountdown },
          signal: this._abort?.signal,
          maxSteps: AIConfig.getMaxAgentSteps(),
          onToolStep: (step: any) => {
            answer = '';
            turns[turns.length - 1].content = `🔧 ${step.name}…`;
            this.setState({ turns: [...turns] });
          },
        });
        answer = agentOut.answer;
        turns[turns.length - 1].content = answer;
        this.setState({ turns: [...turns] });
      } else {
        for await (const tok of AIService.chatStream({
          messages: prompt,
          signal: this._abort?.signal,
        })) {
          tok && (answer += tok);
          turns[turns.length - 1].content += tok;
          this.setState({ turns: [...turns] });
        }
      }
      const { citedSources } = validateCitations(answer, retrieved);
      this.setState({ retrieved, citedSources });
      this._chatStore().append(
        this.state.sessionId,
        'assistant',
        answer,
        citedSources.map((s) => s.messageId)
      );
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      turns[turns.length - 1].content = `⚠️ ${err.message || err}`;
      this.setState({ turns: [...turns] });
    } finally {
      if (currentThreadId) ChatActivityStore.setActive(currentThreadId, false);
      this.setState({ busy: false });
    }
  };

  _cancel = () => {
    if (this._abort) this._abort.abort();
    this._abort = null;
    this.setState({ busy: false });
  };

  _clearHistory = () => {
    // Start a new session — old conversation stays in history.
    const sessionId = AIConfig.newSession();
    this.setState({ turns: [], retrieved: [], citedSources: [], sessionId });
  };

  _draftReply = async (content?: string) => {
    const text =
      content ?? [...this.state.turns].reverse().find((t) => t.role === 'assistant')?.content ?? '';
    if (!text || !this.state.thread || this._composing) return;
    this._composing = true;
    try {
      const messages: any[] = await this.state.thread.messages({ includeHidden: false });
      if (!messages?.length) return;
      const draft = await DraftFactory.createDraftForReply({
        thread: this.state.thread,
        message: messages[messages.length - 1],
        type: 'reply',
      });

      // Strip AI framing added after send_email / create_draft tool calls:
      //   **Subject:** <subject>          ← header line
      //   <body>
      //   ---                             ← separator
      //   *Email sent.* / *Draft opened…* ← footer
      let body = text;
      body = body.replace(/^\*\*Subject:\*\*[^\n]*\n?/, '').trimStart();
      const hrIdx = body.search(/\n---\n/);
      if (hrIdx !== -1) body = body.slice(0, hrIdx);
      body = body.trim();

      const escaped = body
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>');
      const rawHtml = `<div>${escaped}</div>`;
      // createDraftForReply already populated draft.body with the quoted original message
      // (attribution line + blockquote) - prepend the AI reply above it instead of
      // overwriting, so the quoted thread the user is replying to isn't lost.
      draft.body = SanitizeTransformer.runSync(rawHtml) + (draft.body || '');
      const task = new SyncbackDraftTask({ draft });
      Actions.queueTask(task);
      await TaskQueue.waitForPerformLocal(task);
      Actions.composePopoutDraft(draft.headerMessageId);
    } finally {
      this._composing = false;
    }
  };

  _openSourceThread = (s: RetrievedSource) => {
    DatabaseStore.find<Thread>(Thread, s.threadId).then((thread) => {
      if (thread) Actions.setFocus({ collection: 'thread', item: thread });
    });
  };

  render() {
    const { open, width } = this.state;
    if (!open) return <div style={{ width: 0, flexShrink: 0 }} />;
    return this._renderPanel(width);
  }

  _renderHistory() {
    const { historyItems } = this.state;

    const formatDate = (ts: number) => {
      const d = new Date(ts);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / 86400000);
      if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    return (
      <div className="ai-history-panel">
        <div className="ai-history-header">
          <span>{localized('Conversation History')}</span>
          <span className="ai-history-count">
            {historyItems.length === 0
              ? localized('No conversations yet')
              : localized('%@ conversations', historyItems.length)}
          </span>
          {historyItems.length > 0 && (
            <button className="ai-history-clear-all-btn" onClick={this._clearAllHistory}>
              {localized('Clear All')}
            </button>
          )}
        </div>
        {historyItems.length === 0 ? (
          <div className="ai-history-empty">
            {localized('Start a conversation on any thread to see it here.')}
          </div>
        ) : (
          <div className="ai-history-list">
            {historyItems.map((item) => (
              <div key={item.sessionId} className="ai-history-item">
                <div className="ai-history-item-meta">
                  <span className="ai-history-subject">{item.subject}</span>
                  <span className="ai-history-date">{formatDate(item.lastAt)}</span>
                </div>
                <div className="ai-history-preview">{item.preview}</div>
                <div className="ai-history-item-footer">
                  <span className="ai-history-turns">{localized('%@ messages', item.count)}</span>
                  <div className="ai-history-item-actions">
                    <button
                      className="ai-history-delete-btn"
                      title={localized('Delete conversation')}
                      onClick={(e) => this._deleteConversation(item.sessionId, e)}
                    >
                      {localized('Delete')}
                    </button>
                    <button
                      className="ai-history-resume-btn"
                      onClick={() => this._resumeConversation(item.sessionId)}
                    >
                      {localized('Resume')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  _renderPanel(width: number) {
    const { turns, busy, input, citedSources, thread, showHistory } = this.state;
    const followUps =
      !busy && turns.length > 0 && turns[turns.length - 1].role === 'assistant'
        ? getFollowUpSuggestions(turns, !!thread)
        : [];
    const modelName =
      AIConfig.getProvider() === 'claude-cli'
        ? AIConfig.getClaudeCliModel() || localized('Claude CLI (default)')
        : AIConfig.getModel();

    return (
      <div className="ai-float-panel" style={{ width }}>
        <div className="ai-resize-handle" onMouseDown={this._startResize} />
        {/* Header */}
        <div className="ai-panel-header">
          <div className="ai-model-badge" title={localized('Model: %@', modelName)}>
            <span className="ai-sparkle">✦</span>
            <div className="ai-header-info">
              {thread && (
                <span className="ai-thread-subject">
                  {thread.subject || localized('(no subject)')}
                </span>
              )}
              <span className="ai-model-name">{modelName}</span>
            </div>
          </div>
          <div className="ai-header-controls">
            <button
              className={`ai-history-btn${showHistory ? ' active' : ''}`}
              title={localized('Conversation history')}
              onClick={() =>
                showHistory ? this.setState({ showHistory: false }) : this._openHistory()
              }
            >
              ☰
            </button>
            <button
              className="ai-clear-btn"
              title={localized('Clear conversation')}
              onClick={this._clearHistory}
            >
              ↺
            </button>
            <button
              className="ai-close-btn"
              title={localized('Close AI panel')}
              onClick={() => AppEnv.config.set(AIConfig.keys.panelOpen, false)}
            >
              ✕
            </button>
          </div>
        </div>

        {showHistory ? (
          this._renderHistory()
        ) : (
          <>
            {/* Messages */}
            <div className="ai-chat-scroll" ref={this._scrollRef}>
              {!thread && (
                <div className="ai-empty-state">
                  <div className="ai-empty-icon">✦</div>
                  <div className="ai-empty-title">{localized('AI Assistant')}</div>
                  <div className="ai-empty-hint">
                    {localized('Ask about your mailbox, or open a thread to chat about it.')}
                  </div>
                  {turns.length === 0 && (
                    <div className="ai-suggestions">
                      {getInitialSuggestions(null).map((s) => (
                        <button
                          key={s}
                          className="ai-suggestion-chip"
                          onClick={() => this._send(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {thread && turns.length === 0 && (
                <div className="ai-suggestions">
                  {getInitialSuggestions(thread).map((s) => (
                    <button key={s} className="ai-suggestion-chip" onClick={() => this._send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {turns.map((t, i) => {
                const isLastTurn = i === turns.length - 1;
                const isStreaming = busy && isLastTurn;
                const canAct = t.content && !isStreaming;
                return (
                  <div key={i} className={`ai-turn ${t.role}`}>
                    {t.role === 'assistant' && <span className="ai-avatar">✦</span>}
                    <div className="ai-turn-body">
                      <div className="ai-bubble">
                        {t.role === 'assistant' ? (
                          <>
                            {t.content ? renderMarkdown(t.content) : null}
                            {isStreaming && <span className="ai-cursor">▊</span>}
                          </>
                        ) : (
                          t.content || '​'
                        )}
                      </div>
                      {canAct && t.role === 'assistant' && thread && (
                        <button
                          className="ai-bubble-draft-btn"
                          onClick={() => this._draftReply(t.content)}
                        >
                          {localized('Use as draft reply')}
                        </button>
                      )}
                    </div>
                    {canAct && (
                      <div className="ai-turn-actions">
                        <button
                          className="ai-turn-action-btn"
                          title={localized('Copy')}
                          onClick={() => require('electron').clipboard.writeText(t.content)}
                        >
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        </button>
                        {t.role === 'user' && (
                          <button
                            className="ai-turn-action-btn"
                            title={localized('Retry')}
                            onClick={() => {
                              const newTurns = turns.slice(0, i);
                              this.setState({ turns: newTurns }, () => this._send(t.content));
                            }}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="1 4 1 10 7 10" />
                              <path d="M3.51 15a9 9 0 1 0 .49-4.91" />
                            </svg>
                          </button>
                        )}
                        {t.role === 'assistant' && isLastTurn && (
                          <button
                            className="ai-turn-action-btn"
                            title={localized('Retry')}
                            onClick={() => {
                              const lastUser = [...turns]
                                .slice(0, i)
                                .reverse()
                                .find((x) => x.role === 'user');
                              if (!lastUser) return;
                              const newTurns = turns.slice(0, i - 1);
                              this.setState({ turns: newTurns }, () =>
                                this._send(lastUser.content)
                              );
                            }}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="1 4 1 10 7 10" />
                              <path d="M3.51 15a9 9 0 1 0 .49-4.91" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {citedSources.length > 0 && (
                <div className="ai-sources">
                  <span className="ai-sources-label">{localized('Sources:')}</span>
                  {citedSources.map((s) => (
                    <button
                      key={s.id}
                      className="ai-source-chip"
                      onClick={() => this._openSourceThread(s)}
                    >
                      {s.sender}: {s.subject}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Follow-up suggestion pills */}
            {followUps.length > 0 && (
              <div className="ai-followup-chips">
                {followUps.map((s) => (
                  <button key={s} className="ai-followup-chip" onClick={() => this._send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Email countdown card */}
            {this._renderEmailCountdown()}

            {/* Input */}
            <div className="ai-chat-input">
              <textarea
                ref={this._inputRef}
                value={input}
                placeholder={localized('Ask anything… (Enter to send, Shift+Enter for newline)')}
                onChange={(e) => this.setState({ input: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this._send();
                  }
                }}
                disabled={busy}
                rows={2}
              />
              <div className="ai-input-row">
                {busy ? (
                  <button className="ai-send-btn cancel" onClick={this._cancel}>
                    {localized('Stop')}
                  </button>
                ) : (
                  <button
                    className="ai-send-btn"
                    onClick={() => this._send()}
                    disabled={!input.trim()}
                  >
                    {localized('Send')}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
}
