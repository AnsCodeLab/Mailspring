import os from 'os';
import {
  buildTranscript,
  buildPrintPrompt,
  baseArgs,
  resultError,
  notFoundError,
  prepareWorkdir,
  spawnOptions,
  parseStreamLine,
  createStreamParseState,
  parseJsonResponse,
  parseListModelsOutput,
  failureFromCliOutput,
  CURATED_ANTIGRAVITY_MODELS,
  ANTIGRAVITY_PROMPT_INSTRUCTION,
  MAX_PROMPT_BYTES,
  GETTING_STARTED_URL,
  AntigravityCliService,
} from '../lib/antigravity-cli-service';
import { AIConfig } from '../lib/config';

describe('antigravity-cli-service', () => {
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

  describe('buildPrintPrompt', () => {
    it('prefixes the text-only instruction', () => {
      const p = buildPrintPrompt('Human: Hi');
      expect(p.indexOf(ANTIGRAVITY_PROMPT_INSTRUCTION)).toBe(0);
      expect(p).toContain('Human: Hi');
    });

    it('fails closed when the prompt exceeds the argv byte limit', () => {
      const huge = 'x'.repeat(MAX_PROMPT_BYTES);
      let err: any;
      try {
        buildPrintPrompt(huge);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/too large|limit/i);
    });
  });

  describe('baseArgs', () => {
    it('always uses plan, sandbox, disable-slash-commands, and -p prompt', () => {
      const args = baseArgs('json', 'PROMPT');
      expect(args[args.indexOf('-p') + 1]).toBe('PROMPT');
      expect(args[args.indexOf('--mode') + 1]).toBe('plan');
      expect(args).toContain('--sandbox');
      expect(args).toContain('--disable-slash-commands');
      expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    });

    it('never enables dangerously-skip-permissions', () => {
      const joined = baseArgs('stream-json', 'P').join(' ');
      expect(joined).not.toMatch(/dangerously-skip-permissions/);
    });

    it('includes a model override only when configured', () => {
      spyOn(AIConfig, 'getAntigravityCliModel').andReturn('gemini-3.6-flash-medium');
      const args = baseArgs('json', 'P');
      const idx = args.indexOf('--model');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('gemini-3.6-flash-medium');
    });
  });

  describe('prepareWorkdir / spawnOptions', () => {
    it('creates a tmp workdir and pins cwd + windowsHide', () => {
      const dir = prepareWorkdir();
      expect(dir.startsWith(os.tmpdir())).toBe(true);
      expect(dir).toMatch(/mailspring-agy-/);
      const so = spawnOptions(dir);
      expect(so.cwd).toBe(dir);
      expect(so.windowsHide).toBe(true);
      require('fs').rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('parseStreamLine', () => {
    it('yields ACTIVE agent_response text_delta', () => {
      const state = createStreamParseState();
      expect(
        parseStreamLine(
          JSON.stringify({
            event: 'step_update',
            step_update: {
              step_index: 2,
              state: 'ACTIVE',
              step_type: 'agent_response',
              text_delta: 'Hi',
            },
          }),
          state
        )
      ).toBe('Hi');
      expect(state.yieldedAny).toBe(true);
    });

    it('ignores DONE text_delta when ACTIVE already yielded for that step', () => {
      const state = createStreamParseState();
      parseStreamLine(
        JSON.stringify({
          event: 'step_update',
          step_update: {
            step_index: 2,
            state: 'ACTIVE',
            step_type: 'agent_response',
            text_delta: 'Hi',
          },
        }),
        state
      );
      expect(
        parseStreamLine(
          JSON.stringify({
            event: 'step_update',
            step_update: {
              step_index: 2,
              state: 'DONE',
              step_type: 'agent_response',
              text_delta: 'Hi\n',
            },
          }),
          state
        )
      ).toBeNull();
    });

    it('yields DONE text_delta when no ACTIVE was seen for that step', () => {
      const state = createStreamParseState();
      expect(
        parseStreamLine(
          JSON.stringify({
            event: 'step_update',
            step_update: {
              step_index: 1,
              state: 'DONE',
              step_type: 'agent_response',
              text_delta: 'OnlyDone',
            },
          }),
          state
        )
      ).toBe('OnlyDone');
    });

    it('ignores init, tools, and malformed JSON', () => {
      const state = createStreamParseState();
      expect(parseStreamLine(JSON.stringify({ event: 'init', init: {} }), state)).toBeNull();
      expect(
        parseStreamLine(
          JSON.stringify({
            event: 'step_update',
            step_update: { step_type: 'tool', tool_name: 'run_command' },
          }),
          state
        )
      ).toBeNull();
      expect(parseStreamLine('{not-json', state)).toBeNull();
    });

    it('throws on non-SUCCESS result and does not re-yield SUCCESS response after deltas', () => {
      const state = createStreamParseState();
      state.yieldedAny = true;
      expect(
        parseStreamLine(
          JSON.stringify({
            event: 'result',
            result: { status: 'SUCCESS', response: 'full' },
          }),
          state
        )
      ).toBeNull();

      let err: any;
      try {
        parseStreamLine(
          JSON.stringify({
            event: 'result',
            result: { status: 'ERROR', error: 'authentication required' },
          }),
          createStreamParseState()
        );
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/agy|sign-in|getting-started/i);
    });
  });

  describe('parseJsonResponse', () => {
    it('reads the response field on SUCCESS', () => {
      expect(
        parseJsonResponse(JSON.stringify({ status: 'SUCCESS', response: 'OK', usage: {} }))
      ).toBe('OK');
    });

    it('surfaces ERROR via resultError', () => {
      let err: any;
      try {
        parseJsonResponse(
          JSON.stringify({ status: 'ERROR', response: '', error: 'authentication required' })
        );
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(String(err.message)).toMatch(/agy|sign-in|getting-started/i);
    });
  });

  describe('resultError', () => {
    it('rewrites authentication required / not logged in', () => {
      const err = resultError('authentication required');
      expect(err.message).toContain(GETTING_STARTED_URL);
      expect(err.message).toMatch(/agy/);
    });

    it('does not treat unrelated "login" text as auth failure', () => {
      expect(resultError('failed to parse login.toml').message).toBe('failed to parse login.toml');
    });

    it('leaves unrelated messages unchanged', () => {
      expect(resultError('rate limited').message).toBe('rate limited');
    });
  });

  describe('notFoundError', () => {
    it('mentions path, Preferences, and getting-started URL', () => {
      spyOn(AIConfig, 'getAntigravityCliPath').andReturn('/opt/agy');
      const err = notFoundError();
      expect(err.kind).toBe('not-found');
      expect(err.message).toContain('/opt/agy');
      expect(err.message).toContain('Preferences');
      expect(err.message).toContain(GETTING_STARTED_URL);
    });
  });

  describe('failureFromCliOutput', () => {
    it('rewrites auth errors from stderr when stdout is empty', () => {
      const err = failureFromCliOutput('', 'authentication required', 1);
      expect(err.message).toContain(GETTING_STARTED_URL);
    });
  });

  describe('parseListModelsOutput', () => {
    it('parses slug\\tdisplay lines and skips the fetching header', () => {
      const out = [
        'Fetching available models...',
        'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
        'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
      ].join('\n');
      expect(parseListModelsOutput(out)).toEqual(['gemini-3.8-flash-high', 'claude-sonnet-4-6']);
    });
  });

  describe('listModels curated fallback constant', () => {
    it('exposes a non-empty curated list', () => {
      expect(CURATED_ANTIGRAVITY_MODELS.length).toBeGreaterThan(0);
    });
  });
});
