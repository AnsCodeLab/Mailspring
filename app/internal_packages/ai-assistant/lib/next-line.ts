import { AIService } from './ai-service';
import { buildNextLinePrompt, SenderIdentity } from './prompts';

export async function suggestNextLine(
  draftBodyHtml: string,
  sender?: SenderIdentity
): Promise<string> {
  const draftSoFar = (draftBodyHtml || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (await AIService.chat({ messages: buildNextLinePrompt({ draftSoFar, sender }) })).trim();
}
