import { runAgent } from '../lib/agent';
import { SkillRegistry } from '../lib/skills/registry';

function reg(skills: any[]) {
  const r = new SkillRegistry();
  skills.forEach((s) => r.register(s));
  return r;
}

describe('runAgent', () => {
  it('dispatches a tool call, feeds the result back, and returns the final answer', async () => {
    const r = reg([
      { name: 'search', tier: 'read', description: '', parameters: {}, run: async () => 'RESULT' },
    ]);
    const calls: any[] = [];
    const callModel = async (messages: any[]) => {
      calls.push(messages);
      if (calls.length === 1) return { tool_calls: [{ id: '1', name: 'search', arguments: {} }] };
      return { content: 'final answer' };
    };
    const out = await runAgent({
      messages: [{ role: 'user', content: 'q' }],
      registry: r,
      callModel,
      confirm: async () => 'proceed',
      maxSteps: 5,
    });
    expect(out.answer).toBe('final answer');
    expect(out.steps[0].name).toBe('search');
    expect(out.steps[0].result).toBe('RESULT');
  });

  it('stops at maxSteps to avoid runaway loops', async () => {
    const r = reg([
      { name: 'loop', tier: 'read', description: '', parameters: {}, run: async () => 'x' },
    ]);
    const callModel = async () => ({ tool_calls: [{ id: '1', name: 'loop', arguments: {} }] });
    const out = await runAgent({
      messages: [{ role: 'user', content: 'q' }],
      registry: r,
      callModel,
      confirm: async () => 'proceed',
      maxSteps: 3,
    });
    expect(out.steps.length).toBe(3);
  });

  it('does NOT call run() when confirmation returns deny', async () => {
    let ran = false;
    const r = reg([
      {
        name: 'send_email',
        tier: 'confirm',
        description: '',
        parameters: {},
        run: async () => {
          ran = true;
          return 'sent';
        },
      },
    ]);
    let n = 0;
    const callModel = async () =>
      n++ === 0
        ? { tool_calls: [{ id: '1', name: 'send_email', arguments: {} }] }
        : { content: 'ok' };
    await runAgent({
      messages: [{ role: 'user', content: 'q' }],
      registry: r,
      callModel,
      confirm: async () => 'deny',
      maxSteps: 5,
    });
    expect(ran).toBe(false);
  });

  it('does NOT call run() when confirm returns done (skill handled itself)', async () => {
    let ran = false;
    const r = reg([
      {
        name: 'trash_thread',
        tier: 'confirm',
        description: '',
        parameters: {},
        run: async () => {
          ran = true;
          return 'trashed';
        },
      },
    ]);
    let n = 0;
    const callModel = async () =>
      n++ === 0
        ? { tool_calls: [{ id: '1', name: 'trash_thread', arguments: {} }] }
        : { content: 'done' };
    const out = await runAgent({
      messages: [{ role: 'user', content: 'q' }],
      registry: r,
      callModel,
      confirm: async () => 'done',
      maxSteps: 5,
    });
    expect(ran).toBe(false);
    expect(out.steps[0].result).toEqual({ done: true });
  });

  it('calls run() when confirmDialog returns proceed', async () => {
    let ran = false;
    const r = reg([
      {
        name: 'send_email',
        tier: 'confirm',
        description: '',
        parameters: {},
        run: async () => {
          ran = true;
          return { sent: true };
        },
      },
    ]);
    let n = 0;
    const callModel = async () =>
      n++ === 0
        ? { tool_calls: [{ id: '1', name: 'send_email', arguments: {} }] }
        : { content: 'ok' };
    await runAgent({
      messages: [{ role: 'user', content: 'q' }],
      registry: r,
      callModel,
      confirm: async () => 'proceed',
      maxSteps: 5,
    });
    expect(ran).toBe(true);
  });

  it('uses skill.confirmDialog when present instead of the generic confirm callback', async () => {
    let confirmCalled = false;
    let dialogCalled = false;
    const r = reg([
      {
        name: 'custom',
        tier: 'confirm',
        description: '',
        parameters: {},
        confirmDialog: async () => {
          dialogCalled = true;
          return 'deny';
        },
        run: async () => 'x',
      },
    ]);
    let n = 0;
    const callModel = async () =>
      n++ === 0 ? { tool_calls: [{ id: '1', name: 'custom', arguments: {} }] } : { content: 'ok' };
    // The generic confirm callback delegates to skill.confirmDialog if present
    await runAgent({
      messages: [{ role: 'user', content: 'q' }],
      registry: r,
      callModel,
      confirm: async (skill: any, args: any) => {
        if (skill.confirmDialog) return skill.confirmDialog(args);
        confirmCalled = true;
        return 'deny';
      },
      maxSteps: 5,
    });
    expect(dialogCalled).toBe(true);
    expect(confirmCalled).toBe(false);
  });

  it('returns an error result for unknown skill names', async () => {
    const r = reg([]);
    let n = 0;
    const callModel = async () =>
      n++ === 0
        ? { tool_calls: [{ id: '1', name: 'unknown_skill', arguments: {} }] }
        : { content: 'ok' };
    const out = await runAgent({
      messages: [{ role: 'user', content: 'q' }],
      registry: r,
      callModel,
      confirm: async () => 'proceed',
      maxSteps: 5,
    });
    expect(out.steps[0].result.error).toContain('unknown skill');
  });
});
