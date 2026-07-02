// Centralized config keys + typed getters with defaults. AppEnv.config is a window global.
const K = {
  enabled: 'ai-assistant.enabled',
  provider: 'ai-assistant.provider',
  endpoint: 'ai-assistant.endpoint',
  model: 'ai-assistant.model',
  claudeCliPath: 'ai-assistant.claudeCli.path',
  claudeCliModel: 'ai-assistant.claudeCli.model',
  kbEnabled: 'ai-assistant.knowledgeBase.enabled',
  embedBackend: 'ai-assistant.embeddings.backend',
  embedInAppModel: 'ai-assistant.embeddings.inAppModel',
  embedServerUrl: 'ai-assistant.embeddings.serverUrl',
  embedModel: 'ai-assistant.embeddings.model',
  webSearchEnabled: 'ai-assistant.webSearch.enabled',
  webSearchProvider: 'ai-assistant.webSearch.provider',
  webSearchUrl: 'ai-assistant.webSearch.url',
  webSearchResults: 'ai-assistant.webSearch.results',
  panelOpen: 'ai-assistant.panel.open',
  panelWidth: 'ai-assistant.panel.width',
  currentSession: 'ai-assistant.currentSession',
  // RAG pipeline
  chunkSize: 'ai-assistant.rag.chunkSize',
  chunkOverlap: 'ai-assistant.rag.chunkOverlap',
  retrieveK: 'ai-assistant.rag.retrieveK',
  contextBudget: 'ai-assistant.rag.contextBudget',
  historyFraction: 'ai-assistant.rag.historyFraction',
  // Agent
  maxAgentSteps: 'ai-assistant.agent.maxSteps',
  // RAG mode
  ragMode: 'ai-assistant.rag.mode',
  // Skill toggles (default off — each must be explicitly enabled)
  skillSendEmail: 'ai-assistant.skills.sendEmail',
  skillTrashThread: 'ai-assistant.skills.trashThread',
  skillArchiveThread: 'ai-assistant.skills.archiveThread',
};

export const RAG_DEFAULTS = {
  // Smaller chunks give more precise semantic matches; 800 chars ≈ 1-2 email paragraphs
  chunkSize: 800,
  // ~19% overlap preserves sentence context across chunk boundaries
  chunkOverlap: 150,
  // More chunks needed when each is smaller; 10 covers ~8k chars of KB context
  retrieveK: 10,
  // Modern LLMs support 128k+ tokens; 24k chars lets a full thread fit without clipping
  contextBudget: 24000,
  // Give 70% of budget to thread + sources rather than chat history
  historyFraction: 0.3,
  // Extra headroom for multi-hop research (find → read → synthesize)
  maxAgentSteps: 8,
  // More results improve coverage without overwhelming the prompt
  webSearchResults: 8,
} as const;

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
  getProvider: () => get<'api' | 'claude-cli'>(K.provider, 'api'),
  getEndpoint: () => String(get(K.endpoint, 'https://api.openai.com/v1')).replace(/\/+$/, ''),
  getModel: () => get(K.model, 'gpt-4o-mini'),
  getClaudeCliPath: () => String(get(K.claudeCliPath, 'claude')).trim() || 'claude',
  getClaudeCliModel: () => String(get(K.claudeCliModel, '')).trim(),
  getEmbeddingBackend: () => get<'in-app' | 'server'>(K.embedBackend, 'in-app'),
  getEmbeddingInAppModel: () => get(K.embedInAppModel, 'Xenova/all-MiniLM-L6-v2'),
  getEmbeddingServerUrl: () =>
    String(get(K.embedServerUrl, 'http://localhost:11434/v1')).replace(/\/+$/, ''),
  getEmbeddingModel: () => get(K.embedModel, 'all-MiniLM-L6-v2'),
  isWebSearchEnabled: () => get(K.webSearchEnabled, false) === true,
  getWebSearchProvider: () => get(K.webSearchProvider, 'searxng'),
  getWebSearchUrl: () => String(get(K.webSearchUrl, '')).replace(/\/+$/, ''),
  getWebSearchResults: () =>
    Math.max(1, get<number>(K.webSearchResults, RAG_DEFAULTS.webSearchResults)),
  isPanelOpen: () => get(K.panelOpen, true) === true,
  getPanelWidth: () => get<number>(K.panelWidth, 380),
  getCurrentSession(): string {
    let v = get<string>(K.currentSession, '');
    if (!v) {
      v = `session_${Date.now()}`;
      AppEnv.config.set(K.currentSession, v);
    }
    return v;
  },
  newSession(): string {
    const id = `session_${Date.now()}`;
    AppEnv.config.set(K.currentSession, id);
    return id;
  },
  // RAG pipeline
  getChunkSize: () => Math.max(200, get<number>(K.chunkSize, RAG_DEFAULTS.chunkSize)),
  getChunkOverlap: () => Math.max(0, get<number>(K.chunkOverlap, RAG_DEFAULTS.chunkOverlap)),
  getRetrieveK: () => Math.max(1, get<number>(K.retrieveK, RAG_DEFAULTS.retrieveK)),
  getContextBudget: () => Math.max(1000, get<number>(K.contextBudget, RAG_DEFAULTS.contextBudget)),
  getHistoryFraction: () =>
    Math.min(0.9, Math.max(0.1, get<number>(K.historyFraction, RAG_DEFAULTS.historyFraction))),
  // Agent
  getMaxAgentSteps: () => Math.max(1, get<number>(K.maxAgentSteps, RAG_DEFAULTS.maxAgentSteps)),
  // RAG mode
  getRagMode: () => get<'default' | 'auto-tune' | 'custom'>(K.ragMode, 'default'),
  // Skill toggles
  isSkillSendEmailEnabled: () => get(K.skillSendEmail, true) !== false,
  isSkillTrashThreadEnabled: () => get(K.skillTrashThread, true) !== false,
  isSkillArchiveThreadEnabled: () => get(K.skillArchiveThread, true) !== false,
};
