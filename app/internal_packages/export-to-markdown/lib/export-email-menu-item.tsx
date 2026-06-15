import React from 'react';
import { Message, Thread, DatabaseStore, localized, AppEnv } from 'mailspring-exports';
import { buildSingleMessageMarkdown, saveMarkdownFile } from './export-utils';

export default class ExportEmailMenuItem extends React.Component {
  static displayName = 'ExportEmailMenuItem';

  static getMenuItem({ message, thread }: { message: Message; thread: Thread }) {
    return {
      label: localized('Export as Markdown'),
      click: async () => {
        try {
          let msg = message;
          if (!msg.body) {
            msg = await DatabaseStore.find<Message>(Message, message.id).include(
              Message.attributes.body
            );
            if (!msg) return;
          }
          const content = buildSingleMessageMarkdown(msg);
          await saveMarkdownFile(content, msg.subject || thread.subject);
        } catch (err) {
          AppEnv.showErrorDialog({
            title: localized('Export Failed'),
            message: String(err),
          });
        }
      },
    };
  }

  render() {
    return null;
  }
}
