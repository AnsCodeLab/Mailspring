import React from 'react';
import { localized } from 'mailspring-exports';

export default class RefreshButton extends React.Component {
  static displayName = 'RefreshButton';

  _onRefresh = () => {
    AppEnv.mailsyncBridge.sendSyncMailNow();
  };

  render() {
    return (
      <button
        className="btn btn-toolbar"
        style={{ order: -199 }}
        title={localized('Refresh mail')}
        aria-label={localized('Refresh mail')}
        onClick={this._onRefresh}
      >
        <i className="fa fa-refresh" aria-hidden="true" />
      </button>
    );
  }
}
