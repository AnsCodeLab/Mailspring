import { ComponentRegistry, PreferencesUIStore, localized } from 'mailspring-exports';
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
  // Filled in by later tasks (chat panel, composer assist). Guarded by AIConfig.isEnabled().
  const ChatPanel = require('./chat-panel').default;
  ComponentRegistry.register(ChatPanel, { role: 'MessageListSidebar:ContactCard' });
  featureDisposables.push(() => ComponentRegistry.unregister(ChatPanel));

  const ComposerAssist = require('./composer-assist').default;
  ComponentRegistry.register(ComposerAssist, { role: 'Composer:ActionButton' });
  featureDisposables.push(() => ComponentRegistry.unregister(ComposerAssist));

  const PinAction = require('./pin-action').default;
  ComponentRegistry.register(PinAction, { role: 'ThreadActionsToolbarButton' });
  featureDisposables.push(() => ComponentRegistry.unregister(PinAction));

  const { Skills } = require('./skills/registry');
  const { kbSearchSkill } = require('./skills/builtin/kb-search');
  const { mailboxSearchSkill } = require('./skills/builtin/mailbox-search');
  const { openEmailSkill } = require('./skills/builtin/open-email');
  const { createDraftSkill } = require('./skills/builtin/create-draft');
  const { fetchUrlSkill } = require('./skills/builtin/fetch-url');
  const { webSearchSkill } = require('./skills/builtin/web-search');
  [
    kbSearchSkill,
    mailboxSearchSkill,
    openEmailSkill,
    createDraftSkill,
    fetchUrlSkill,
    webSearchSkill,
  ].forEach((s: any) => Skills.register(s));
  featureDisposables.push(() =>
    [
      kbSearchSkill,
      mailboxSearchSkill,
      openEmailSkill,
      createDraftSkill,
      fetchUrlSkill,
      webSearchSkill,
    ].forEach((s: any) => Skills.unregister(s.name))
  );
}

export function activate() {
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
