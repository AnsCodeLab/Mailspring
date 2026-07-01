// Centralized config keys + typed getters with defaults. AppEnv.config is a window global.
const K = {
  enabled: 'ai-assistant.enabled',
  endpoint: 'ai-assistant.endpoint',
  model: 'ai-assistant.model',
  kbEnabled: 'ai-assistant.knowledgeBase.enabled',
  embedBackend: 'ai-assistant.embeddings.backend',
  embedInAppModel: 'ai-assistant.embeddings.inAppModel',
  embedServerUrl: 'ai-assistant.embeddings.serverUrl',
  embedModel: 'ai-assistant.embeddings.model',
  webSearchEnabled: 'ai-assistant.webSearch.enabled',
  webSearchProvider: 'ai-assistant.webSearch.provider',
  webSearchUrl: 'ai-assistant.webSearch.url',
  panelOpen: 'ai-assistant.panel.open',
  panelWidth: 'ai-assistant.panel.width',
};

export const KEY_API = 'ai-assistant.apiKey';
export const KEY_EMBED_API = 'ai-assistant.embeddings.apiKey';
export const KEY_WEBSEARCH_API = 'ai-assistant.webSearch.apiKey';

const get = <T>(key: string, def: T): T => {
  const v = AppEnv.config.get(key);
  return v === undefined || v === null ? def : (v as T);
};

export const AIConfig = {
  keys: K,
  isEnabled: () => get(K.enabled, false) === true,
  isKnowledgeBaseEnabled: () => get(K.kbEnabled, false) === true,
  getEndpoint: () => String(get(K.endpoint, 'https://api.openai.com/v1')).replace(/\/+$/, ''),
  getModel: () => get(K.model, 'gpt-4o-mini'),
  getEmbeddingBackend: () => get<'in-app' | 'server'>(K.embedBackend, 'in-app'),
  getEmbeddingInAppModel: () => get(K.embedInAppModel, 'Xenova/all-MiniLM-L6-v2'),
  getEmbeddingServerUrl: () =>
    String(get(K.embedServerUrl, 'http://localhost:11434/v1')).replace(/\/+$/, ''),
  getEmbeddingModel: () => get(K.embedModel, 'all-MiniLM-L6-v2'),
  isWebSearchEnabled: () => get(K.webSearchEnabled, false) === true,
  getWebSearchProvider: () => get(K.webSearchProvider, 'searxng'),
  getWebSearchUrl: () => String(get(K.webSearchUrl, '')).replace(/\/+$/, ''),
  isPanelOpen: () => get(K.panelOpen, true) === true,
  getPanelWidth: () => get<number>(K.panelWidth, 380),
};
