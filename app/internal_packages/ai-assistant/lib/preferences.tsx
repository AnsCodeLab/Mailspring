import React from 'react';
import { localized, KeyManager } from 'mailspring-exports';
import { AIConfig, RAG_DEFAULTS, KEY_API, KEY_WEBSEARCH_API } from './config';
import { AIService } from './ai-service';

const IN_APP_MODELS = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    label: 'all-MiniLM-L6-v2',
    desc: 'Fast & small, recommended for most users',
    size: '~23 MB',
    dims: 384,
  },
  {
    id: 'Xenova/all-MiniLM-L12-v2',
    label: 'all-MiniLM-L12-v2',
    desc: 'More accurate than L6, still compact',
    size: '~33 MB',
    dims: 384,
  },
  {
    id: 'Xenova/all-mpnet-base-v2',
    label: 'all-mpnet-base-v2',
    desc: 'High accuracy, larger vectors',
    size: '~90 MB',
    dims: 768,
  },
  {
    id: 'BAAI/bge-small-en-v1.5',
    label: 'bge-small-en-v1.5',
    desc: 'High quality English embeddings, very fast',
    size: '~33 MB',
    dims: 384,
  },
  {
    id: 'BAAI/bge-base-en-v1.5',
    label: 'bge-base-en-v1.5',
    desc: 'Top-tier English quality',
    size: '~109 MB',
    dims: 768,
  },
  {
    id: 'nomic-ai/nomic-embed-text-v1',
    label: 'nomic-embed-text-v1',
    desc: 'Strong general-purpose English embeddings',
    size: '~137 MB',
    dims: 768,
  },
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    label: 'multilingual-MiniLM-L12-v2',
    desc: 'Multilingual support (50+ languages)',
    size: '~75 MB',
    dims: 384,
  },
] as const;

const WEB_SEARCH_PROVIDERS = [
  {
    id: 'brave',
    label: 'Brave Search',
    sublabel: 'Free tier: 2,000 req/month',
    url: 'https://api.search.brave.com/res/v1/web/search',
    keyUrl: 'https://brave.com/search/api/',
  },
  {
    id: 'tavily',
    label: 'Tavily',
    sublabel: 'Free tier: 1,000 req/month, AI-optimized',
    url: 'https://api.tavily.com/search',
    keyUrl: 'https://tavily.com/',
  },
  {
    id: 'serper',
    label: 'Serper',
    sublabel: 'Free: 2,500 req, Google results',
    url: 'https://google.serper.dev/search',
    keyUrl: 'https://serper.dev/',
  },
  {
    id: 'searxng',
    label: 'SearXNG',
    sublabel: 'Self-hosted, no API key needed',
    url: 'http://localhost:8888',
    keyUrl: null,
  },
  { id: 'custom', label: 'Custom', sublabel: '', url: '', keyUrl: null },
] as const;

const CHAT_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    sublabel: 'Cloud (requires API key)',
    url: 'https://api.openai.com/v1',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    sublabel: 'Cloud (requires API key)',
    url: 'https://api.anthropic.com/v1',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    sublabel: 'Cloud (requires API key)',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    id: 'local',
    label: 'Local (OpenAI-compatible)',
    sublabel: 'Ollama, LM Studio, vLLM, Jan (no API key needed)',
    url: 'http://localhost:11434/v1',
  },
] as const;

function detectChatProvider(url: string): string {
  if (url.includes('api.openai.com')) return 'openai';
  if (url.includes('api.anthropic.com')) return 'anthropic';
  if (url.includes('generativelanguage.googleapis.com')) return 'gemini';
  return 'local';
}

function detectWebSearchProvider(url: string) {
  if (url.includes('brave.com')) return 'brave';
  if (url.includes('tavily.com')) return 'tavily';
  if (url.includes('serper.dev')) return 'serper';
  if (url.includes('localhost') || url.includes('searxng') || url.includes('searx'))
    return 'searxng';
  return url ? 'custom' : 'brave';
}

export default class AIPreferences extends React.Component<
  Record<string, never>,
  {
    apiKey: string;
    testing: boolean;
    testResult: string;
    availableModels: string[];
    loadingModels: boolean;
    indexProgress: { done: number; total: number; running: boolean };
    reindexing: boolean;
    backendStatus: 'idle' | 'checking' | 'ready' | 'error';
    backendError: string;
    embedSelectValue: string;
    webSearchProvider: string;
    endpointValue: string;
    selectedProvider: string;
    advancedResetKey: number;
  }
