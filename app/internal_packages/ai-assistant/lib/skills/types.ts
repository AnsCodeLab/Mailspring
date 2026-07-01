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
  confirmDialog?: (args: any) => Promise<ConfirmResult>;
  run(args: any, ctx: any): Promise<any>;
}
