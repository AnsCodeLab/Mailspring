export type SkillTier = 'read' | 'write-reversible' | 'confirm';

// Return value from confirmDialog:
//   'proceed' — show is over, call run()
//   'deny'    — user cancelled, skip run()
//   'done'    — skill handled the action inside confirmDialog itself (e.g. opened composer), skip run()
export type ConfirmResult = 'proceed' | 'deny' | 'done';

export interface Skill {
  name: string;
  description: string;
  parameters: object; // JSON schema
  tier: SkillTier;
  enabled?: () => boolean;
  // If provided, called instead of the generic dialog for confirm-tier skills.
  // ctx carries the live objects from the chat panel (e.g. ctx.thread).
  confirmDialog?: (args: any, ctx?: any) => Promise<ConfirmResult>;
  // Called when the agent issues multiple calls to this same skill in one step — lets the
  // skill show ONE combined dialog instead of N individual prompts.
  confirmManyDialog?: (argsArray: any[], ctx?: any) => Promise<ConfirmResult>;
  run(args: any, ctx: any): Promise<any>;
}
