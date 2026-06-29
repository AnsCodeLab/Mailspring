import React from 'react';
import { localized, SanitizeTransformer } from 'mailspring-exports';
import { AIService } from './ai-service';
import { buildRewritePrompt, buildReplyPrompt } from './prompts';
import { ensurePrivacyNoticeAccepted } from './privacy-notice';

const COMMANDS: Array<{ key: any; label: string }> = [
  { key: 'reply', label: 'Draft a reply' },
  { key: 'rewrite', label: 'Rewrite' },
  { key: 'shorter', label: 'Make shorter' },
  { key: 'longer', label: 'Make longer' },
  { key: 'formal', label: 'More formal' },
  { key: 'casual', label: 'More casual' },
  { key: 'grammar', label: 'Fix grammar' },
];

export default class AIComposerAssist extends React.Component<
  any,
  { open: boolean; busy: boolean }
> {
  state = { open: false, busy: false };

  _run = async (key: string) => {
    this.setState({ open: false });
    if (!(await ensurePrivacyNoticeAccepted())) return;
    const { draft, session } = this.props;
    const currentText = (draft.body || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let messages;
    if (key === 'reply')
      messages = buildReplyPrompt({
        threadMessages: [{ from: 'me', date: '', text: currentText }],
        instruction: '',
      });
    else messages = buildRewritePrompt({ text: currentText, style: key as any });
    this.setState({ busy: true });
    try {
      const result = await AIService.chat({ messages });
      const html = SanitizeTransformer.runSync(`<div>${result.replace(/\n/g, '<br/>')}</div>`);
      session.changes.add({ body: html }); // replace body with the AI result (undoable via the editor)
    } catch (err: any) {
      AppEnv.showErrorDialog(err.message || String(err));
    } finally {
      this.setState({ busy: false });
    }
  };

  render() {
    return (
      <div className="composer-ai-assist" style={{ position: 'relative' }}>
        <button
          className="btn btn-toolbar"
          title={localized('AI assist')}
          onClick={() => this.setState({ open: !this.state.open })}
        >
          {this.state.busy ? '✨…' : '✨ AI'}
        </button>
        {this.state.open && (
          <div
            className="ai-assist-menu"
            style={{ position: 'absolute', bottom: '100%', zIndex: 20 }}
          >
            {COMMANDS.map((c) => (
              <div key={c.key} className="item" onMouseDown={() => this._run(c.key)}>
                {localized(c.label)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
}
