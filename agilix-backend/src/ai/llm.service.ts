import axios from 'axios';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Reusable OpenRouter client for every AI feature in AgiliX
 * (sprint risk today; story points / priority later).
 *
 * Feature services only supply prompts + a validator. Everything
 * provider-specific lives here: API key, model fallback, timeouts,
 * JSON extraction, validation and safe logging.
 *
 * The API key is read from backend configuration only and is never
 * returned to clients or written to logs.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Used only when OPENROUTER_MODELS is not set (same list the project used before).
const DEFAULT_MODELS = [
  'openai/gpt-oss-20b:free',
  'google/gemma-4-26b-a4b:free',
  'google/gemma-4-31b:free',
  'inclusionai/ling-3.0-flash:free',
  'poolside/laguna-xs-2.1:free',
];

// Total time budget for one AI request across ALL fallback models.
const DEFAULT_TIMEOUT_MS = 30000;
// A single model attempt never gets more than this, so one slow model
// cannot consume the whole budget and block the fallbacks.
const MAX_ATTEMPT_MS = 15000;
// Don't start another attempt if less than this is left of the budget.
const MIN_ATTEMPT_MS = 2000;

const DEFAULT_APP_URL = 'http://localhost:3000';
const APP_TITLE = 'AgiliX';

/**
 * Thrown by validators when the model's JSON has the wrong shape.
 * Messages must describe the problem without echoing model output.
 */
export class LlmValidationError extends Error {}

/** Converts parsed JSON into a trusted typed value, or throws LlmValidationError. */
export type LlmValidator<T> = (value: unknown) => T;

export interface CompleteJsonOptions<T> {
  /** Short label used in logs, e.g. "sprint-risk". */
  task: string;
  system: string;
  user: string;
  validate: LlmValidator<T>;
  temperature?: number;
  maxTokens?: number;
}

type AttemptFailure =
  | 'timeout'
  | 'network'
  | 'http'
  | 'auth'
  | 'empty'
  | 'unparseable'
  | 'invalid';

class AttemptError extends Error {
  constructor(
    readonly kind: AttemptFailure,
    detail: string,
  ) {
    super(detail);
  }
}

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    if (!this.apiKey) {
      this.logger.warn(
        'OPENROUTER_API_KEY is not set — AI endpoints will return 503 until it is configured.',
      );
    }
  }

  /**
   * Sends a system + user prompt, tries each configured model in order
   * within one overall time budget, and returns the first response that
   * parses as JSON AND passes `validate`.
   *
   * Throws ServiceUnavailableException (HTTP 503) if no model succeeds.
   * Never fabricates a result.
   */
  async completeJson<T>(options: CompleteJsonOptions<T>): Promise<T> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'AI service is not configured on the server. Please try again later.',
      );
    }

    const models = this.models;
    const deadline = Date.now() + this.timeoutMs;
    let attempts = 0;

    for (const model of models) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_ATTEMPT_MS) {
        this.logger.warn(`[${options.task}] time budget exhausted after ${attempts} attempt(s)`);
        break;
      }

      attempts++;
      const startedAt = Date.now();

      try {
        const content = await this.callModel(
          apiKey,
          model,
          options,
          Math.min(remaining, MAX_ATTEMPT_MS),
        );
        const parsed = extractJson(content);
        if (parsed === undefined) {
          throw new AttemptError('unparseable', 'response contained no valid JSON object');
        }

        let result: T;
        try {
          result = options.validate(parsed);
        } catch (err) {
          const reason =
            err instanceof LlmValidationError ? err.message : 'validator rejected response';
          throw new AttemptError('invalid', reason);
        }

        this.logger.log(`[${options.task}] ${model} succeeded in ${Date.now() - startedAt}ms`);
        return result;
      } catch (err) {
        const failure =
          err instanceof AttemptError ? err : new AttemptError('network', 'unexpected error');
        this.logger.warn(
          `[${options.task}] ${model} failed after ${Date.now() - startedAt}ms: ${failure.kind} (${failure.message})`,
        );

        // A bad key / no credits fails identically on every model — stop early.
        if (failure.kind === 'auth') break;
      }
    }

    this.logger.error(`[${options.task}] no AI model produced a valid response (${attempts} attempt(s))`);
    throw new ServiceUnavailableException(
      'AI service is temporarily unavailable: no AI model returned a valid response in time. Please try again later.',
    );
  }

  private async callModel<T>(
    apiKey: string,
    model: string,
    options: CompleteJsonOptions<T>,
    timeoutMs: number,
  ): Promise<string> {
    // AbortController enforces a hard wall-clock limit on the whole attempt
    // (axios' own timeout alone does not cover a slowly trickling response).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await axios.post(
        OPENROUTER_URL,
        {
          model,
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.user },
          ],
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 1000,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': this.appUrl,
            'X-Title': APP_TITLE,
          },
          timeout: timeoutMs,
          signal: controller.signal,
        },
      );

      // OpenRouter can report provider errors inside a 200 response.
      if (response.data?.error) {
        throw new AttemptError('http', 'provider returned an error payload');
      }

      const content = readMessageContent(response.data?.choices?.[0]?.message?.content);
      if (!content) {
        throw new AttemptError('empty', 'response had no message content');
      }
      return content;
    } catch (err) {
      if (err instanceof AttemptError) throw err;

      if (axios.isCancel(err) || controller.signal.aborted) {
        throw new AttemptError('timeout', `no response within ${timeoutMs}ms`);
      }
      if (axios.isAxiosError(err)) {
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
          throw new AttemptError('timeout', `no response within ${timeoutMs}ms`);
        }
        const status = err.response?.status;
        if (status === 401 || status === 402 || status === 403) {
          throw new AttemptError('auth', `HTTP ${status} — check OPENROUTER_API_KEY / account credits`);
        }
        if (status) {
          throw new AttemptError('http', `HTTP ${status}`);
        }
        throw new AttemptError('network', err.code ?? 'request failed');
      }
      throw new AttemptError('network', 'request failed');
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- configuration (read on each call so .env changes need only a restart) ----

  private get apiKey(): string | undefined {
    const key = this.config.get<string>('OPENROUTER_API_KEY')?.trim();
    return key ? key : undefined;
  }

  private get models(): string[] {
    const raw = this.config.get<string>('OPENROUTER_MODELS');
    const list = (raw ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    return list.length ? list : DEFAULT_MODELS;
  }

  private get timeoutMs(): number {
    const value = Number(this.config.get<string>('AI_TIMEOUT_MS'));
    return Number.isFinite(value) && value >= MIN_ATTEMPT_MS ? value : DEFAULT_TIMEOUT_MS;
  }

  private get appUrl(): string {
    return this.config.get<string>('AI_APP_URL')?.trim() || DEFAULT_APP_URL;
  }
}

/** Message content is usually a string, but some providers return content parts. */
function readMessageContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return '';
}

/**
 * Extracts the first JSON object from model output. Handles:
 *   - plain JSON
 *   - ```json fenced blocks
 *   - short text before/after the object ("Here is the result: {...}")
 * Returns undefined if no parseable object is found.
 */
export function extractJson(text: string): unknown {
  const candidates: string[] = [];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to brace scanning
    }

    for (const obj of scanJsonObjects(trimmed)) {
      try {
        return JSON.parse(obj);
      } catch {
        // try the next balanced {...} block
      }
    }
  }
  return undefined;
}

/** Yields each balanced top-level {...} substring, ignoring braces inside strings. */
function* scanJsonObjects(text: string): Generator<string> {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        yield text.slice(start, i + 1);
        break;
      }
    }
  }
}