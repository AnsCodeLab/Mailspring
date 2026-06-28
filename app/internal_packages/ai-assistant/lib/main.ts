import {
  ComponentRegistry,
  PreferencesUIStore,
  WorkspaceStore,
  localized,
} from 'mailspring-exports';
import { AIConfig } from './config';

let disposables: Array<() => void> = [];
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
  disposables.push(() => ComponentRegistry.unregister(ChatPanel));

  const ComposerAssist = require('./composer-assist').default;
  ComponentRegistry.register(ComposerAssist, { role: 'Composer:ActionButton' });
  disposables.push(() => ComponentRegistry.unregister(ComposerAssist));
}

export function activate() {
  // Preferences tab is always available so the user can enable the feature.
  registerPreferences();

  const sync = () => {
    teardownFeature();
    if (AIConfig.isEnabled()) {
      registerFeatureUI();
      if (AIConfig.isKnowledgeBaseEnabled()) {
        require('./indexer').Indexer.start();
        disposables.push(() => require('./indexer').Indexer.stop());
      }
    }
  };
  // React to the master toggle and KB toggle without a restart.
  const sub1 = AppEnv.config.onDidChange(AIConfig.keys.enabled, sync);
  const sub2 = AppEnv.config.onDidChange(AIConfig.keys.kbEnabled, sync);
  disposables.push(
    () => sub1.dispose(),
    () => sub2.dispose()
  );
  sync();
}

function teardownFeature() {
  // Tear down everything except the config subscriptions + prefs tab.
  const keep = disposables.slice(-2); // the two onDidChange disposers added in activate
  const toRun = disposables.slice(0, -2);
  toRun.forEach((d) => d());
  disposables = keep;
}

export function deactivate() {
  disposables.forEach((d) => d());
  disposables = [];
  if (prefsTab) PreferencesUIStore.unregisterPreferencesTab(prefsTab.sectionId);
}
