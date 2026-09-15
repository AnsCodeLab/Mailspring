import { localized, React } from 'mailspring-exports';
import { ipcRenderer, shell } from 'electron';
import { Notification } from 'mailspring-component-kit';
import { Disposable } from 'event-kit';

const RELEASES_PAGE_URL = 'https://github.com/AnsCodeLab/Mailspring/releases/latest';
const RELEASE_NOTES_PREVIEW_LENGTH = 200;

function truncateReleaseNotes(notes: string | undefined): string {
  if (!notes) return '';
  const trimmed = notes.trim();
  if (trimmed.length <= RELEASE_NOTES_PREVIEW_LENGTH) return trimmed;
  return `${trimmed.slice(0, RELEASE_NOTES_PREVIEW_LENGTH).trimEnd()}…`;
}

interface UpdateNotificationState {
  updateAvailable: boolean;
  version: string;
  releaseNotesPreview: string;
  installing: boolean;
}

export default class UpdateNotification extends React.Component<
  Record<string, unknown>,
  UpdateNotificationState
> {
  static displayName = 'UpdateNotification';

  disposable?: Disposable;

  constructor(props) {
    super(props);
    this.state = this.getStateFromStores();
  }

  componentDidMount() {
    this.disposable = AppEnv.onUpdateAvailable(() => {
      this.setState(this.getStateFromStores());
    });
  }

  componentWillUnmount() {
    this.disposable.dispose();
  }

  getStateFromStores() {
    const updater = require('@electron/remote').getGlobal('application').autoUpdateManager;
    const updateAvailable = updater.getState() === 'update-available';
    const info = updateAvailable ? updater.getReleaseDetails() : {};
    return {
      updateAvailable,
      version: info.releaseVersion,
      releaseNotesPreview: truncateReleaseNotes(info.releaseNotes),
      installing: false,
    };
  }

  _onUpdate = () => {
    if (this.state.installing) {
      return undefined;
    }
    this.setState({ installing: true });
    ipcRenderer.send('command', 'application:install-update');
    // No completion signal is wired back from the main process for this
    // action (see application.ts's `application:install-update` handler -
    // fire-and-forget); the real outcome is either the app quitting
    // (Windows) or a package-manager GUI/pkexec prompt taking over
    // (Linux), both well outside this notification's lifetime. Return a
    // permanently-pending Promise so the existing Notification
    // component's built-in async-action handling (see notification.tsx's
    // `_onClick`, and its `.action.loading` styling) keeps this action
    // visually "installing" for as long as this component stays mounted,
    // instead of introducing a second loading-state convention.
    return Promise.withResolvers<void>().promise;
  };

  _onViewChangelog = () => {
    shell.openExternal(RELEASES_PAGE_URL);
  };

  render() {
    const { updateAvailable, version, releaseNotesPreview, installing } = this.state;

    if (!updateAvailable) {
      return <span />;
    }
    return (
      <Notification
        priority="4"
        title={localized(
          `An update to Mailspring is available %@`,
          version ? `(${version.replace('Mailspring', '').trim()})` : ''
        )}
        subtitle={localized('View changelog')}
        subtitleAction={this._onViewChangelog}
        icon="volstead-upgrade.png"
        actions={[
          {
            label: installing ? localized('Installing…') : localized('Install'),
            fn: this._onUpdate,
          },
        ]}
        isDismissable
      >
        {releaseNotesPreview ? <p className="notification-body">{releaseNotesPreview}</p> : null}
      </Notification>
    );
  }
}
