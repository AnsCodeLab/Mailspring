import fs from 'fs';
import React from 'react';
import _ from 'underscore';

import {
  localized,
  localizedReactFragment,
  Actions,
  Account,
  AccountStore,
  MailRulesStore,
  MailRulesTemplates,
} from 'mailspring-exports';

import {
  Flexbox,
  EditableList,
  RetinaImg,
  ScrollRegion,
  ScenarioEditor,
} from 'mailspring-component-kit';

const { ActionTemplatesForAccount, ConditionTemplatesForAccount } = MailRulesTemplates;

interface PreferencesMailRulesState {
  accounts: Account[];
  currentAccount: Account;
  rules: ReturnType<typeof MailRulesStore.rulesForAccountId>;
  selectedRule?: ReturnType<typeof MailRulesStore.rulesForAccountId>[0];
  reprocessing?: ReturnType<typeof MailRulesStore.reprocessState>;
  actionTemplates: ReturnType<typeof ActionTemplatesForAccount>;
  conditionTemplates: ReturnType<typeof ConditionTemplatesForAccount>;
}

class PreferencesMailRules extends React.Component<
  Record<string, unknown>,
  PreferencesMailRulesState
> {
  static displayName = 'PreferencesMailRules';

  _unsubscribers = [];

  constructor(props) {
    super(props);
    this.state = this._getStateFromStores();
  }

  componentDidMount() {
    this._unsubscribers.push(MailRulesStore.listen(this._onRulesChanged));
  }

  componentWillUnmount() {
    this._unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  _getStateFromStores(): PreferencesMailRulesState {
    const accounts = AccountStore.accounts();

    let currentAccount = this.state ? this.state.currentAccount : null;
    if (!accounts.find((acct) => acct === currentAccount)) {
      currentAccount = accounts[0];
    }

    const rules = MailRulesStore.rulesForAccountId(currentAccount.id);
    const selectedRule =
      this.state && this.state.selectedRule
        ? rules.find((r) => r.id === this.state.selectedRule.id)
        : rules[0];

    return {
      accounts: accounts,
      currentAccount: currentAccount,
      rules: rules,
      selectedRule: selectedRule,
      reprocessing: MailRulesStore.reprocessState(),
      actionTemplates: ActionTemplatesForAccount(currentAccount),
      conditionTemplates: ConditionTemplatesForAccount(currentAccount),
    };
  }

  _onSelectAccount = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const accountId = event.target.value;
    const currentAccount = this.state.accounts.find((acct) => acct.id === accountId);
    this.setState({ currentAccount: currentAccount }, () => {
      this.setState(this._getStateFromStores());
    });
  };

  _onReprocessRules = () => {
    const needsMessageBodies = () => {
      for (const rule of this.state.rules) {
        for (const condition of rule.conditions) {
          if (condition.templateKey === 'body') {
            return true;
          }
        }
      }
      return false;
    };

    if (needsMessageBodies()) {
      AppEnv.showErrorDialog(
        localized(
          "One or more of your mail rules requires the bodies of messages being processed. These rules can't be run on your entire mailbox."
        )
      );
      return;
    }

    if (this.state.rules.length === 0) {
      AppEnv.showErrorDialog(
        localized(
          "You haven't created any mail rules. To get started, define a new rule above and tell Mailspring how to process your inbox."
        )
      );
      return;
    }
    Actions.startReprocessingMailRules(this.state.currentAccount.id);
  };

  _onAddRule = () => {
    Actions.addMailRule({ accountId: this.state.currentAccount.id });
  };

  _onExportRules = () => {
    const { currentAccount, rules } = this.state;
    if (rules.length === 0) return;

    const data = JSON.stringify({ version: 1, rules }, null, 2);
    const safeLabel = (currentAccount.label || 'account').replace(/[\\/:*?"<>|]/g, '_');

    AppEnv.showSaveDialog(
      {
        defaultPath: `mailspring-rules-${safeLabel}.json`,
        title: localized('Export Mail Rules'),
      },
      (savePath: string) => {
        if (!savePath) return;
        try {
          fs.writeFileSync(savePath, data, 'utf8');
        } catch (err) {
          AppEnv.showErrorDialog({
            title: localized('Export Failed'),
            message: String(err),
          });
        }
      }
    );
  };

  _onImportRules = () => {
    AppEnv.showOpenDialog(
      {
        title: localized('Import Mail Rules'),
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      },
      (paths: string[]) => {
        if (!paths || paths.length === 0) return;

        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(paths[0], 'utf8'));
        } catch (err) {
          AppEnv.showErrorDialog({
            title: localized('Import Failed'),
            message: localized('The selected file is not valid JSON.'),
          });
          return;
        }

        const rules = Array.isArray(parsed) ? parsed : parsed && parsed.rules;
        if (!Array.isArray(rules) || rules.length === 0) {
          AppEnv.showErrorDialog({
            title: localized('Import Failed'),
            message: localized('The selected file does not contain any mail rules.'),
          });
          return;
        }

        const accountId = this.state.currentAccount.id;

        // Signature used to merge: two rules are "the same" when their name,
        // condition mode, conditions and actions match. Re-importing a file is
        // therefore idempotent — rules already present are skipped, not duplicated.
        const signatureOf = (r: {
          name?: string;
          conditionMode?: string;
          conditions?: { templateKey?: string; comparatorKey?: string; value?: string }[];
          actions?: { templateKey?: string; value?: string }[];
        }) =>
          JSON.stringify([
            r.name || '',
            r.conditionMode || '',
            (r.conditions || []).map((c) => [c.templateKey, c.comparatorKey, c.value]),
            (r.actions || []).map((a) => [a.templateKey, a.value]),
          ]);

        const seen = new Set(MailRulesStore.rulesForAccountId(accountId).map(signatureOf));

        let imported = 0;
        let skipped = 0;
        let invalid = 0;
        for (const rule of rules) {
          if (!rule || !Array.isArray(rule.conditions) || !Array.isArray(rule.actions)) {
            invalid += 1;
            continue;
          }
          const signature = signatureOf(rule);
          if (seen.has(signature)) {
            skipped += 1;
            continue;
          }
          seen.add(signature);

          // Reuse the tested add path: each imported rule gets a fresh id and is
          // reassigned to the currently-selected account. Account-specific action
          // values (e.g. folder/label ids) that don't resolve will be auto-disabled
          // by Mailspring the same way broken rules already are.
          const properties: {
            accountId: string;
            conditions: unknown[];
            actions: unknown[];
            name?: string;
            conditionMode?: string;
          } = {
            accountId,
            conditions: rule.conditions,
            actions: rule.actions,
          };
          if (rule.name) properties.name = rule.name;
          if (rule.conditionMode) properties.conditionMode = rule.conditionMode;
          Actions.addMailRule(properties);
          imported += 1;
        }

        if (imported === 0 && skipped > 0) {
          // Nothing new to add — every rule in the file is already present.
          AppEnv.showErrorDialog({
            title: localized('Nothing to Import'),
            message: localized('All of the rules in this file have already been imported.'),
          });
        } else if (imported === 0) {
          AppEnv.showErrorDialog({
            title: localized('Import Failed'),
            message: localized('The selected file does not contain any valid mail rules.'),
          });
        } else if (skipped > 0 || invalid > 0) {
          // Imported some, but skipped duplicates and/or invalid entries — let the
          // user know why the count may not match the file.
          AppEnv.showErrorDialog({
            title: localized('Rules Imported'),
            message: localized(
              'Imported %@ rule(s). %@ duplicate(s) already present were skipped.',
              `${imported}`,
              `${skipped}`
            ),
          });
        }
      }
    );
  };

  _onSelectRule = (rule: ReturnType<typeof MailRulesStore.rulesForAccountId>[0]) => {
    this.setState({ selectedRule: rule });
  };

  _onReorderRule = (
    rule: ReturnType<typeof MailRulesStore.rulesForAccountId>[0],
    startIdx: number,
    endIdx: number
  ) => {
    Actions.reorderMailRule(rule.id, endIdx);
  };

  _onDeleteRule = (rule: ReturnType<typeof MailRulesStore.rulesForAccountId>[0]) => {
    Actions.deleteMailRule(rule.id);
  };

  _onRuleNameEdited = (
    newName: string,
    rule: ReturnType<typeof MailRulesStore.rulesForAccountId>[0]
  ) => {
    Actions.updateMailRule(rule.id, { name: newName });
  };

  _onRuleConditionModeEdited = (event: React.ChangeEvent<HTMLSelectElement>) => {
    Actions.updateMailRule(this.state.selectedRule.id, { conditionMode: event.target.value });
  };

  _onRuleEnabled = () => {
    Actions.updateMailRule(this.state.selectedRule.id, { disabled: false, disabledReason: null });
  };

  _onRulesChanged = () => {
    const next = this._getStateFromStores();
    const nextRules = next.rules;
    const prevRules = this.state.rules ? this.state.rules : [];

    const added = _.difference(nextRules, prevRules);
    if (added.length === 1) {
      next.selectedRule = added[0];
    }

    this.setState(next);
  };

  _renderAccountPicker() {
    const options = this.state.accounts.map((account) => (
      <option value={account.id} key={account.id}>
        {account.label}
      </option>
    ));

    return (
      <>
        <label htmlFor="mail-rules-account" className="sr-only">
          {localized('Account')}
        </label>
        <select
          id="mail-rules-account"
          value={this.state.currentAccount.id}
          onChange={this._onSelectAccount}
          style={{ margin: 0, minWidth: 200 }}
        >
          {options}
        </select>
      </>
    );
  }

  _renderMailRules() {
    if (this.state.rules.length === 0) {
      return (
        <div className="empty-list">
          <RetinaImg
            className="icon-mail-rules"
            name="rules-big.png"
            mode={RetinaImg.Mode.ContentDark}
          />
          <h2>{localized('No rules')}</h2>
          <button className="btn btn-small" onClick={this._onAddRule}>
            {localized('Create a new Rule')}
          </button>
        </div>
      );
    }
    return (
      <Flexbox>
        <EditableList
          showEditIcon
          className="rule-list"
          items={this.state.rules}
          itemContent={this._renderListItemContent}
          onCreateItem={this._onAddRule}
          onReorderItem={this._onReorderRule}
          onDeleteItem={this._onDeleteRule}
          onItemEdited={this._onRuleNameEdited}
          selected={this.state.selectedRule}
          onSelectItem={this._onSelectRule}
        />
        {this._renderDetail()}
      </Flexbox>
    );
  }

  _renderListItemContent(rule) {
    if (rule.disabled) {
      return <div className="item-rule-disabled">{rule.name}</div>;
    }
    return rule.name;
  }

  _renderDetail() {
    const rule = this.state.selectedRule;

    if (rule) {
      return (
        <ScrollRegion className="rule-detail">
          {this._renderDetailDisabledNotice()}
          <div className="inner">
            {localizedReactFragment(
              'If %@ of the following conditions are met:',
              <select value={rule.conditionMode} onChange={this._onRuleConditionModeEdited}>
                <option value="any">{localized('Any')}</option>
                <option value="all">{localized('All')}</option>
              </select>
            )}
            <ScenarioEditor
              instances={rule.conditions}
              templates={this.state.conditionTemplates}
              onChange={(conditions) => Actions.updateMailRule(rule.id, { conditions })}
              className="well well-matchers"
            />
            <span>{localized('Perform these actions:')}</span>
            <ScenarioEditor
              instances={rule.actions}
              templates={this.state.actionTemplates}
              onChange={(actions) => Actions.updateMailRule(rule.id, { actions })}
              className="well well-actions"
            />
          </div>
        </ScrollRegion>
      );
    }

    return (
      <div className="rule-detail">
        <div className="no-selection">
          {localized('Create a rule or select one to get started')}
        </div>
      </div>
    );
  }

  _renderDetailDisabledNotice() {
    if (!this.state.selectedRule.disabled) return false;
    return (
      <div className="disabled-reason">
        <button className="btn" onClick={this._onRuleEnabled}>
          {localized('Enable')}
        </button>
        {localized(
          'This rule has been disabled. Make sure the actions below are valid and re-enable the rule.'
        )}
        <div>({this.state.selectedRule.disabledReason})</div>
      </div>
    );
  }

  _renderTasks() {
    return (
      <div style={{ flex: 1, paddingLeft: 20 }}>
        {Object.keys(this.state.reprocessing).map((accountId) => {
          const { count } = this.state.reprocessing[accountId];
          return (
            <Flexbox key={accountId} style={{ alignItems: 'baseline' }}>
              <div style={{ paddingRight: '12px' }}>
                <RetinaImg
                  name="sending-spinner.gif"
                  width={18}
                  mode={RetinaImg.Mode.ContentPreserve}
                />
              </div>
              <div>
                <strong>{AccountStore.accountForId(accountId).emailAddress}</strong>
                {` — ${Number(count).toLocaleString()} ${localized(`processed`)}`}
              </div>
              <div style={{ flex: 1 }} />
              <button
                className="btn btn-sm"
                onClick={() => Actions.stopReprocessingMailRules(accountId)}
              >
                {localized('Stop')}
              </button>
            </Flexbox>
          );
        })}
      </div>
    );
  }

  render() {
    return (
      <div className="container-mail-rules">
        <section>
          <Flexbox className="container-dropdown">
            <div>{localized('Account')}:</div>
            <div className="dropdown">{this._renderAccountPicker()}</div>
          </Flexbox>
          <p>{localized('Rules only apply to the selected account.')}</p>

          <div style={{ marginBottom: 15 }}>
            <button className="btn" style={{ marginRight: 10 }} onClick={this._onImportRules}>
              {localized('Import Rules')}
            </button>
            <button
              className="btn"
              onClick={this._onExportRules}
              disabled={this.state.rules.length === 0}
            >
              {localized('Export Rules')}
            </button>
          </div>

          {this._renderMailRules()}

          <Flexbox style={{ marginTop: 40, maxWidth: 600 }}>
            <div>
              <button
                disabled={!!this.state.reprocessing[this.state.currentAccount.id]}
                className="btn"
                style={{ float: 'right' }}
                onClick={this._onReprocessRules}
              >
                {localized('Process entire inbox')}
              </button>
            </div>
            {this._renderTasks()}
          </Flexbox>

          <p style={{ marginTop: 10 }}>
            {localized(
              'By default, mail rules are only applied to new mail as it arrives. Applying rules to your entire inbox may take a long time and degrade performance.'
            )}
          </p>
        </section>
      </div>
    );
  }
}

export default PreferencesMailRules;
