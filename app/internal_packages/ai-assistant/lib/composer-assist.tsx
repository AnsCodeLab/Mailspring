import React from 'react';
import { localized, SanitizeTransformer } from 'mailspring-exports';
import { AIService } from './ai-service';
import { buildRewritePrompt, buildReplyPrompt } from './prompts';
import { suggestNextLine } from './next-line';
import { ensurePrivacyNoticeAccepted } from './privacy-notice';

type CommandKey =
  | 'reply'
  | 'rewrite'
  | 'shorter'
  | 'longer'
  | 'formal'
  | 'casual'
  | 'grammar'
  | 'nextline';

const COMMANDS: Array<{ key: CommandKey; label: string }> = [
  { key: 'reply', label: 'Draft a reply' },
  { key: 'rewrite', label: 'Rewrite' },
  { key: 'shorter', label: 'Make shorter' },
  { key: 'longer', label: 'Make longer' },
  { key: 'formal', label: 'More formal' },
  { key: 'casual', label: 'More casual' },
  { key: 'grammar', label: 'Fix grammar' },
  { key: 'nextline', label: 'Suggest next line' },
];

export default class AIComposerAssist extends React.Component<
  any,
  { open: boolean; busy: boolean }
> {
  static displayName = 'AIComposerAssist'; // required by ComponentRegistry.register
  state = { open: false, busy: false };

  _run = async (key: CommandKey) => {
    this.setState({ open: false });
    if (!(await ensurePrivacyNoticeAccepted())) return;
    const { draft, session } = this.props;
    const currentText = (draft.body || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (key === 'nextline') {
      this.setState({ busy: true });
      try {
        const s = await suggestNextLine(draft.body);
        session.changes.add({
          body: (draft.body || '') + SanitizeTransformer.runSync('<span>' + s + '</span>'),
        });
      } catch (err: any) {
        AppEnv.showErrorDialog(err.message || String(err));
      } finally {
        this.setState({ busy: false });
      }
      return;
    }
    let messages;
    if (key === 'reply')
      messages = buildReplyPrompt({
        threadMessages: [{ from: 'me', date: '', text: currentText }],
        instruction: '',
      });
    else messages = buildRewritePrompt({ text: currentText, style: key });
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
