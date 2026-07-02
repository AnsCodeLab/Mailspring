import React from 'react';
import ReactDOM from 'react-dom';
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

type State = {
  open: boolean;
  busy: boolean;
  menuStyle: React.CSSProperties | null;
};

export default class AIComposerAssist extends React.Component<any, State> {
  static displayName = 'AIComposerAssist';
  state: State = { open: false, busy: false, menuStyle: null };
  private _btnRef = React.createRef<HTMLButtonElement>();

  componentDidMount() {
    document.addEventListener('click', this._onDocClick);
  }

  componentWillUnmount() {
    document.removeEventListener('click', this._onDocClick);
  }

  _onDocClick = () => {
    if (this.state.open) this.setState({ open: false, menuStyle: null });
  };

  _toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (this.state.busy || this.state.open) {
      this.setState({ open: false, menuStyle: null });
      return;
    }
    const rect = this._btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Use position:fixed coords so the menu escapes any overflow:hidden or
    // CSS-transform ancestor in the composer panel layout.
    this.setState({
      open: true,
      menuStyle: {
        position: 'fixed',
        bottom: window.innerHeight - rect.top,
        left: rect.left,
        zIndex: 9999,
      },
    });
  };

  _run = async (key: CommandKey) => {
    this.setState({ open: false, menuStyle: null });
    if (!(await ensurePrivacyNoticeAccepted())) return;
    const { draft, session } = this.props;

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

    // For grammar: send the raw HTML body so the AI preserves paragraph
    // structure and returns corrected HTML directly.
    // For all other commands: strip to plain text first.
    const useHtml = key === 'grammar';
    const inputText = useHtml
      ? draft.body || ''
      : (draft.body || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

    let messages;
    if (key === 'reply') {
      messages = buildReplyPrompt({
        threadMessages: [{ from: 'me', date: '', text: inputText }],
        instruction: '',
      });
    } else {
      messages = buildRewritePrompt({ text: inputText, style: key, isHtml: useHtml });
    }

    this.setState({ busy: true });
    try {
      const result = await AIService.chat({ messages });
      // Grammar returns HTML directly; other commands return plain text.
      const html = useHtml
        ? SanitizeTransformer.runSync(result)
        : SanitizeTransformer.runSync(`<div>${result.replace(/\n/g, '<br/>')}</div>`);
      session.changes.add({ body: html });
    } catch (err: any) {
      AppEnv.showErrorDialog(err.message || String(err));
    } finally {
      this.setState({ busy: false });
    }
  };

  render() {
    const { open, busy, menuStyle } = this.state;

    const menu =
      open && menuStyle ? (
        <div className="ai-assist-menu" style={menuStyle}>
          {COMMANDS.map((c) => (
            <div key={c.key} className="item" onMouseDown={() => this._run(c.key)}>
              {localized(c.label)}
            </div>
          ))}
        </div>
      ) : null;

    return (
      <div className="composer-ai-assist">
        <button
          ref={this._btnRef}
          className="btn btn-toolbar"
          title={localized('AI assist')}
          disabled={busy}
          onClick={this._toggle}
        >
          {busy ? (
            <span className="ai-assist-spinner" aria-label={localized('Working')}>
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </span>
          ) : (
            '✨ AI'
          )}
        </button>
        {menu ? ReactDOM.createPortal(menu, document.body) : null}
      </div>
    );
  }
}
