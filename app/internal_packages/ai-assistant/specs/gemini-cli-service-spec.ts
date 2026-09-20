import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  buildTranscript,
  baseArgs,
  resultError,
  notFoundError,
  prepareWorkdir,
  spawnOptions,
  parseStreamLine,
  parseJsonResponse,
  workspaceSettings,
  CURATED_GEMINI_MODELS,
  GEMINI_PROMPT_INSTRUCTION,
  EXCLUDED_GEMINI_TOOLS,
  GeminiCliService,
} from '../lib/gemini-cli-service';
import { AIConfig } from '../lib/config';

describe('gemini-cli-service', () => {
  describe('buildTranscript', () => {
    it('folds system content into the prompt body and labels turns', () => {
      const { prompt } = buildTranscript([
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'tool', content: 'tool-out' },
      ]);
      expect(prompt).toContain('System:\nBe brief.');
      expect(prompt).toContain('Human: Hi');
      expect(prompt).toContain('Assistant: Hello');
      expect(prompt).toContain('Tool result: tool-out');
    });
  });

  describe('baseArgs', () => {
    it('always uses plan mode, skip-trust, and -e none with a short -p instruction', () => {
      const args = baseArgs('json');
      expect(args.indexOf('-p')).toBeGreaterThan(-1);
      expect(args[args.indexOf('-p') + 1]).toBe(GEMINI_PROMPT_INSTRUCTION);
      expect(args[args.indexOf('--approval-mode') + 1]).toBe('plan');
      expect(args).toContain('--skip-trust');
      expect(args[args.indexOf('-e') + 1]).toBe('none');
      expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    });

    it('never enables yolo / force / auto_edit', () => {
      const joined = baseArgs('stream-json').join(' ');
      expect(joined).not.toMatch(/(^|\s)-y(\s|$)/);
      expect(joined).not.toMatch(/--yolo/);
      expect(joined).not.toMatch(/auto_edit/);
      expect(joined).not.toMatch(/--force/);
    });

    it('includes a model override only when configured', () => {
      spyOn(AIConfig, 'getGeminiCliModel').andReturn('gemini-2.5-flash');
      const args = baseArgs('json');
      const idx = args.indexOf('-m');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('gemini-2.5-flash');
    });
  });

  describe('prepareWorkdir / spawnOptions', () => {
    it('creates a tmp workdir with disableYoloMode and excluded write/shell tools', () => {
      const dir = prepareWorkdir();
      expect(dir.startsWith(os.tmpdir())).toBe(true);
      const settingsPath = path.join(dir, '.gemini', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.security.disableYoloMode).toBe(true);
      for (const tool of EXCLUDED_GEMINI_TOOLS) {
        expect(settings.tools.exclude).toContain(tool);
      }
      const so = spawnOptions(dir);
      expect(so.cwd).toBe(dir);
      expect(so.windowsHide).toBe(true);
      // cleanup
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('workspaceSettings matches the on-disk hardenings', () => {
      const s: any = workspaceSettings();
      expect(s.security.disableYoloMode).toBe(true);
      expect(s.tools.exclude).toEqual([...EXCLUDED_GEMINI_TOOLS]);
    });
  });

  describe('parseStreamLine', () => {
    it('yields assistant delta content only', () => {
      expect(
        parseStreamLine(
          JSON.stringify({
            type: 'message',
            role: 'assistant',
            content: 'Hi',
            delta: true,
            timestamp: 't',
          })
        )
      ).toBe('Hi');
    });

    it('ignores non-delta assistant messages', () => {
      expect(
        parseStreamLine(
          JSON.stringify({
            type: 'message',
            role: 'assistant',
            content: 'Hi',
            timestamp: 't',
          })
        )
      ).toBeNull();
    });

    it('ignores init, tools, user messages, and warning errors', () => {
      expect(parseStreamLine(JSON.stringify({ type: 'init', model: 'x' }))).toBeNull();
      expect(parseStreamLine(JSON.stringify({ type: 'tool_use', tool_name: 'x' }))).toBeNull();
      expect(
        parseStreamLine(JSON.stringify({ type: 'message', role: 'user', content: 'q', delta: true }))
      ).toBeNull();
      expect(
        parseStreamLine(
          JSON.stringify({ type: 'error', severity: 'warning', message: 'slow' })
        )
      ).toBeNull();
    });

    it('throws on severity=error and result status=error', () => {
      expect(() =>
        parseStreamLine(JSON.stringify({ type: 'error', severity: 'error', message: 'boom' }))
      ).toThrow();
      expect(() =>
        parseStreamLine(
          JSON.stringify({ type: 'result', status: 'error', error: { message: 'fail' } })
        )
      ).toThrow();
    });
  });

  describe('parseJsonResponse', () => {
    it('reads the response field', () => {
      expect(parseJsonResponse(JSON.stringify({ response: 'OK', stats: {} }))).toBe('OK');
    });

    it('surfaces error.message via resultError', () => {
      let err: any;
      try {
        parseJsonResponse(JSON.stringify({ error: { message: 'Not logged in' } }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/GEMINI_API_KEY|sign in/i);
    });
  });

  describe('resultError', () => {
    it('rewrites Antigravity / ineligible tier errors', () => {
      const err = resultError('IneligibleTierError: migrate to Antigravity');
      expect(err.message).toMatch(/GEMINI_API_KEY|Antigravity|Code Assist/i);
    });

    it('rewrites auth / API key errors', () => {
      const err = resultError('authentication failed: missing API key');
      expect(err.message).toMatch(/GEMINI_API_KEY|sign in/i);
    });

    it('leaves unrelated messages unchanged', () => {
      expect(resultError('rate limited').message).toBe('rate limited');
    });
  });

  describe('notFoundError', () => {
    it('mentions the configured path and Preferences > AI Assistant', () => {
      spyOn(AIConfig, 'getGeminiCliPath').andReturn('/opt/gemini');
      const err = notFoundError();
      expect(err.kind).toBe('not-found');
      expect(err.message).toContain('/opt/gemini');
      expect(err.message).toContain('Preferences');
      expect(err.message).toContain('AI Assistant');
    });
  });

  describe('listModels', () => {
    it('returns the curated static model list', async () => {
      const models = await GeminiCliService.listModels();
      expect(models).toEqual([...CURATED_GEMINI_MODELS]);
    });
  });
});
