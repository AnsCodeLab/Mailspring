import React from 'react';
import { localized, Actions, AccountStore } from 'mailspring-exports';

export default class ApplyRulesButton extends React.Component {
  static displayName = 'ApplyRulesButton';

  _onApplyRules = () => {
    for (const account of AccountStore.accounts()) {
      Actions.startReprocessingMailRules(account.id);
    }
  };

  render() {
    return (
      <button
        className="btn btn-toolbar"
        style={{ order: -198 }}
        title={localized('Apply mail rules')}
        aria-label={localized('Apply mail rules')}
        onClick={this._onApplyRules}
      >
        <i className="fa fa-filter" aria-hidden="true" />
      </button>
    );
  }
}
