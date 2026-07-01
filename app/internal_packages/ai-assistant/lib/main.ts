import {
  ComponentRegistry,
  WorkspaceStore,
  PreferencesUIStore,
  localized,
} from 'mailspring-exports';
import { AIConfig } from './config';

// Config subscriptions + prefs tab teardown — live for the whole package lifetime.
let coreDisposables: Array<() => void> = [];
// Feature UI + indexer — gated by the enabled/kb toggles, torn down on each sync.
let featureDisposables: Array<() => void> = [];
let prefsTab: any = null;

function registerPreferences() {
  prefsTab = new PreferencesUIStore.TabItem({
    tabId: 'AIAssistant',
    displayName: localized('AI Assistant'),
    componentClassFn: () => require('./preferences').default,
  });
  PreferencesUIStore.registerPreferencesTab(prefsTab);
}

function registerFeatureUI() {
  const React = require('react');
  const ReactDOM = require('react-dom');
  const { default: ChatPanel, AIToggleButton } = require('./chat-panel');

  // Render the chat panel as a real flex sibling to the email content column so it
  // pushes the email left rather than floating on top of it.
  const panelContainer = document.createElement('div');
  panelContainer.id = 'ai-chat-panel-root';
  panelContainer.style.cssText = 'display:flex;flex-shrink:0;height:100%;';

  const attachPanel = () => {
    // Insert right after the MessageList column (before MessageListSidebar / contact card)
    const msgCol = document.querySelector('.column-MessageList');
    const parent = msgCol?.parentElement;
    if (parent && msgCol) {
      parent.insertBefore(panelContainer, msgCol.nextSibling);
    } else {
      document.body.appendChild(panelContainer);
    }
  };
  // Wait for the sheet columns to render, then attach
  setTimeout(attachPanel, 600);

  ReactDOM.render(React.createElement(ChatPanel), panelContainer);
  featureDisposables.push(() => {
    ReactDOM.unmountComponentAtNode(panelContainer);
    panelContainer.remove();
  });

  ComponentRegistry.register(AIToggleButton, { role: 'ThreadActionsToolbarButton' });
  featureDisposables.push(() => ComponentRegistry.unregister(AIToggleButton));

  const ThreadChatBadge = require('./thread-chat-badge').default;
  ComponentRegistry.register(ThreadChatBadge, { role: 'ThreadListIcon' });
  featureDisposables.push(() => ComponentRegistry.unregister(ThreadChatBadge));

  const ComposerAssist = require('./composer-assist').default;
  ComponentRegistry.register(ComposerAssist, { role: 'Composer:ActionButton' });
  featureDisposables.push(() => ComponentRegistry.unregister(ComposerAssist));

  const { Skills } = require('./skills/registry');
  const { kbSearchSkill } = require('./skills/builtin/kb-search');
  const { mailboxSearchSkill } = require('./skills/builtin/mailbox-search');
  const { openEmailSkill } = require('./skills/builtin/open-email');
  const { createDraftSkill } = require('./skills/builtin/create-draft');
  const { fetchUrlSkill } = require('./skills/builtin/fetch-url');
  const { webSearchSkill } = require('./skills/builtin/web-search');
  const { sendEmailSkill } = require('./skills/builtin/send-email');
  const { trashThreadSkill, archiveThreadSkill } = require('./skills/builtin/manage-thread');
  const allSkills = [
    kbSearchSkill,
    mailboxSearchSkill,
    openEmailSkill,
    createDraftSkill,
    fetchUrlSkill,
    webSearchSkill,
    sendEmailSkill,
    trashThreadSkill,
    archiveThreadSkill,
  ];
  allSkills.forEach((s: any) => Skills.register(s));
  featureDisposables.push(() => allSkills.forEach((s: any) => Skills.unregister(s.name)));
}

export function activate() {
  const { windowType } = AppEnv.getLoadSettings();

  if (windowType === 'composer') {
    // In the composer window only register the AI assist toolbar button.
    // Everything else (indexer, chat panel, skills) belongs to the default window only.
    if (AIConfig.isEnabled()) {
      const ComposerAssist = require('./composer-assist').default;
      ComponentRegistry.register(ComposerAssist, { role: 'Composer:ActionButton' });
      coreDisposables.push(() => ComponentRegistry.unregister(ComposerAssist));
    }
    return;
  }

  // Preferences tab is always available so the user can enable the feature.
  registerPreferences();

  const sync = () => {
    teardownFeature();
    if (AIConfig.isEnabled()) {
      registerFeatureUI();
      if (AIConfig.isKnowledgeBaseEnabled()) {
        try {
          require('./indexer').Indexer.start();
          featureDisposables.push(() => require('./indexer').Indexer.stop());
        } catch (e) {
          // indexer not yet implemented; guard prevents console error on KB toggle
        }
      }
    }
  };
  // React to the master toggle and KB toggle without a restart.
  const sub1 = AppEnv.config.onDidChange(AIConfig.keys.enabled, sync);
  const sub2 = AppEnv.config.onDidChange(AIConfig.keys.kbEnabled, sync);
  coreDisposables.push(
    () => sub1.dispose(),
    () => sub2.dispose()
  );
  sync();
}

function teardownFeature() {
  // Tear down only the gated feature UI + indexer; leave core subscriptions intact.
  featureDisposables.forEach((d) => d());
  featureDisposables = [];
}

export function deactivate() {
  teardownFeature();
  coreDisposables.forEach((d) => d());
  coreDisposables = [];
  if (prefsTab) PreferencesUIStore.unregisterPreferencesTab(prefsTab.sectionId);
}
