import React from 'react';
import { localized, Actions } from 'mailspring-exports';

export default class PreferencesButton extends React.Component {
  static displayName = 'PreferencesButton';

  _onOpenPreferences = () => {
    Actions.openPreferences();
  };

  render() {
    return (
      <button
        className="btn btn-toolbar"
        style={{ order: -197 }}
        title={localized('Preferences')}
        aria-label={localized('Preferences')}
        onClick={this._onOpenPreferences}
      >
        <i className="fa fa-cog" aria-hidden="true" />
      </button>
    );
  }
}
