import React from 'react';
import {
  FocusedContentStore,
  DraftFactory,
  Actions,
  TaskQueue,
  SyncbackDraftTask,
  SanitizeTransformer,
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
import { getPinned } from './pin-action';

type Turn = { role: 'user' | 'assistant'; content: string };

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
  }
> {
  static displayName = 'AIChatPanel'; // required by ComponentRegistry.register
  _unsub: () => void;
  _abort: AbortController | null = null;
  _composing = false;
  private __chatStore: ChatStore | null = null;

  state = {
    thread: FocusedContentStore.focused('thread'),
    turns: [] as Turn[],
    input: '',
    busy: false,
    retrieved: [] as RetrievedSource[],
    citedSources: [] as RetrievedSource[],
    scope: 'thread' as 'thread' | 'all',
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
        .map((r) => ({
          role: r.role as 'user' | 'assistant',
          content: r.content,
        }));
    } catch {
      return [];
    }
  }

  componentDidMount() {
    const { thread } = this.state;
    if (thread) {
      this.setState({ turns: this._loadHistory(thread.id) });
    }
    this._unsub = FocusedContentStore.listen(() => {
      const thread = FocusedContentStore.focused('thread');
      if (thread !== this.state.thread) {
        if (this._abort) this._abort.abort();
        const turns = thread ? this._loadHistory(thread.id) : [];
        this.setState({ thread, turns, busy: false, retrieved: [], citedSources: [] });
      }
    });
  }

  componentWillUnmount() {
    if (this._unsub) this._unsub();
    if (this._abort) this._abort.abort();
  }

  _send = async () => {
    const q = this.state.input.trim();
    if (!q || this.state.busy) return;
    if (!(await ensurePrivacyNoticeAccepted())) return;
    const turns: Turn[] = [
      ...this.state.turns,
      { role: 'user', content: q },
      { role: 'assistant', content: '' },
    ];
    this.setState({ turns, input: '', busy: true, retrieved: [], citedSources: [] });

    // Persist user turn immediately
    const threadId = this.state.thread?.id;
    if (threadId) {
      this._chatStore().append(threadId, 'user', q, []);
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
        pinned: getPinned(),
        retrieved,
      });
      let answer = '';
      for await (const tok of AIService.chatStream({
        messages: prompt,
        signal: this._abort.signal,
      })) {
        tok && (answer += tok);
        turns[turns.length - 1].content += tok;
        this.setState({ turns: [...turns] });
      }
      const { citedSources } = validateCitations(answer, retrieved);
      this.setState({ retrieved, citedSources });

      // Persist assistant turn with cited message IDs
      if (threadId) {
        this._chatStore().append(
          threadId,
          'assistant',
          answer,
          citedSources.map((s) => s.messageId)
        );
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // intentional cancel; turns reset by thread switch
      turns[turns.length - 1].content = `⚠️ ${err.message || err}`;
      this.setState({ turns: [...turns] });
    } finally {
      this.setState({ busy: false });
    }
  };

  _clearHistory = () => {
    const threadId = this.state.thread?.id;
    if (!threadId) return;
    try {
      this._chatStore().clearThread(threadId);
    } catch {
      // ignore
    }
    this.setState({ turns: [], retrieved: [], citedSources: [] });
  };

  _draftReply = async () => {
    const last = [...this.state.turns].reverse().find((t) => t.role === 'assistant');
    if (!last || !this.state.thread || this._composing) return;
    this._composing = true;
    try {
      // Get the last non-hidden message from the thread to reply to.
      const messages: any[] = await this.state.thread.messages({ includeHidden: false });
      if (!messages || messages.length === 0) return;
      const lastMessage = messages[messages.length - 1];

      // Create a reply draft pre-filled with quoting, then prepend the AI text.
      const draft = await DraftFactory.createDraftForReply({
        thread: this.state.thread,
        message: lastMessage,
        type: 'reply',
      });
      // AI/model output is untrusted (thread content fed to it is attacker-controlled);
      // sanitize before injecting into the draft body to prevent stored XSS.
      const rawHtml = `<div>${last.content.replace(/\n/g, '<br/>')}</div>`;
      const aiHtml = SanitizeTransformer.runSync(rawHtml);
      draft.body = aiHtml + (draft.body || '');

      // Persist the draft via the task system, then pop open the composer window.
      const task = new SyncbackDraftTask({ draft });
      Actions.queueTask(task);
      await TaskQueue.waitForPerformLocal(task);
      Actions.composePopoutDraft(draft.headerMessageId);
    } finally {
      this._composing = false;
    }
  };

  render() {
    if (!this.state.thread) {
      return (
        <div className="ai-chat-panel empty">{localized('Open a thread to chat about it.')}</div>
      );
    }
    const { scope } = this.state;
    return (
      <div className="ai-chat-panel">
        <div className="ai-chat-toolbar">
          <div className="ai-scope-toggle">
            <button
              className={`ai-scope-btn${scope === 'thread' ? ' active' : ''}`}
              onClick={() => this.setState({ scope: 'thread' })}
            >
              {localized('This thread')}
            </button>
            <button
              className={`ai-scope-btn${scope === 'all' ? ' active' : ''}`}
              onClick={() => this.setState({ scope: 'all' })}
            >
              {localized('All mail')}
            </button>
          </div>
          <button
            className="ai-clear-btn"
            title={localized('Clear conversation')}
            onClick={this._clearHistory}
          >
            {localized('Clear')}
          </button>
        </div>
        <div className="ai-chat-scroll">
          {this.state.turns.map((t, i) => (
            <div key={i} className={`ai-turn ${t.role}`}>
              {t.content}
            </div>
          ))}
          {this.state.citedSources.length > 0 && (
            <div className="ai-sources">
              {this.state.citedSources.map((s) => (
                <button
                  key={s.id}
                  className="ai-source-chip"
                  onClick={() => {
                    Actions.setFocus({ collection: 'thread', item: { id: s.threadId } });
                  }}
                >
                  [{s.id}] {s.sender} — {s.subject}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="ai-chat-actions">
          <button onClick={this._draftReply} disabled={this.state.busy || this._composing}>
            {localized('Draft reply')}
          </button>
        </div>
        <div className="ai-chat-input">
          <textarea
            value={this.state.input}
            placeholder={localized('Ask about this thread…')}
            onChange={(e) => this.setState({ input: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._send();
              }
            }}
          />
        </div>
      </div>
    );
  }
}
