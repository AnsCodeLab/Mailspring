import { AIConfig } from '../lib/config';

describe('AIConfig defaults', () => {
  beforeEach(() => {
    // AppEnv.config is the global config; stub get to return undefined (unset)
    spyOn(AppEnv.config, 'get').andCallFake(() => undefined);
  });
  it('is disabled by default', () => expect(AIConfig.isEnabled()).toBe(false));
  it('knowledge base disabled by default', () =>
    expect(AIConfig.isKnowledgeBaseEnabled()).toBe(false));
  it('defaults endpoint to OpenAI', () =>
    expect(AIConfig.getEndpoint()).toBe('https://api.openai.com/v1'));
  it('defaults chat model', () => expect(AIConfig.getModel()).toBe('gpt-4o-mini'));
  it('defaults embedding backend to in-app', () =>
    expect(AIConfig.getEmbeddingBackend()).toBe('in-app'));
  it('web search disabled by default', () => expect(AIConfig.isWebSearchEnabled()).toBe(false));
  it('send email skill enabled by default', () =>
    expect(AIConfig.isSkillSendEmailEnabled()).toBe(true));
  it('trash thread skill enabled by default', () =>
    expect(AIConfig.isSkillTrashThreadEnabled()).toBe(true));
  it('archive thread skill enabled by default', () =>
    expect(AIConfig.isSkillArchiveThreadEnabled()).toBe(true));
  it('rag mode defaults to default', () => expect(AIConfig.getRagMode()).toBe('default'));
  it('provider defaults to api', () => expect(AIConfig.getProvider()).toBe('api'));
  it('claude CLI path defaults to "claude"', () =>
    expect(AIConfig.getClaudeCliPath()).toBe('claude'));
  it('claude CLI model override defaults to empty', () =>
    expect(AIConfig.getClaudeCliModel()).toBe(''));
  it('minScore defaults to 0.25', () => expect(AIConfig.getMinScore()).toBe(0.25));
});

describe('AIConfig.getMinScore clamping', () => {
  it('clamps to [0, 1]', () => {
    const spy = spyOn(AppEnv.config, 'get').andReturn(-0.5);
    expect(AIConfig.getMinScore()).toBe(0);
    spy.andReturn(1.5);
    expect(AIConfig.getMinScore()).toBe(1);
    spy.andReturn(0.4);
    expect(AIConfig.getMinScore()).toBe(0.4);
  });
});
