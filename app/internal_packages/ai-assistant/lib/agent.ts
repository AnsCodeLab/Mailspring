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
  confirm: (skill: Skill, args: any) => Promise<ConfirmResult>;
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
    for (const call of resp.tool_calls) {
      const skill = opts.registry.get(call.name);
      let result: any;
      if (!skill) {
        result = { error: `unknown skill ${call.name}` };
      } else if (skill.tier === 'confirm') {
        const decision = await opts.confirm(skill, call.arguments);
        if (decision === 'deny') {
          result = { error: 'user declined', declined: true };
        } else if (decision === 'done') {
          // Skill completed its action inside confirmDialog (e.g. opened composer).
          result = { done: true };
        } else {
          // 'proceed' — run the skill now
          try {
            result = await skill.run(call.arguments, {});
          } catch (e: any) {
            result = { error: e.message || String(e) };
          }
        }
      } else {
        try {
          result = await skill.run(call.arguments, {});
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
