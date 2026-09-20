import os from 'os';
import {
  buildTranscript,
  baseArgs,
  resultError,
  notFoundError,
  spawnOptions,
  parseStreamLine,
} from '../lib/cursor-cli-service';
import { AIConfig } from '../lib/config';

describe('cursor-cli-service', () => {
  describe('buildTranscript', () => {
    it('folds system content into the prompt body', () => {
      const { prompt } = buildTranscript([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ]);
      expect(prompt).toBe('System:\nYou are helpful.\n\nHuman: Hi\n\nAssistant: Hello!');
    });

    it('joins multiple system messages before the turns', () => {
      const { prompt } = buildTranscript([
        { role: 'system', content: 'A' },
        { role: 'system', content: 'B' },
        { role: 'user', content: 'Hi' },
      ]);
      expect(prompt).toBe('System:\nA\n\nB\n\nHuman: Hi');
    });

    it('labels tool-role messages distinctly', () => {
      const { prompt } = buildTranscript([{ role: 'tool', content: 'result data' }]);
      expect(prompt).toBe('Tool result: result data');
    });

    it('omits the System block when there is no system message', () => {
      const { prompt } = buildTranscript([{ role: 'user', content: 'Hi' }]);
      expect(prompt).toBe('Human: Hi');
      expect(prompt).not.toMatch(/^System:/);
    });
  });

  describe('baseArgs', () => {
    // These flags are the security boundary: ask-mode + trust + no force/yolo/sandbox-off.
    it('always runs print mode with --mode ask and --trust', () => {
      const args = baseArgs('json');
      expect(args).toContain('-p');
      const modeIdx = args.indexOf('--mode');
      expect(modeIdx).toBeGreaterThan(-1);
      expect(args[modeIdx + 1]).toBe('ask');
      expect(args).toContain('--trust');
    });

    it('sets the requested output format', () => {
      const jsonArgs = baseArgs('json');
      const streamArgs = baseArgs('stream-json');
      expect(jsonArgs[jsonArgs.indexOf('--output-format') + 1]).toBe('json');
      expect(streamArgs[streamArgs.indexOf('--output-format') + 1]).toBe('stream-json');
    });

    it('adds --stream-partial-output only for stream-json', () => {
      expect(baseArgs('json')).not.toContain('--stream-partial-output');
      expect(baseArgs('stream-json')).toContain('--stream-partial-output');
    });

    it('includes a model override only when configured', () => {
      spyOn(AIConfig, 'getCursorCliModel').andReturn('gpt-5');
      const args = baseArgs('json');
      const idx = args.indexOf('--model');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('gpt-5');
    });

    it('omits --model when the override is empty', () => {
      spyOn(AIConfig, 'getCursorCliModel').andReturn('');
      expect(baseArgs('json')).not.toContain('--model');
    });

    it('never includes force, yolo, or sandbox-disabled flags', () => {
      const joined = baseArgs('stream-json').join(' ');
      expect(joined.split(/\s+/)).not.toContain('-f');
      expect(joined).not.toMatch(/(^|\s)--force(\s|$)/);
      expect(joined).not.toMatch(/(^|\s)--yolo(\s|$)/);
      expect(joined).not.toContain('--sandbox disabled');
    });
  });

  describe('spawnOptions', () => {
    it('uses the OS temp directory and hides the window on Windows', () => {
      const opts = spawnOptions();
      expect(opts.cwd).toBe(os.tmpdir());
      expect(opts.windowsHide).toBe(true);
    });
  });

  describe('parseStreamLine (NDJSON golden fixtures)', () => {
    const partialAssistant = JSON.stringify({
      type: 'assistant',
      timestamp_ms: 1710000000000,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
      },
    });

    const finalAssistant = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello full duplicate' }],
      },
    });

    const thinking = JSON.stringify({
      type: 'thinking',
      text: 'planning…',
    });

    const system = JSON.stringify({
      type: 'system',
      subtype: 'init',
    });

    const errorResult = JSON.stringify({
      type: 'result',
      is_error: true,
      result: 'Not logged in. Please run agent login',
    });

    it('yields text from timestamped assistant partial deltas', () => {
      expect(parseStreamLine(partialAssistant)).toBe('Hello');
    });

    it('ignores non-timestamped final assistant events', () => {
      expect(parseStreamLine(finalAssistant)).toBeNull();
    });

    it('ignores thinking and system events', () => {
      expect(parseStreamLine(thinking)).toBeNull();
      expect(parseStreamLine(system)).toBeNull();
    });

    it('throws via resultError on result events with is_error', () => {
      expect(() => parseStreamLine(errorResult)).toThrow();
      try {
        parseStreamLine(errorResult);
      } catch (err: any) {
        expect(err.message.toLowerCase()).toContain('not logged in');
        expect(err.message).toContain('agent login');
      }
    });

    it('returns null for blank or non-JSON lines', () => {
      expect(parseStreamLine('')).toBeNull();
      expect(parseStreamLine('not-json')).toBeNull();
    });
  });

  describe('resultError', () => {
    it('rewrites not-logged-in / auth messaging to mention agent login', () => {
      const err = resultError('Not logged in. Please authenticate.');
      expect(err.message.toLowerCase()).toContain('not logged in');
      expect(err.message).toContain('agent login');
    });

    it('leaves unrelated error messages unchanged', () => {
      const err = resultError('There was an issue with the selected model.');
      expect(err.message).toBe('There was an issue with the selected model.');
    });

    it('falls back to a generic message when the CLI gives none', () => {
      const err = resultError(undefined);
      expect(err.message).toBe('Cursor CLI returned an error.');
    });
  });

  describe('notFoundError', () => {
    it('mentions the configured path and Preferences > AI Assistant', () => {
      spyOn(AIConfig, 'getCursorCliPath').andReturn('/opt/agent');
      const err = notFoundError();
      expect(err.kind).toBe('not-found');
      expect(err.message).toContain('/opt/agent');
      expect(err.message).toContain('Preferences');
      expect(err.message).toContain('AI Assistant');
    });
  });
});
