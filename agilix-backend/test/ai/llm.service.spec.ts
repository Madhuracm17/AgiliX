import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { extractJson, LlmValidationError } from '../../src/ai/llm.service';
import {
  OPENROUTER_URL,
  TEST_API_KEY,
  captureError,
  captureLogs,
  createLlmService,
  httpError,
  mockOpenRouter,
  networkError,
  openRouterReply,
} from './test-helpers';

/** Accepts only { value: number } so schema problems can be simulated. */
function validateValue(input: unknown): { value: number } {
  const value = (input as { value?: unknown })?.value;
  if (typeof value !== 'number') {
    throw new LlmValidationError('value must be a number');
  }
  return { value };
}

const request = {
  task: 'test-task',
  system: 'system prompt',
  user: 'user prompt',
  validate: validateValue,
};

describe('LlmService', () => {
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    logs = captureLogs();
  });

  describe('successful responses', () => {
    it('returns the validated result from the first model', async () => {
      const post = mockOpenRouter(openRouterReply('{"value": 42}'));

      const result = await createLlmService().completeJson(request);

      expect(result).toEqual({ value: 42 });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('sends the prompts, model and key to OpenRouter only', async () => {
      const post = mockOpenRouter(openRouterReply('{"value": 1}'));

      await createLlmService().completeJson({
        ...request,
        temperature: 0.1,
        maxTokens: 1500,
      });

      const [url, body, config] = post.mock.calls[0];

      expect(url).toBe(OPENROUTER_URL);

      expect(body).toEqual({
        model: 'model-a',
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'user prompt' },
        ],
        temperature: 0.1,
        max_tokens: 1500,
      });

      const headers = (
        config as unknown as {
          headers: Record<string, string>;
        }
      ).headers;

      expect(headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
      expect(headers['X-Title']).toBe('AgiliX');
    });

    it('uses temperature 0.2 and 1000 max tokens by default', async () => {
      const post = mockOpenRouter(openRouterReply('{"value": 1}'));

      await createLlmService().completeJson(request);

      expect(post.mock.calls[0][1]).toMatchObject({
        temperature: 0.2,
        max_tokens: 1000,
      });
    });

    it('accepts JSON wrapped in a markdown fence and surrounding text', async () => {
      mockOpenRouter(
        openRouterReply(
          'Here you go:\n```json\n{"value": 7}\n```\nThanks!',
        ),
      );

      await expect(
        createLlmService().completeJson(request),
      ).resolves.toEqual({ value: 7 });
    });

    it('accepts message content returned as text parts', async () => {
      mockOpenRouter(
        openRouterReply([
          { type: 'text', text: '{"value":' },
          { type: 'text', text: ' 9}' },
        ]),
      );

      await expect(
        createLlmService().completeJson(request),
      ).resolves.toEqual({ value: 9 });
    });

    it('falls back to the built-in model list when OPENROUTER_MODELS is not set', async () => {
      const post = mockOpenRouter(openRouterReply('{"value": 1}'));

      await createLlmService({
        OPENROUTER_MODELS: undefined,
      }).completeJson(request);

      expect(
        (post.mock.calls[0][1] as any).model,
      ).toBe('openai/gpt-oss-20b:free');
    });
  });

  describe('fallback to the next configured model', () => {
    it('tries the next model when the response is not JSON', async () => {
      const post = mockOpenRouter(
        openRouterReply('Sorry, I cannot help with that.'),
        openRouterReply('{"value": 5}'),
      );

      await expect(
        createLlmService().completeJson(request),
      ).resolves.toEqual({ value: 5 });

      expect(post).toHaveBeenCalledTimes(2);

      expect(
        (post.mock.calls[1][1] as any).model,
      ).toBe('model-b');

      expect(logs.text()).toContain('unparseable');
    });

    it('tries the next model when the JSON fails validation', async () => {
      mockOpenRouter(
        openRouterReply('{"value": "not a number"}'),
        openRouterReply('{"value": 3}'),
      );

      await expect(
        createLlmService().completeJson(request),
      ).resolves.toEqual({ value: 3 });

      expect(logs.text()).toContain('value must be a number');
    });

    it('treats any validator exception as an invalid response', async () => {
      mockOpenRouter(
        openRouterReply('{"value": 1}'),
        openRouterReply('{"value": 2}'),
      );

      let calls = 0;

      const validate = (input: unknown) => {
        calls++;

        if (calls === 1) {
          throw new Error('unexpected bug');
        }

        return validateValue(input);
      };

      await expect(
        createLlmService().completeJson({
          ...request,
          validate,
        }),
      ).resolves.toEqual({ value: 2 });

      expect(logs.text()).toContain('validator rejected response');
    });

    it('tries the next model when the message content is empty', async () => {
      mockOpenRouter(
        openRouterReply('   '),
        openRouterReply('{"value": 4}'),
      );

      await expect(
        createLlmService().completeJson(request),
      ).resolves.toEqual({ value: 4 });

      expect(logs.text()).toContain('empty');
    });

    it('tries the next model when OpenRouter reports a provider error inside a 200 response', async () => {
      mockOpenRouter(
        {
          data: {
            error: {
              message: 'provider overloaded',
            },
          },
        },
        openRouterReply('{"value": 6}'),
      );

      await expect(
        createLlmService().completeJson(request),
      ).resolves.toEqual({ value: 6 });

      expect(logs.text()).toContain(
        'provider returned an error payload',
      );
    });

    it('tries the next model after an HTTP 5xx error', async () => {
      mockOpenRouter(
        httpError(502),
        openRouterReply('{"value": 8}'),
      );

      await expect(
        createLlmService().completeJson(request),
      ).resolves.toEqual({ value: 8 });

      expect(logs.text()).toContain('HTTP 502');
    });

    it('tries the next model after a network error', async () => {
      mockOpenRouter(
        networkError('ECONNREFUSED'),
        openRouterReply('{"value": 10}'),
      );

      await expect(
        createLlmService().completeJson(request),
      ).resolves.toEqual({ value: 10 });

      expect(logs.text()).toContain(
        'network (ECONNREFUSED)',
      );
    });

    it('tries the next model after an axios timeout', async () => {
      mockOpenRouter(
        networkError('ECONNABORTED'),
        openRouterReply('{"value": 11}'),
      );

      await expect(
        createLlmService().completeJson(request),
      ).resolves.toEqual({ value: 11 });

      expect(logs.text()).toContain('timeout');
    });
  });

  describe('when no model succeeds', () => {
    it('throws 503 after every configured model returned invalid output', async () => {
      const post = mockOpenRouter(
        openRouterReply('not json'),
        openRouterReply('{"value": "x"}'),
      );

      const error = await captureError(
        createLlmService().completeJson(request),
      );

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.getStatus()).toBe(503);
      expect(error.message).toMatch(/temporarily unavailable/);
      expect(post).toHaveBeenCalledTimes(2);
    });

    it('throws 503 when every model fails with provider errors', async () => {
      mockOpenRouter(
        httpError(500),
        networkError('ENOTFOUND'),
      );

      const error = await captureError(
        createLlmService().completeJson(request),
      );

      expect(error).toBeInstanceOf(ServiceUnavailableException);
    });

    it('stops after the first model on an authentication error (bad key / no credits)', async () => {
      const post = mockOpenRouter(httpError(401));

      const error = await captureError(
        createLlmService().completeJson(request),
      );

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(post).toHaveBeenCalledTimes(1);
      expect(logs.text()).toContain('auth');
    });

    it('throws 503 without calling OpenRouter when no API key is configured', async () => {
      const post = mockOpenRouter();

      const error = await captureError(
        createLlmService({
          OPENROUTER_API_KEY: '   ',
        }).completeJson(request),
      );

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.message).toMatch(/not configured/);
      expect(post).not.toHaveBeenCalled();
    });

    it('aborts a model that does not answer within the time budget', async () => {
      const post = jest
        .spyOn(axios, 'post')
        .mockImplementation(((
          _url: string,
          _body: unknown,
          config: { signal: AbortSignal },
        ) =>
          new Promise((_resolve, reject) => {
            config.signal.addEventListener('abort', () =>
              reject(new Error('canceled')),
            );
          })) as never);

      const error = await captureError(
        createLlmService({
          AI_TIMEOUT_MS: '2000',
        }).completeJson(request),
      );

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(post).toHaveBeenCalledTimes(1);
      expect(logs.text()).toContain('timeout');
    }, 10000);
  });

  describe('API key safety', () => {
    it('never puts the API key in logs or in the error returned to clients', async () => {
      mockOpenRouter(
        httpError(500),
        httpError(403),
      );

      const error = await captureError(
        createLlmService().completeJson(request),
      );

      expect(logs.text()).not.toContain(TEST_API_KEY);
      expect(error.message).not.toContain(TEST_API_KEY);
      expect(
        JSON.stringify(error.getResponse()),
      ).not.toContain(TEST_API_KEY);
    });

    it('never logs the API key or the model output on success', async () => {
      mockOpenRouter(
        openRouterReply(
          '{"value": 12, "note": "secret model text"}',
        ),
      );

      await createLlmService().completeJson(request);

      expect(logs.text()).not.toContain(TEST_API_KEY);
      expect(logs.text()).not.toContain(
        'secret model text',
      );
    });
  });

  describe('extractJson', () => {
    it('parses plain JSON', () => {
      expect(extractJson('{"a": 1}')).toEqual({
        a: 1,
      });
    });

    it('parses a fenced ```json block', () => {
      expect(
        extractJson('```json\n{"a": 2}\n```'),
      ).toEqual({
        a: 2,
      });
    });

    it('finds an object inside surrounding text', () => {
      expect(
        extractJson('Result: {"a": {"b": "}"}} done'),
      ).toEqual({
        a: {
          b: '}',
        },
      });
    });

    it('returns undefined when there is no valid JSON object', () => {
      expect(extractJson('no json here')).toBeUndefined();
      expect(
        extractJson('{"broken": '),
      ).toBeUndefined();
    });
  });
});