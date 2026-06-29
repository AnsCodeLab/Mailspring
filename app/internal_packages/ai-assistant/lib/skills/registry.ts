import { Skill } from './types';
export class SkillRegistry {
  private skills = new Map<string, Skill>();
  register(skill: Skill) {
    this.skills.set(skill.name, skill);
  }
  unregister(name: string) {
    this.skills.delete(name);
  }
  get(name: string) {
    return this.skills.get(name);
  }
  list(): Skill[] {
    return [...this.skills.values()].filter((s) => (s.enabled ? s.enabled() : true));
  }
  toOpenAITools(): any[] {
    return this.list().map((s) => ({
      type: 'function',
      function: { name: s.name, description: s.description, parameters: s.parameters },
    }));
  }
}
export const Skills = new SkillRegistry();
