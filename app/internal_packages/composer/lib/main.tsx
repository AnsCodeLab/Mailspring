/* eslint react/sort-comp: 0 */
import _ from 'underscore';
import React from 'react';
import {
  Message,
  localized,
  DraftStore,
  WorkspaceStore,
  ComponentRegistry,
  InflatesDraftClientId,
} from 'mailspring-exports';
import ComposeButton from './compose-button';
import RefreshButton from './refresh-button';
import ApplyRulesButton from './apply-rules-button';
import PreferencesButton from './preferences-button';
import ComposerView from './composer-view';

const ComposerViewForDraftClientId = InflatesDraftClientId(ComposerView);

class ComposerWithWindowProps extends React.Component<
  Record<string, unknown>,
  { headerMessageId: string; errorMessage?: string; errorDetail?: string }
> {
  static displayName = 'ComposerWithWindowProps';
  static containerRequired = false;

  _usub?: () => void;
  _composerComponent?: any;

  constructor(props) {
    super(props);

    // We'll now always have windowProps by the time we construct this.
    const windowProps = AppEnv.getWindowProps();
    const { draftJSON, headerMessageId, newDraft } = windowProps;
    if (!draftJSON) {
      throw new Error('Initialize popout composer windows with valid draftJSON');
    }
    const draft = new Message({}).fromJSON(draftJSON);
    DraftStore._createSession(headerMessageId, draft);
    this.state = windowProps;

    // Set the OS window title immediately based on the draft subject (if any)
    const subject = draft.subject && draft.subject.trim();
    AppEnv.getCurrentWindow().setTitle(
      subject || (newDraft ? localized('New Message') : localized('Message'))
    );
  }

  componentWillUnmount() {
    if (this._usub) {
      this._usub();
    }
  }

  componentDidUpdate() {
    this._composerComponent.focus();
  }

  _onDraftReady = async () => {
    await this._composerComponent.focus();

    // Subscribe to draft changes to keep the OS window title up to date as the user types
    const { newDraft } = AppEnv.getWindowProps();
    const session = await DraftStore.sessionForClientId(this.state.headerMessageId);
    this._usub = session.listen(() => {
      const d = session.draft();
      if (!d) return;
      const subject = d.subject && d.subject.trim();
      AppEnv.getCurrentWindow().setTitle(
        subject || (newDraft ? localized('New Message') : localized('Message'))
      );
    });

    AppEnv.displayWindow();

    if (this.state.errorMessage) {
      this._showInitialErrorDialog(this.state.errorMessage, this.state.errorDetail);
    }
  };

  render() {
    return (
      <ComposerViewForDraftClientId
        ref={(cm) => {
          this._composerComponent = cm;
        }}
        onDraftReady={this._onDraftReady}
        headerMessageId={this.state.headerMessageId}
        className="composer-full-window"
      />
    );
  }

  _showInitialErrorDialog(msg: string, detail: string) {
    // We delay so the view has time to update the restored draft. If we
    // don't delay the modal may come up in a state where the draft looks
    // like it hasn't been restored or has been lost.
    _.delay(() => {
      AppEnv.showErrorDialog({ title: localized('Error'), message: msg }, { detail: detail });
    }, 100);
  }
}

export function activate() {
  if (AppEnv.isMainWindow()) {
    ComponentRegistry.register(ComposerViewForDraftClientId, {
      role: 'Composer',
    });
    ComponentRegistry.register(ComposeButton, {
      location: WorkspaceStore.Location.MessageList.Toolbar,
    });
    ComponentRegistry.register(RefreshButton, {
      location: WorkspaceStore.Location.MessageList.Toolbar,
    });
    ComponentRegistry.register(ApplyRulesButton, {
      location: WorkspaceStore.Location.MessageList.Toolbar,
    });
    ComponentRegistry.register(PreferencesButton, {
      location: WorkspaceStore.Location.MessageList.Toolbar,
    });
  } else if (AppEnv.isThreadWindow()) {
    ComponentRegistry.register(ComposerViewForDraftClientId, {
      role: 'Composer',
    });
  } else {
    AppEnv.getCurrentWindow().setMinimumSize(480, 250);
    ComponentRegistry.register(ComposerWithWindowProps, {
      location: WorkspaceStore.Location.Center,
    });
  }

  setTimeout(() => {
    // preload the font awesome icons used in the composer after a short delay.
    // unfortunately, the icon set takes enough time to load that it introduces jank
    const i = document.createElement('i');
    i.className = 'fa fa-list';
    i.style.position = 'absolute';
    i.style.top = '-20px';
    document.body.appendChild(i);
  }, 1000);
}

export function deactivate() {
  if (AppEnv.isMainWindow()) {
    ComponentRegistry.unregister(ComposerViewForDraftClientId);
    ComponentRegistry.unregister(ComposeButton);
    ComponentRegistry.unregister(RefreshButton);
    ComponentRegistry.unregister(ApplyRulesButton);
    ComponentRegistry.unregister(PreferencesButton);
  } else {
    ComponentRegistry.unregister(ComposerWithWindowProps);
  }
}

export function activateConfig() {
  // Register the font face/size schema here so config-schema.ts (upstream file)
  // stays unmodified and future upstream merges don't conflict.
  AppEnv.config.setSchema('core.composing.defaultFontFace', {
    type: 'string',
    default: 'sans-serif',
    title: localized('Default font'),
    enum: [
      'sans-serif',
      'serif',
      'monospace',
      'Roboto, sans-serif',
      'Open Sans, sans-serif',
      'Lato, sans-serif',
      'Montserrat, sans-serif',
      'Poppins, sans-serif',
      'Merriweather, serif',
      'Lora, serif',
      'Source Code Pro, monospace',
    ],
    enumLabels: [
      localized('Sans Serif'),
      localized('Serif'),
      localized('Fixed Width'),
      'Roboto',
      'Open Sans',
      'Lato',
      'Montserrat',
      'Poppins',
      'Merriweather',
      'Lora',
      'Source Code Pro',
    ],
  });
  AppEnv.config.setSchema('core.composing.defaultFontSize', {
    type: 'string',
    default: '11',
    title: localized('Default font size'),
    enum: ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24'],
    enumLabels: ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt'],
  });
}

export function serialize() {
  return this.state;
}
