import React from 'react';
import {
  FocusedContentStore,
  DraftFactory,
  Actions,
  TaskQueue,
  SyncbackDraftTask,
  SanitizeTransformer,
  DatabaseStore,
  Thread,
  localized,
} from 'mailspring-exports';
import { AIService, ChatMessage } from './ai-service';
import { buildChatPrompt, RetrievedSource } from './prompts';
import { loadThreadMessages } from './thread-context';
import { ensurePrivacyNoticeAccepted } from './privacy-notice';
import { retrieve } from './retriever';
import { validateCitations } from './citations';
import { AIConfig } from './config';
import { ChatStore } from './chat-store';
import { ChatActivityStore } from './chat-activity-store';

type Turn = { role: 'user' | 'assistant'; content: string };

// All chat messages are stored under one global key — switching threads only
// updates the context (which emails are loaded), not the conversation history.
const GLOBAL_CHAT_KEY = '__global__';

const SUGGESTIONS = [
  'Summarize this thread',
  'What action items are here?',
  'Draft a polite reply',
  "What's the main question being asked?",
];

// ─── Simple markdown renderer ──────────────────────────────────────────────────

function renderInline(text: string, key?: string | number): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[0].startsWith('**')) {
      parts.push(<strong key={`${key}-b${idx++}`}>{m[2]}</strong>);
    } else if (m[0].startsWith('*')) {
      parts.push(<em key={`${key}-i${idx++}`}>{m[3]}</em>);
    } else {
      parts.push(
        <code key={`${key}-c${idx++}`} className="ai-inline-code">
          {m[4]}
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
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length) {
      nodes.push(<ul key={`ul-${i}`}>{listItems}</ul>);
      listItems = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      flushList();
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

    if (/^#{1,3} /.test(line)) {
      flushList();
      const level = (line.match(/^#+/) || [''])[0].length;
      const content = line.slice(level + 1);
      const Tag = `h${Math.min(level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6';
      nodes.push(
        <Tag key={`h-${i}`} className="ai-md-heading">
          {renderInline(content, i)}
        </Tag>
      );
      i++;
      continue;
    }

    if (/^[-*] /.test(line)) {
      listItems.push(<li key={`li-${i}`}>{renderInline(line.slice(2), i)}</li>);
      i++;
      continue;
    }

    if (/^\d+\. /.test(line)) {
      flushList();
      nodes.push(
        <li key={`oli-${i}`} className="ai-ol-item">
          {renderInline(line.replace(/^\d+\. /, ''), i)}
        </li>
      );
      i++;
      continue;
    }

    if (line.trim() === '') {
      flushList();
      nodes.push(<div key={`br-${i}`} className="ai-para-gap" />);
      i++;
      continue;
    }

    flushList();
    nodes.push(<p key={`p-${i}`}>{renderInline(line, i)}</p>);
    i++;
  }
  flushList();
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
      <button
        title={localized('Toggle AI chat panel')}
        className={`btn btn-toolbar ai-toggle-btn ${this.state.open ? 'active' : ''}`}
        onClick={() => AppEnv.config.set(AIConfig.keys.panelOpen, !this.state.open)}
      >
        ✦ AI
      </button>
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
    scope: 'thread' | 'all';
    open: boolean;
    width: number;
    showHistory: boolean;
    historyItems: Array<{
      threadId: string;
      subject: string;
      preview: string;
      lastAt: number;
      count: number;
    }>;
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

  state = {
    thread: FocusedContentStore.focused('thread'),
    turns: [] as Turn[],
    input: '',
    busy: false,
    retrieved: [] as RetrievedSource[],
    citedSources: [] as RetrievedSource[],
    scope: 'thread' as 'thread' | 'all',
    open: AIConfig.isPanelOpen(),
    width: AIConfig.getPanelWidth(),
    showHistory: false,
    historyItems: [] as Array<{
      threadId: string;
      subject: string;
      preview: string;
      lastAt: number;
      count: number;
    }>,
  };

  private _chatStore(): ChatStore {
    if (!this.__chatStore) {
      this.__chatStore = new ChatStore(
        require('path').join(AppEnv.getConfigDirPath(), 'ai-index.db')
      );
    }
    return this.__chatStore;
  }

  private _loadHistory(): Turn[] {
    try {
      return this._chatStore()
        .history(GLOBAL_CHAT_KEY)
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

  _openHistory = async () => {
    const summaries = this._chatStore().conversationSummaries();
    const items = await Promise.all(
      summaries.map(async (s) => {
        let subject = s.threadId;
        try {
          const t = await DatabaseStore.find<Thread>(Thread, s.threadId);
          if (t) subject = t.subject || localized('(no subject)');
        } catch {
          // ignore
        }
        return { ...s, subject };
      })
    );
    this.setState({ showHistory: true, historyItems: items });
  };

  _resumeConversation = (threadId: string) => {
    DatabaseStore.find<Thread>(Thread, threadId).then((t) => {
      if (t) Actions.setFocus({ collection: 'thread', item: t });
    });
    this.setState({ showHistory: false });
  };

  // ─── Messaging ─────────────────────────────────────────────────────────────

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

    // Global conversation — always append under the single global key.
    this._chatStore().append(GLOBAL_CHAT_KEY, 'user', q, []);
    const currentThreadId = this.state.thread?.id;
    if (currentThreadId) ChatActivityStore.setActive(currentThreadId, true);

    this._abort = new AbortController();
    try {
      const threadMessages =
        this.state.scope === 'thread' ? await loadThreadMessages(this.state.thread) : [];
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
      });
      let answer = '';
      const { Skills } = require('./skills/registry');
      const { runAgent } = require('./agent');

      if (Skills.list().length > 0) {
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
          confirm: async (skill: any, args: any) => {
            if (skill.confirmDialog) return skill.confirmDialog(args);
            const { response } = await require('@electron/remote').dialog.showMessageBox({
              type: 'question',
              buttons: ['Allow', 'Deny'],
              message: `AI wants to run: ${skill.name}`,
              detail: JSON.stringify(args, null, 2).slice(0, 500),
            });
            return response === 0 ? 'proceed' : 'deny';
          },
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
        GLOBAL_CHAT_KEY,
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
    try {
      this._chatStore().clearThread(GLOBAL_CHAT_KEY);
    } catch {
      /* ignore */
    }
    this.setState({ turns: [], retrieved: [], citedSources: [] });
  };

  _draftReply = async () => {
    const last = [...this.state.turns].reverse().find((t) => t.role === 'assistant');
    if (!last || !this.state.thread || this._composing) return;
    this._composing = true;
    try {
      const messages: any[] = await this.state.thread.messages({ includeHidden: false });
      if (!messages?.length) return;
      const draft = await DraftFactory.createDraftForReply({
        thread: this.state.thread,
        message: messages[messages.length - 1],
        type: 'reply',
      });
      const rawHtml = `<div>${last.content.replace(/\n/g, '<br/>')}</div>`;
      draft.body = SanitizeTransformer.runSync(rawHtml);
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
        </div>
        {historyItems.length === 0 ? (
          <div className="ai-history-empty">
            {localized('Start a conversation on any thread to see it here.')}
          </div>
        ) : (
          <div className="ai-history-list">
            {historyItems.map((item) => (
              <div key={item.threadId} className="ai-history-item">
                <div className="ai-history-item-meta">
                  <span className="ai-history-subject">{item.subject}</span>
                  <span className="ai-history-date">{formatDate(item.lastAt)}</span>
                </div>
                <div className="ai-history-preview">{item.preview}</div>
                <div className="ai-history-item-footer">
                  <span className="ai-history-turns">{localized('%@ messages', item.count)}</span>
                  <button
                    className="ai-history-resume-btn"
                    onClick={() => this._resumeConversation(item.threadId)}
                  >
                    {localized('Resume')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  _renderPanel(width: number) {
    const { scope, turns, busy, input, citedSources, thread, showHistory } = this.state;
    const hasReplySuggestion = turns.some((t) => t.role === 'assistant' && t.content);
    const modelName = AIConfig.getModel();

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
            <div className="ai-scope-toggle">
              <button
                className={`ai-scope-btn ${scope === 'thread' ? 'active' : ''}`}
                onClick={() => this.setState({ scope: 'thread' })}
                title={localized('Chat about this thread only')}
              >
                {localized('Thread')}
              </button>
              <button
                className={`ai-scope-btn ${scope === 'all' ? 'active' : ''}`}
                onClick={() => this.setState({ scope: 'all' })}
                title={localized('Search across all mail')}
              >
                {localized('All mail')}
              </button>
            </div>
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
                    {localized('Open a thread to start chatting.')}
                  </div>
                </div>
              )}
              {thread && turns.length === 0 && (
                <div className="ai-suggestions">
                  {SUGGESTIONS.map((s) => (
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
                    <div className="ai-bubble">
                      {t.role === 'assistant' && t.content && !busy ? (
                        renderMarkdown(t.content)
                      ) : t.role === 'assistant' && busy && isLastTurn ? (
                        <>
                          {t.content ? renderMarkdown(t.content) : null}
                          <span className="ai-cursor">▊</span>
                        </>
                      ) : (
                        t.content ||
                        (busy && isLastTurn ? <span className="ai-cursor">▊</span> : '​')
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

            {/* Draft reply action */}
            {hasReplySuggestion && (
              <div className="ai-chat-actions">
                <button className="ai-action-btn" onClick={this._draftReply} disabled={busy}>
                  {localized('Use as draft reply')}
                </button>
              </div>
            )}

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
