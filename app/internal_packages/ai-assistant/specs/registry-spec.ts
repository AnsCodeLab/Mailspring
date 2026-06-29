import { SkillRegistry } from '../lib/skills/registry';

const mk = (name: string, enabled = true) => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
  tier: 'read' as const,
  enabled: () => enabled,
  run: async () => 'ok',
});

describe('SkillRegistry', () => {
  let r: SkillRegistry;
  beforeEach(() => {
    r = new SkillRegistry();
  });
  it('lists only enabled skills', () => {
    r.register(mk('a', true));
    r.register(mk('b', false));
    expect(r.list().map((s) => s.name)).toEqual(['a']);
  });
  it('serializes to OpenAI tool format', () => {
    r.register(mk('a'));
    const tools = r.toOpenAITools();
    expect(tools[0]).toEqual({
      type: 'function',
      function: { name: 'a', description: 'a', parameters: { type: 'object', properties: {} } },
    });
  });
  it('unregister removes a skill', () => {
    r.register(mk('a'));
    r.unregister('a');
    expect(r.list()).toEqual([]);
  });
});
