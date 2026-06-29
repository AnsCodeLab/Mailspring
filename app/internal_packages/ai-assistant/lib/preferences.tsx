import React from 'react';
import { localized, KeyManager } from 'mailspring-exports';
import { AIConfig, KEY_API, KEY_WEBSEARCH_API } from './config';
import { AIService } from './ai-service';

export default class AIPreferences extends React.Component<
  Record<string, never>,
  {
    apiKey: string;
    testing: boolean;
    testResult: string;
    indexProgress: { done: number; total: number; running: boolean };
    reindexing: boolean;
  }
> {
  state = {
    apiKey: '',
    testing: false,
    testResult: '',
    indexProgress: { done: 0, total: 0, running: false },
    reindexing: false,
  };
  private progressInterval: ReturnType<typeof setInterval> | null = null;

  componentDidMount() {
    KeyManager.getPassword(KEY_API).then((k) => this.setState({ apiKey: k || '' }));
    this._startProgressPolling();
  }

  componentWillUnmount() {
    this._stopProgressPolling();
  }

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

  _set = (key: string, value: any) => {
    AppEnv.config.set(key, value);
    this.setState({}, () => {
      // Restart progress polling when KB enabled state changes.
      if (key === AIConfig.keys.kbEnabled) {
        this._startProgressPolling();
      }
    });
  };

  _saveKey = (name: string, value: string) => {
    if (value) KeyManager.replacePassword(name, value);
    else KeyManager.deletePassword(name);
  };

  _test = async () => {
    this.setState({ testing: true, testResult: '' });
    const r = await AIService.testConnection();
    this.setState({
      testing: false,
      testResult: r.ok ? localized('Connected ✓') : r.error || 'Failed',
    });
  };

  render() {
    const K = AIConfig.keys;
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
            {localized('Endpoint URL')}
            <input
              type="text"
              defaultValue={AIConfig.getEndpoint()}
              onBlur={(e) => this._set(K.endpoint, e.target.value)}
            />
          </label>
          <label>
            {localized('Model')}
            <input
              type="text"
              defaultValue={AIConfig.getModel()}
              onBlur={(e) => this._set(K.model, e.target.value)}
            />
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
          <button onClick={this._test} disabled={this.state.testing}>
            {localized('Test connection')}
          </button>{' '}
          <span>{this.state.testResult}</span>
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
              defaultValue={AIConfig.getEmbeddingBackend()}
              onChange={(e) => this._set(K.embedBackend, e.target.value)}
            >
              <option value="in-app">{localized('In-app (bundled, zero setup)')}</option>
              <option value="server">{localized('Local server (Ollama / LM Studio)')}</option>
            </select>
          </label>
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
          {AIConfig.isKnowledgeBaseEnabled() && (
            <div id="ai-index-progress" style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 4 }}>
                {localized('Indexed %1 / %2', [
                  String(this.state.indexProgress.done),
                  String(this.state.indexProgress.total),
                ])}
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
          <h3>{localized('Web search (agent skill)')}</h3>
          <label>
            <input
              type="checkbox"
              checked={AIConfig.isWebSearchEnabled()}
              onChange={(e) => this._set(K.webSearchEnabled, e.target.checked)}
            />{' '}
            {localized(
              'Enable web search — queries leave your machine (use local SearXNG for privacy)'
            )}
          </label>
          <label>
            {localized('Provider URL')}
            <input
              type="text"
              defaultValue={AIConfig.getWebSearchUrl()}
              onBlur={(e) => this._set(K.webSearchUrl, e.target.value)}
            />
          </label>
          <label>
            {localized('API key')}
            <input
              type="password"
              onBlur={(e) => this._saveKey(KEY_WEBSEARCH_API, e.target.value)}
            />
          </label>
        </section>
      </div>
    );
  }
}
