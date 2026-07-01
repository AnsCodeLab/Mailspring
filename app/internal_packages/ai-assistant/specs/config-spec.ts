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
  it('send email skill disabled by default', () =>
    expect(AIConfig.isSkillSendEmailEnabled()).toBe(false));
  it('trash thread skill disabled by default', () =>
    expect(AIConfig.isSkillTrashThreadEnabled()).toBe(false));
  it('archive thread skill disabled by default', () =>
    expect(AIConfig.isSkillArchiveThreadEnabled()).toBe(false));
  it('rag mode defaults to default', () => expect(AIConfig.getRagMode()).toBe('default'));
});
