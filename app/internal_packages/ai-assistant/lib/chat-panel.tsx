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
import { buildChatPrompt } from './prompts';
import { loadThreadMessages } from './thread-context';
import { ensurePrivacyNoticeAccepted } from './privacy-notice';

type Turn = { role: 'user' | 'assistant'; content: string };

export default class AIChatPanel extends React.Component<
  Record<string, never>,
  { thread: any; turns: Turn[]; input: string; busy: boolean }
> {
  _unsub: () => void;
  _abort: AbortController | null = null;
  _composing = false;
  state = {
    thread: FocusedContentStore.focused('thread'),
    turns: [] as Turn[],
    input: '',
    busy: false,
  };

  componentDidMount() {
    this._unsub = FocusedContentStore.listen(() => {
      const thread = FocusedContentStore.focused('thread');
      if (thread !== this.state.thread) {
        if (this._abort) this._abort.abort();
        this.setState({ thread, turns: [], busy: false }); // ephemeral here; Task 14 persists per-thread
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
    this.setState({ turns, input: '', busy: true });
    this._abort = new AbortController();
    try {
      const threadMessages = await loadThreadMessages(this.state.thread);
      const history: ChatMessage[] = this.state.turns.map((t) => ({
        role: t.role,
        content: t.content,
      }));
      const prompt = buildChatPrompt({
        question: q,
        threadMessages,
        history,
        pinned: [],
        retrieved: [],
      });
      for await (const tok of AIService.chatStream({
        messages: prompt,
        signal: this._abort.signal,
      })) {
        turns[turns.length - 1].content += tok;
        this.setState({ turns: [...turns] });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // intentional cancel; turns reset by thread switch
      turns[turns.length - 1].content = `⚠️ ${err.message || err}`;
      this.setState({ turns: [...turns] });
    } finally {
      this.setState({ busy: false });
    }
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
    return (
      <div className="ai-chat-panel">
        <div className="ai-chat-scroll">
          {this.state.turns.map((t, i) => (
            <div key={i} className={`ai-turn ${t.role}`}>
              {t.content}
            </div>
          ))}
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
