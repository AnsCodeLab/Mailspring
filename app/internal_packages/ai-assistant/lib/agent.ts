import { SkillRegistry } from './skills/registry';
import { Skill, ConfirmResult } from './skills/types';

export async function runAgent(opts: {
  messages: any[];
  registry: SkillRegistry;
  callModel: (
    messages: any[],
    tools: any[]
  ) => Promise<{
    content?: string;
    tool_calls?: Array<{ id: string; name: string; arguments: any }>;
  }>;
  confirm: (skill: Skill, args: any, ctx: any) => Promise<ConfirmResult>;
  confirmMany: (skill: Skill, argsArray: any[], ctx: any) => Promise<ConfirmResult>;
  ctx?: any;
  maxSteps?: number;
  signal?: AbortSignal;
  onToolStep?: (step: { name: string; args: any; result: any }) => void;
}): Promise<{ answer: string; steps: Array<{ name: string; args: any; result: any }> }> {
  const maxSteps = opts.maxSteps ?? 6;
  const messages = [...opts.messages];
  const steps: Array<{ name: string; args: any; result: any }> = [];
  for (let i = 0; i < maxSteps; i++) {
    if (opts.signal?.aborted) break;
    const resp = await opts.callModel(messages, opts.registry.toOpenAITools());
    if (!resp.tool_calls || !resp.tool_calls.length) {
      return { answer: resp.content || '', steps };
    }

    // Pre-batch confirm-tier calls: when the same confirm-tier skill appears multiple times
    // in one agent step, show a single combined dialog instead of one per call.
    const batchDecisions = new Map<string, ConfirmResult>();
    const confirmGroups = new Map<string, Array<{ id: string; arguments: any }>>();
    for (const call of resp.tool_calls) {
      const skill = opts.registry.get(call.name);
      if (skill?.tier === 'confirm') {
        const arr = confirmGroups.get(call.name) || [];
        arr.push({ id: call.id, arguments: call.arguments });
        confirmGroups.set(call.name, arr);
      }
    }
    for (const [skillName, group] of confirmGroups) {
      if (group.length <= 1) continue; // will be handled individually below
      const skill = opts.registry.get(skillName)!;
      let decision: ConfirmResult = 'deny';
      try {
        decision = await opts.confirmMany(
          skill,
          group.map((g) => g.arguments),
          opts.ctx ?? {}
        );
      } catch {
        decision = 'deny';
      }
      for (const { id } of group) batchDecisions.set(id, decision);
    }

    for (const call of resp.tool_calls) {
      const skill = opts.registry.get(call.name);
      let result: any;
      if (!skill) {
        result = { error: `unknown skill ${call.name}` };
      } else if (skill.tier === 'confirm') {
        const ctx = opts.ctx ?? {};
        let decision: ConfirmResult;
        if (batchDecisions.has(call.id)) {
          // Already resolved by the batch dialog above.
          decision = batchDecisions.get(call.id)!;
        } else {
          try {
            decision = await opts.confirm(skill, call.arguments, ctx);
          } catch (e: any) {
            result = { error: e.message || String(e) };
            const step = { name: call.name, args: call.arguments, result };
            steps.push(step);
            opts.onToolStep?.(step);
            messages.push({
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                },
              ],
            });
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
            continue;
          }
        }
        if (decision === 'deny') {
          result = { error: 'user declined', declined: true };
        } else if (decision === 'done') {
          result = { done: true };
        } else {
          // 'proceed' — run the skill now
          try {
            result = await skill.run(call.arguments, ctx);
          } catch (e: any) {
            result = { error: e.message || String(e) };
          }
        }
      } else {
        try {
          result = await skill.run(call.arguments, opts.ctx ?? {});
        } catch (e: any) {
          result = { error: e.message || String(e) };
        }
      }
      const step = { name: call.name, args: call.arguments, result };
      steps.push(step);
      opts.onToolStep?.(step);
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          },
        ],
      });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  // Hit the step cap — ask the model for a final answer with no tools.
  const fin = await opts.callModel(
    [...messages, { role: 'user', content: 'Give your final answer now.' }],
    []
  );
  return { answer: fin.content || '', steps };
}
