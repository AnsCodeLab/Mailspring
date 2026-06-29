import React from 'react';
import { FocusedContentStore, localized } from 'mailspring-exports';
import { RetrievedSource } from './prompts';
import { loadThreadMessages } from './thread-context';

// Module-level pinned store shared with chat panel
const _pinned: RetrievedSource[] = [];
export function getPinned(): RetrievedSource[] {
  return _pinned;
}
export function clearPinned(): void {
  _pinned.length = 0;
}

export default class PinAction extends React.Component<any, { count: number }> {
  static displayName = 'PinAction'; // required by ComponentRegistry

  state = { count: _pinned.length };

  _pin = async () => {
    const thread = FocusedContentStore.focused('thread');
    if (!thread) return;
    const msgs = await loadThreadMessages(thread);
    // Add as pinned sources with a 'p' prefix to distinguish from retrieved sources
    msgs.forEach((m, i) => {
      _pinned.push({
        id: `p${_pinned.length + i + 1}`,
        messageId: '',
        threadId: thread.id,
        sender: m.from,
        subject: (thread.subject as string) || '',
        date: m.date,
        text: m.text,
      });
    });
    this.setState({ count: _pinned.length });
  };

  render() {
    return (
      <button className="btn btn-toolbar" title={localized('Pin to AI chat')} onClick={this._pin}>
        📌{this.state.count > 0 ? ` (${this.state.count})` : ''}
      </button>
    );
  }
}
