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

// ─── AI Panel Toggle Button ───────────────────────────────────────────────────

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

  _toggle = () => {
    AppEnv.config.set(AIConfig.keys.panelOpen, !this.state.open);
  };

  render() {
    return (
      <button
        title={localized('Toggle AI chat panel')}
        className={`btn btn-toolbar ai-toggle-btn ${this.state.open ? 'active' : ''}`}
        onClick={this._toggle}
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
  }
> {
  static displayName = 'AIChatPanel';

  _unsub: () => void;
  _configSub1: { dispose: () => void } | null = null;
  _configSub2: { dispose: () => void } | null = null;
  _abort: AbortController | null = null;
  _composing = false;
  // Tracks in-progress streams for threads the user has navigated away from.
  // Key: threadId, Value: { turns, busy } — restored when user switches back.
  private _pendingByThread: Map<string, { turns: Turn[]; busy: boolean }> = new Map();
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
  };

  private _chatStore(): ChatStore {
    if (!this.__chatStore) {
      this.__chatStore = new ChatStore(
        require('path').join(AppEnv.getConfigDirPath(), 'ai-index.db')
      );
    }
    return this.__chatStore;
  }

  private _loadHistory(threadId: string): Turn[] {
    try {
      return this._chatStore()
        .history(threadId)
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
    const { thread } = this.state;
    if (thread) {
      const turns = this._loadHistory(thread.id);
      this.setState({ turns });
      if (turns.length) ChatActivityStore.setHasHistory(thread.id, true);
    }
    // Seed the activity store with all threads that already have persisted chat history.
    try {
      this._chatStore()
        .threadIdsWithHistory()
        .forEach((id) => ChatActivityStore.setHasHistory(id, true));
    } catch {
      // DB not yet ready (first run) — ignore
    }
    this._unsub = FocusedContentStore.listen(() => {
      const thread = FocusedContentStore.focused('thread');
      if (thread !== this.state.thread) {
        // Stash current in-progress state so we can restore it if the user comes back.
        const prevId = this.state.thread?.id;
        if (prevId && this.state.busy) {
          this._pendingByThread.set(prevId, { turns: this.state.turns, busy: true });
        }
        // Restore any pending stream for the incoming thread, or load persisted history.
        const newId = thread?.id;
        const pending = newId ? this._pendingByThread.get(newId) : undefined;
        if (pending) {
          this._pendingByThread.delete(newId!);
          this.setState({
            thread,
            turns: pending.turns,
            busy: pending.busy,
            retrieved: [],
            citedSources: [],
          });
        } else {
          const turns = thread ? this._loadHistory(thread.id) : [];
          this.setState({ thread, turns, busy: false, retrieved: [], citedSources: [] });
        }
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
      const newWidth = Math.max(300, Math.min(700, startWidth + (startX - ev.clientX)));
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

    // Capture the thread this request belongs to.
    const targetThreadId = this.state.thread?.id;
    const isActive = () => this.state.thread?.id === targetThreadId;
    // Keep the stash in sync so switching back mid-stream shows live progress.
    const syncPending = () => {
      if (!isActive() && targetThreadId) {
        this._pendingByThread.set(targetThreadId, { turns: [...turns], busy: true });
      }
    };

    if (targetThreadId) {
      this._chatStore().append(targetThreadId, 'user', q, []);
      ChatActivityStore.setHasHistory(targetThreadId, true);
      ChatActivityStore.setActive(targetThreadId, true);
    }

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
      const prompt = buildChatPrompt({
        question: q,
        threadMessages,
        history,
        retrieved,
      });
      let answer = '';
      const { Skills } = require('./skills/registry');
      const { runAgent } = require('./agent');

      if (Skills.list().length > 0) {
        const agentOut = await runAgent({
          messages: prompt,
          registry: Skills,
          callModel: (msgs: any[], tools: any[]) => {
            const priorContent = turns[turns.length - 1].content;
            return AIService.chatWithToolsStream({
              messages: msgs,
              tools,
              signal: this._abort?.signal,
              onToken: (tok: string) => {
                tok && (answer += tok);
                turns[turns.length - 1].content += tok;
                if (isActive()) this.setState({ turns: [...turns] });
                else syncPending();
              },
            }).then((r) => {
              if (r.tool_calls?.length) {
                answer = '';
                turns[turns.length - 1].content = priorContent;
                if (isActive()) this.setState({ turns: [...turns] });
                else syncPending();
              }
              return r;
            });
          },
          confirm: async (skillName: string, args: any) => {
            const { response } = await require('@electron/remote').dialog.showMessageBox({
              type: 'question',
              buttons: ['Allow', 'Deny'],
              message: `AI wants to run: ${skillName}`,
              detail: JSON.stringify(args, null, 2).slice(0, 500),
            });
            return response === 0;
          },
          signal: this._abort?.signal,
          maxSteps: AIConfig.getMaxAgentSteps(),
          onToolStep: (step: any) => {
            answer = '';
            turns[turns.length - 1].content = `🔧 ${step.name}…`;
            if (isActive()) this.setState({ turns: [...turns] });
            else syncPending();
          },
        });
        answer = agentOut.answer;
        turns[turns.length - 1].content = answer;
        if (isActive()) this.setState({ turns: [...turns] });
      } else {
        for await (const tok of AIService.chatStream({
          messages: prompt,
          signal: this._abort?.signal,
        })) {
          tok && (answer += tok);
          turns[turns.length - 1].content += tok;
          if (isActive()) this.setState({ turns: [...turns] });
          else syncPending();
        }
      }
      const { citedSources } = validateCitations(answer, retrieved);
      if (isActive()) this.setState({ retrieved, citedSources });
      if (targetThreadId) {
        this._chatStore().append(
          targetThreadId,
          'assistant',
          answer,
          citedSources.map((s) => s.messageId)
        );
        this._pendingByThread.delete(targetThreadId);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      turns[turns.length - 1].content = `⚠️ ${err.message || err}`;
      if (isActive()) this.setState({ turns: [...turns] });
      else syncPending();
    } finally {
      if (targetThreadId) {
        this._pendingByThread.delete(targetThreadId);
        ChatActivityStore.setActive(targetThreadId, false);
      }
      if (isActive()) this.setState({ busy: false });
    }
  };

  _cancel = () => {
    if (this._abort) this._abort.abort();
    this._abort = null;
    this.setState({ busy: false });
  };

  _clearHistory = () => {
    const threadId = this.state.thread?.id;
    if (threadId) {
      try {
        this._chatStore().clearThread(threadId);
      } catch {
        /* ignore */
      }
      ChatActivityStore.setHasHistory(threadId, false);
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

  _renderPanel(width: number) {
    const { scope, turns, busy, input, citedSources, thread } = this.state;
    const hasReplySuggestion = turns.some((t) => t.role === 'assistant' && t.content);
    const modelName = AIConfig.getModel();

    return (
      <div className="ai-float-panel" style={{ width }}>
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

        {/* Messages */}
        <div className="ai-chat-scroll" ref={this._scrollRef}>
          {!thread && (
            <div className="ai-empty-state">
              <div className="ai-empty-icon">✦</div>
              <div className="ai-empty-title">{localized('AI Assistant')}</div>
              <div className="ai-empty-hint">{localized('Open a thread to start chatting.')}</div>
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
                    t.content || (busy && isLastTurn ? <span className="ai-cursor">▊</span> : '​')
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
                          this.setState({ turns: newTurns }, () => this._send(lastUser.content));
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
              <button className="ai-send-btn" onClick={() => this._send()} disabled={!input.trim()}>
                {localized('Send')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
