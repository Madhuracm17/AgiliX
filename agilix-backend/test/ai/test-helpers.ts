import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { CompleteJsonOptions, LlmService } from '../../src/ai/llm.service';

/** Fake key used by every test. It must never appear in logs or errors. */
export const TEST_API_KEY = 'sk-or-v1-TEST-SECRET-KEY-do-not-leak';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** A real LlmService with test configuration (no .env is read). */
export function createLlmService(env: Record<string, string | undefined> = {}): LlmService {
  const values: Record<string, string | undefined> = {
    OPENROUTER_API_KEY: TEST_API_KEY,
    OPENROUTER_MODELS: 'model-a,model-b',
    AI_TIMEOUT_MS: '30000',
    ...env,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  return new LlmService(config);
}

/** A successful OpenRouter chat-completions response with the given message content. */
export function openRouterReply(content: unknown) {
  return { data: { choices: [{ message: { content } }] } };
}

/** An axios HTTP error such as OpenRouter returns (the body even echoes the key). */
export function httpError(status: number): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    {
      status,
      statusText: 'error',
      headers: {},
      config: {},
      data: { error: { message: `upstream rejected key ${TEST_API_KEY}` } },
    } as never,
  );
}

/** An axios error without a response (connection refused, DNS failure, ...). */
export function networkError(code: string): AxiosError {
  return new AxiosError(`connect ${code}`, code);
}

/**
 * Replaces axios.post for one test. Each step is used for one call, in order:
 * an Error is thrown, anything else is returned as the response.
 * Any extra call fails the test, so a real OpenRouter request can never happen.
 */
export function mockOpenRouter(...steps: unknown[]) {
  const post = jest.spyOn(axios, 'post');
  post.mockImplementation((async () => {
    throw new Error('Unexpected extra OpenRouter call in a test');
  }) as never);
  for (const step of steps) {
    post.mockImplementationOnce((async () => {
      if (step instanceof Error) throw step;
      return step;
    }) as never);
  }
  return post;
}

/** Silences Nest's Logger and records everything that would have been logged. */
export function captureLogs() {
  const spies = [
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  ];
  return {
    text: () =>
      spies
        .flatMap((spy) => spy.mock.calls)
        .map((args) => args.map((arg) => String(arg)).join(' '))
        .join('\n'),
  };
}

/**
 * A stand-in LlmService whose completeJson runs the feature's own validator on
 * `modelOutput`, exactly as the real service does after parsing JSON.
 */
export function fakeLlm(modelOutput: unknown) {
  const completeJson = jest.fn(async (options: CompleteJsonOptions<unknown>) =>
    options.validate(modelOutput),
  );
  return { llm: { completeJson } as unknown as LlmService, completeJson };
}

/** Awaits a promise that is expected to reject and returns the error. */
export async function captureError(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject, but it resolved');
}