> {
  state = {
    apiKey: '',
    testing: false,
    testResult: '',
    availableModels: [] as string[],
    loadingModels: false,
    indexProgress: { done: 0, total: 0, running: false },
    reindexing: false,
    backendStatus: 'idle' as const,
    backendError: '',
    embedSelectValue: AIConfig.getEmbeddingInAppModel(),
    webSearchProvider: detectWebSearchProvider(AIConfig.getWebSearchUrl()),
    endpointValue: AIConfig.getEndpoint(),
    selectedProvider: detectChatProvider(AIConfig.getEndpoint()),
    advancedResetKey: 0,
  };
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private _endpointSub: { dispose: () => void } | null = null;

  componentDidMount() {
    KeyManager.getPassword(KEY_API).then((k) => this.setState({ apiKey: k || '' }));
    this._startProgressPolling();
    if (AIConfig.isKnowledgeBaseEnabled()) this._checkBackendReady();
    this._fetchModels();
    this._endpointSub = AppEnv.config.onDidChange(AIConfig.keys.endpoint, () => {
      this._fetchModels();
    });
  }

  componentWillUnmount() {
    this._stopProgressPolling();
    if (this._endpointSub) this._endpointSub.dispose();
  }

  _fetchModels = async () => {
    this.setState({ loadingModels: true });
    const models = await AIService.listModels();
    this.setState({ availableModels: models, loadingModels: false });
  };

  _startProgressPolling() {
    this._stopProgressPolling();
    if (!AIConfig.isKnowledgeBaseEnabled()) return;
    this.progressInterval = setInterval(() => {
      const { Indexer } = require('./indexer');
      this.setState({ indexProgress: Indexer.progress() });
    }, 2000);
  }

  _stopProgressPolling() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  _reindex = async () => {
    this.setState({ reindexing: true });
    try {
      const { Indexer } = require('./indexer');
      await Indexer.reindexAll();
    } finally {
      this.setState({ reindexing: false });
    }
  };

  _clearIndex = () => {
    const { Indexer } = require('./indexer');
    Indexer.clear();
    this.setState({ indexProgress: { done: 0, total: 0, running: false } });
  };

  _checkBackendReady = async () => {
    this.setState({ backendStatus: 'checking', backendError: '' });
    try {
      const { getEmbeddingProvider } = require('./embeddings/provider');
      await getEmbeddingProvider().ready();
      this.setState({ backendStatus: 'ready' });
    } catch (e) {
      this.setState({ backendStatus: 'error', backendError: (e as Error).message });
    }
  };

  _restartIndexer = () => {
    const { Indexer } = require('./indexer');
    Indexer.stop();
    if (AIConfig.isKnowledgeBaseEnabled()) Indexer.start();
  };

  _set = (key: string, value: any) => {
    AppEnv.config.set(key, value);
    this.setState({} as never, () => {
      if (key === AIConfig.keys.kbEnabled) {
        this._startProgressPolling();
        if (AIConfig.isKnowledgeBaseEnabled()) {
          this._checkBackendReady().then(() => {
            if (this.state.backendStatus === 'ready') this._restartIndexer();
          });
        }
      }
      if (
        key === AIConfig.keys.embedBackend ||
        key === AIConfig.keys.embedInAppModel ||
        key === AIConfig.keys.embedServerUrl ||
        key === AIConfig.keys.embedModel
      ) {
        this._checkBackendReady().then(() => {
          if (AIConfig.isKnowledgeBaseEnabled() && this.state.backendStatus === 'ready') {
            this._restartIndexer();
          }
        });
      }
    });
  };

  _saveKey = (name: string, value: string) => {
    if (value) KeyManager.replacePassword(name, value);
    else KeyManager.deletePassword(name);
  };

  _resetAdvanced = () => {
    const K = AIConfig.keys;
    Object.entries({
      [K.chunkSize]: RAG_DEFAULTS.chunkSize,
      [K.chunkOverlap]: RAG_DEFAULTS.chunkOverlap,
      [K.retrieveK]: RAG_DEFAULTS.retrieveK,
      [K.contextBudget]: RAG_DEFAULTS.contextBudget,
      [K.historyFraction]: RAG_DEFAULTS.historyFraction,
      [K.maxAgentSteps]: RAG_DEFAULTS.maxAgentSteps,
      [K.webSearchResults]: RAG_DEFAULTS.webSearchResults,
    }).forEach(([key, val]) => AppEnv.config.set(key, val));
    this.setState({ advancedResetKey: this.state.advancedResetKey + 1 });
  };

  _test = async () => {
    this.setState({ testing: true, testResult: '' });
    const [r] = await Promise.all([
      AIService.testConnection(),
      new Promise((res) => setTimeout(res, 600)),
    ]);
    this.setState({
      testing: false,
      testResult: (r as any).ok
        ? `✓ ${(r as any).error || localized('Connected')}`
        : (r as any).error || localized('Failed'),
    });
  };

  render() {
    const K = AIConfig.keys;
    const { availableModels, loadingModels, embedSelectValue } = this.state;
    const currentModel = AIConfig.getModel();
    const modelInList = availableModels.includes(currentModel);

    const currentEmbedId = AIConfig.getEmbeddingInAppModel();
    const presetEmbed = IN_APP_MODELS.find((m) => m.id === currentEmbedId);
    const isCustomEmbed =
      embedSelectValue === '__custom__' ||
      (!presetEmbed && !IN_APP_MODELS.find((m) => m.id === embedSelectValue));

    return (
      <div className="container-ai-assistant" style={{ maxWidth: 600 }}>
        <section>
          <h2>{localized('AI Assistant')}</h2>
          <label>
            <input
              type="checkbox"
              checked={AIConfig.isEnabled()}
              onChange={(e) => this._set(K.enabled, e.target.checked)}
            />{' '}
            {localized('Enable AI assistant')}
          </label>
        </section>

        <section>
          <h3>{localized('Chat model')}</h3>
          <label>
            {localized('Provider')}
            <select
              value={this.state.selectedProvider}
              onChange={(e) => {
                const p = CHAT_PROVIDERS.find((x) => x.id === e.target.value);
                const url = p?.url || this.state.endpointValue;
                this.setState({ selectedProvider: e.target.value, endpointValue: url });
                this._set(K.endpoint, url);
                this._fetchModels();
              }}
            >
              {CHAT_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.sublabel})
                </option>
              ))}
            </select>
          </label>
          <label>
            {localized('Endpoint URL')}
            <input
              type="text"
              value={this.state.endpointValue}
              onChange={(e) =>
                this.setState({
                  endpointValue: e.target.value,
                  selectedProvider: detectChatProvider(e.target.value),
                })
              }
              onBlur={(e) => {
                this._set(K.endpoint, e.target.value);
                this._fetchModels();
              }}
            />
          </label>
          <label>
            {localized('Model')}
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {availableModels.length > 0 ? (
                <select
                  value={modelInList ? currentModel : '__manual__'}
                  onChange={(e) => {
                    if (e.target.value !== '__manual__') this._set(K.model, e.target.value);
                  }}
                  style={{ flex: 1 }}
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  {!modelInList && <option value="__manual__">{currentModel} (manual)</option>}
                </select>
              ) : (
                <input
                  type="text"
                  defaultValue={currentModel}
                  onBlur={(e) => this._set(K.model, e.target.value)}
                  style={{ flex: 1 }}
                  placeholder="e.g. gpt-4o-mini"
                />
              )}
              <button
                onClick={this._fetchModels}
                disabled={loadingModels}
                title={localized('Reload models from endpoint')}
                style={{ flexShrink: 0 }}
              >
                {loadingModels ? '…' : '↺'}
              </button>
            </div>
            {availableModels.length === 0 && !loadingModels && (
              <div style={{ fontSize: 11, color: 'var(--text-color-subtle)', marginTop: 3 }}>
                {localized('Connect to endpoint to load available models')}
              </div>
            )}
          </label>
          <label>
            {localized('API key')}
            <input
              type="password"
              value={this.state.apiKey}
              onChange={(e) => this.setState({ apiKey: e.target.value })}
              onBlur={(e) => this._saveKey(KEY_API, e.target.value)}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={this._test} disabled={this.state.testing}>
              {this.state.testing ? localized('Testing…') : localized('Test connection')}
            </button>
            {this.state.testResult && (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: this.state.testResult.includes('✓')
                    ? 'var(--color-success, green)'
                    : 'var(--color-danger, red)',
                }}
              >
                {this.state.testResult}
              </span>
            )}
          </div>
        </section>

        <section>
          <h3>{localized('Knowledge base (local)')}</h3>
          <label>
            <input
              type="checkbox"
              checked={AIConfig.isKnowledgeBaseEnabled()}
              onChange={(e) => this._set(K.kbEnabled, e.target.checked)}
            />{' '}
            {localized('Enable knowledge base (index all mail locally)')}
          </label>
          <label>
            {localized('Embeddings backend')}
            <select
              value={AIConfig.getEmbeddingBackend()}
              onChange={(e) => this._set(K.embedBackend, e.target.value)}
            >
              <option value="in-app">{localized('In-app (bundled, zero setup)')}</option>
              <option value="server">{localized('Local server (Ollama / LM Studio)')}</option>
            </select>
          </label>
          {AIConfig.isKnowledgeBaseEnabled() && this.state.backendStatus !== 'idle' && (
            <div style={{ marginBottom: 6, fontSize: 12 }}>
              {this.state.backendStatus === 'checking' && (
                <span style={{ color: 'var(--text-color-subtle)' }}>
                  {localized('Checking backend…')}
                </span>
              )}
              {this.state.backendStatus === 'ready' && (
                <span style={{ color: 'var(--color-success, green)' }}>
                  {localized('Backend ready ✓')}
                </span>
              )}
              {this.state.backendStatus === 'error' && (
                <span style={{ color: 'var(--color-danger, red)' }}>
                  {localized('Backend unavailable: ')}
                  {this.state.backendError}
                </span>
              )}
            </div>
          )}
          {AIConfig.getEmbeddingBackend() === 'in-app' && (
            <>
              <label>
                {localized('Embedding model')}
                <select
                  value={embedSelectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    this.setState({ embedSelectValue: v });
                    if (v !== '__custom__') this._set(K.embedInAppModel, v);
                  }}
                >
                  {IN_APP_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  <option value="__custom__">{localized('Custom (Hugging Face)…')}</option>
                </select>
              </label>
              {isCustomEmbed && (
                <label>
                  {localized('Hugging Face model ID')}
                  <input
                    type="text"
                    defaultValue={
                      embedSelectValue === '__custom__' ? currentEmbedId : embedSelectValue
                    }
                    placeholder="org/model-name"
                    onBlur={(e) => this._set(K.embedInAppModel, e.target.value)}
                  />
                </label>
              )}
              {!isCustomEmbed && (
                <div style={{ fontSize: 12, color: 'var(--text-color-subtle)', marginBottom: 6 }}>
                  {(() => {
                    const preset = IN_APP_MODELS.find((m) => m.id === embedSelectValue);
                    return preset ? (
                      <>
                        {preset.dims} dimensions · {preset.size} download · {preset.desc}
                        {' · '}
                        {localized('cached locally after first use')}
                      </>
                    ) : null;
                  })()}
                </div>
              )}
            </>
          )}
          {AIConfig.getEmbeddingBackend() === 'server' && (
            <>
              <label>
                {localized('Local server URL')}
                <input
                  type="text"
                  defaultValue={AIConfig.getEmbeddingServerUrl()}
                  onBlur={(e) => this._set(K.embedServerUrl, e.target.value)}
                />
              </label>
              <label>
                {localized('Embedding model')}
                <input
                  type="text"
                  defaultValue={AIConfig.getEmbeddingModel()}
                  onBlur={(e) => this._set(K.embedModel, e.target.value)}
                />
              </label>
            </>
          )}
          {AIConfig.isKnowledgeBaseEnabled() && (
            <div id="ai-index-progress" style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 4 }}>
                {localized(
                  'Indexed %@ / %@',
                  String(this.state.indexProgress.done),
                  String(this.state.indexProgress.total)
                )}
                {this.state.indexProgress.running ? localized(' (running…)') : ''}
              </div>
              {this.state.indexProgress.total > 0 && (
                <progress
                  value={this.state.indexProgress.done}
                  max={this.state.indexProgress.total}
                  style={{ width: '100%' }}
                />
              )}
              <div style={{ marginTop: 6 }}>
                <button onClick={this._reindex} disabled={this.state.reindexing}>
                  {localized('Re-index')}
                </button>{' '}
                <button onClick={this._clearIndex}>{localized('Clear index')}</button>
              </div>
            </div>
          )}
        </section>

        <section>
          <h3>{localized('RAG and agent parameters')}</h3>
          <details>
            <summary
              style={{
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--text-color-subtle)',
                marginBottom: 8,
              }}
            >
              {localized('Advanced settings (click to expand)')}
            </summary>
            <div
              key={this.state.advancedResetKey}
              style={{
                marginTop: 10,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0 20px',
              }}
            >
              <label>
                {localized('Chunk size (chars)')}
                <input
                  type="number"
                  min={200}
                  max={4000}
                  step={50}
                  defaultValue={AIConfig.getChunkSize()}
                  onBlur={(e) => this._set(K.chunkSize, Number(e.target.value))}
                />
              </label>
              <label>
                {localized('Chunk overlap (chars)')}
                <input
                  type="number"
                  min={0}
                  max={800}
                  step={25}
                  defaultValue={AIConfig.getChunkOverlap()}
                  onBlur={(e) => this._set(K.chunkOverlap, Number(e.target.value))}
                />
              </label>
              <label>
                {localized('Top-K sources retrieved')}
                <input
                  type="number"
                  min={1}
                  max={30}
                  defaultValue={AIConfig.getRetrieveK()}
                  onBlur={(e) => this._set(K.retrieveK, Number(e.target.value))}
                />
              </label>
              <label>
                {localized('Context budget (chars)')}
                <input
                  type="number"
                  min={1000}
                  max={128000}
                  step={1000}
                  defaultValue={AIConfig.getContextBudget()}
                  onBlur={(e) => this._set(K.contextBudget, Number(e.target.value))}
                />
              </label>
              <label>
                {localized('History fraction (0.1 – 0.9)')}
                <input
                  type="number"
                  min={0.1}
                  max={0.9}
                  step={0.05}
                  defaultValue={AIConfig.getHistoryFraction()}
                  onBlur={(e) => this._set(K.historyFraction, Number(e.target.value))}
                />
              </label>
              <label>
                {localized('Max agent steps')}
                <input
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={AIConfig.getMaxAgentSteps()}
                  onBlur={(e) => this._set(K.maxAgentSteps, Number(e.target.value))}
                />
              </label>
              <label>
                {localized('Web search results')}
                <input
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={AIConfig.getWebSearchResults()}
                  onBlur={(e) => this._set(K.webSearchResults, Number(e.target.value))}
                />
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <button onClick={this._resetAdvanced}>{localized('Reset to defaults')}</button>
              <span style={{ fontSize: 11, color: 'var(--text-color-subtle)' }}>
                {localized('Changing chunk size or overlap requires re-indexing.')}
              </span>
            </div>
          </details>
        </section>

        <section>
          <h3>{localized('Web search (agent skill)')}</h3>
          <label>
            <input
              type="checkbox"
              checked={AIConfig.isWebSearchEnabled()}
              onChange={(e) => this._set(K.webSearchEnabled, e.target.checked)}
            />{' '}
            {localized('Enable web search')}
          </label>
          {AIConfig.isWebSearchEnabled() && (
            <>
              <label>
                {localized('Provider')}
                <select
                  value={this.state.webSearchProvider}
                  onChange={(e) => {
                    const id = e.target.value;
                    const preset = WEB_SEARCH_PROVIDERS.find((p) => p.id === id);
                    this.setState({ webSearchProvider: id });
                    if (preset && preset.url) this._set(K.webSearchUrl, preset.url);
                  }}
                >
                  {WEB_SEARCH_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.sublabel ? ` (${p.sublabel})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {(() => {
                const preset = WEB_SEARCH_PROVIDERS.find(
                  (p) => p.id === this.state.webSearchProvider
                );
                return (
                  <>
                    {(this.state.webSearchProvider === 'custom' ||
                      this.state.webSearchProvider === 'searxng') && (
                      <label>
                        {localized('Provider URL')}
                        <input
                          key={this.state.webSearchProvider}
                          type="text"
                          defaultValue={AIConfig.getWebSearchUrl()}
                          onBlur={(e) => this._set(K.webSearchUrl, e.target.value)}
                        />
                      </label>
                    )}
                    {preset?.id !== 'searxng' && preset?.id !== 'custom' && (
                      <label>
                        {localized('API key')}
                        {preset?.keyUrl && (
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--text-color-subtle)',
                              marginLeft: 6,
                            }}
                          >
                            {localized('Get one at')}{' '}
                            <a
                              href={preset.keyUrl}
                              onClick={(e) => {
                                e.preventDefault();
                                require('electron').shell.openExternal(preset.keyUrl!);
                              }}
                            >
                              {preset.keyUrl.replace('https://', '')}
                            </a>
                          </span>
                        )}
                        <input
                          type="password"
                          onBlur={(e) => this._saveKey(KEY_WEBSEARCH_API, e.target.value)}
                        />
                      </label>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </section>
      </div>
    );
  }
}
