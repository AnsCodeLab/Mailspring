import { buildTranscript, baseArgs, resultError } from '../lib/claude-cli-service';
import { AIConfig } from '../lib/config';

describe('claude-cli-service', () => {
  describe('buildTranscript', () => {
    it('separates system content from the conversation turns', () => {
      const { systemPrompt, prompt } = buildTranscript([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ]);
      expect(systemPrompt).toBe('You are helpful.');
      expect(prompt).toBe('Human: Hi\n\nAssistant: Hello!');
    });

    it('joins multiple system messages', () => {
      const { systemPrompt } = buildTranscript([
        { role: 'system', content: 'A' },
        { role: 'system', content: 'B' },
      ]);
      expect(systemPrompt).toBe('A\n\nB');
    });

    it('labels tool-role messages distinctly', () => {
      const { prompt } = buildTranscript([{ role: 'tool', content: 'result data' }]);
      expect(prompt).toBe('Tool result: result data');
    });
  });

  describe('baseArgs', () => {
    // These flags are the entire security boundary between this service and the user's
    // filesystem/shell — email content is untrusted and must never reach a tool-enabled CLI.
    it('always disables every built-in tool', () => {
      const args = baseArgs('json', '');
      const toolsIdx = args.indexOf('--tools');
      expect(toolsIdx).toBeGreaterThan(-1);
      expect(args[toolsIdx + 1]).toBe('');
    });

    it('always runs in safe mode with slash commands and session persistence disabled', () => {
      const args = baseArgs('json', '');
      expect(args).toContain('--safe-mode');
      expect(args).toContain('--disable-slash-commands');
      expect(args).toContain('--no-session-persistence');
    });

    it('never includes a permission-bypass flag', () => {
      const args = baseArgs('json', '');
      expect(args.join(' ')).not.toMatch(/dangerously-skip-permissions|bypassPermissions/);
    });

    it('adds streaming flags only for stream-json', () => {
      expect(baseArgs('json', '')).not.toContain('--include-partial-messages');
      expect(baseArgs('stream-json', '')).toContain('--include-partial-messages');
      expect(baseArgs('stream-json', '')).toContain('--verbose');
    });

    it('passes the system prompt through when provided', () => {
      const args = baseArgs('json', 'Be terse.');
      const idx = args.indexOf('--system-prompt');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('Be terse.');
    });

    it('omits --system-prompt when empty', () => {
      expect(baseArgs('json', '')).not.toContain('--system-prompt');
    });

    it('includes a model override only when configured', () => {
      spyOn(AIConfig, 'getClaudeCliModel').andReturn('opus');
      const args = baseArgs('json', '');
      const idx = args.indexOf('--model');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('opus');
    });
  });

  describe('resultError', () => {
    it('rewrites the CLI "not logged in" message into a Mailspring-actionable one', () => {
      const err = resultError('Not logged in · Please run /login');
      expect(err.message).not.toMatch(/\/login/);
      expect(err.message.toLowerCase()).toContain('not logged in');
      expect(err.message).toContain('claude');
    });

    it('leaves unrelated error messages unchanged', () => {
      const err = resultError('There was an issue with the selected model.');
      expect(err.message).toBe('There was an issue with the selected model.');
    });

    it('falls back to a generic message when the CLI gives none', () => {
      const err = resultError(undefined);
      expect(err.message).toBe('Claude CLI returned an error.');
    });
  });
});
