import React from 'react';
import { Thread, localized } from 'mailspring-exports';
import { RetinaImg } from 'mailspring-component-kit';
import { fetchThreadMessages, buildThreadMarkdown, saveMarkdownFile } from './export-utils';

export default class ExportThreadButton extends React.Component<{
  items: Thread[];
  thread?: Thread;
}> {
  static displayName = 'ExportThreadButton';
  static containerRequired = false;

  _onClick = async () => {
    const thread = this.props.thread || this.props.items?.[0];
    if (!thread) return;

    const messages = await fetchThreadMessages(thread.id);
    if (!messages.length) return;

    const content = buildThreadMarkdown(thread, messages);
    await saveMarkdownFile(content, thread.subject);
  };

  render() {
    if (this.props.items && this.props.items.length > 1) {
      return <span />;
    }
    return (
      <button
        className="btn btn-toolbar export-markdown-button"
        title={localized('Export Thread as Markdown')}
        onClick={this._onClick}
      >
        <RetinaImg name="ic-toolbar-native-share.png" mode={RetinaImg.Mode.ContentIsMask} />
      </button>
    );
  }
}
