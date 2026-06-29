export type SkillTier = 'read' | 'write-reversible' | 'confirm';
export interface Skill {
  name: string;
  description: string;
  parameters: object; // JSON schema
  tier: SkillTier;
  enabled?: () => boolean;
  run(args: any, ctx: any): Promise<any>;
}
