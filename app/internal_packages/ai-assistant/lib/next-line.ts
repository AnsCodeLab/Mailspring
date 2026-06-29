import { AIService } from './ai-service';
import { buildNextLinePrompt } from './prompts';

export async function suggestNextLine(draftBodyHtml: string): Promise<string> {
  const draftSoFar = (draftBodyHtml || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (await AIService.chat({ messages: buildNextLinePrompt({ draftSoFar }) })).trim();
}
