import { prisma } from '../db';
import { getEnv } from '../env';
import { runPlanB } from './plan-b';
import { createProvider } from './providers';
import { Semaphore } from './semaphore';
import {
  LlmError,
  type CompleteRequest,
  type CompleteResult,
  type LlmCallContext,
  type LlmProvider,
} from './types';

/** Строка журнала AgentRun (prisma/schema.prisma, model AgentRun). */
export interface AgentRunRecord {
  purpose: CompleteRequest['purpose'];
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  ok: boolean;
  jsonValid: boolean | null;
  error: string | null;
  attempts: number;
  queueWaitMs: number;
  candidateId: string | null;
  conversationId: string | null;
}

export interface LlmClientOptions {
  provider: LlmProvider;
  maxConcurrency: number;
  /** Таймаут одной попытки, если в запросе нет timeoutMs. */
  timeoutMs: number;
  /** Ретраи сверх первой попытки — только на 429 и 5xx. */
  maxRetries: number;
  /** Журнал; ошибки записи глотаются (журнал не должен ронять ответ). */
  recordRun?: (run: AgentRunRecord) => Promise<void> | void;
  /** Пауза перед ретраем, мс; по умолчанию 500 · 2^(n-1), для тестов — 0. */
  backoffMs?: (attempt: number) => number;
}

export interface LlmClient {
  /** Провайдер-обёртка: тот же контракт LlmProvider + семафор, таймаут, ретрай, журнал. */
  forContext(ctx?: LlmCallContext): LlmProvider;
  readonly semaphore: Semaphore;
}

/** HTTP-статус из LlmError или ошибки SDK (у openai APIError есть `.status`). */
export function errorStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return undefined;
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof LlmError && (err.code === 'timeout' || err.code === 'aborted' || err.code === 'context_length')) return false;
  const status = errorStatus(err);
  if (status !== undefined) return status === 429 || status >= 500;
  return err instanceof LlmError && (err.code === 'rate_limited' || err.code === 'server_error');
}

/** Пауза ретрая не дольше этого, даже если провайдер просит больше (ход не должен висеть). */
export const RETRY_AFTER_CAP_MS = 10_000;

/**
 * `Retry-After` из ответа 429/503 (секунды или HTTP-дата), если провайдер его
 * прислал: заголовки лежат у APIError SDK openai — у самой ошибки или в `cause`
 * LlmError. Нет заголовка — undefined, берётся экспоненциальная пауза.
 */
export function retryAfterMs(err: unknown, now = Date.now()): number | undefined {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const h = (e as { headers?: unknown }).headers;
    let raw: string | null | undefined;
    if (h && typeof (h as Headers).get === 'function') raw = (h as Headers).get('retry-after');
    else if (h && typeof h === 'object') raw = (h as Record<string, string | undefined>)['retry-after'];
    if (!raw) continue;
    const secs = Number(raw);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(raw) - now;
    if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, RETRY_AFTER_CAP_MS);
  }
  return undefined;
}

/**
 * Текст ошибки для журнала AgentRun без ПДн: провайдер может процитировать
 * кусок запроса (резюме) в 400-й ошибке — почты, телефоны и длинные числа
 * маскируются, длина ограничена.
 */
export function redactPii(text: string): string {
  return text
    .replace(/\b(AQVN|t1\.)[\w.-]{10,}/g, '[key]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\+?\d[\d\s()-]{8,}\d/g, '[phone]');
}

function errorText(err: unknown): string {
  const status = errorStatus(err);
  const msg = err instanceof Error ? err.message : String(err);
  return redactPii((status ? `[${status}] ` : '') + msg).slice(0, 500);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new LlmError('aborted', 'Запрос отменён'));
      },
      { once: true },
    );
  });

/** Одна попытка с таймаутом: провайдер получает сигнал, но и проигнорировавший его не повиснет. */
async function attemptWithTimeout(
  provider: LlmProvider,
  req: CompleteRequest,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<CompleteResult> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onOuterAbort = () => ctrl.abort(new LlmError('aborted', 'Запрос отменён'));
  if (outer?.aborted) throw new LlmError('aborted', 'Запрос отменён');
  outer?.addEventListener('abort', onOuterAbort, { once: true });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new LlmError('timeout', `LLM не ответила за ${timeoutMs} мс`);
      ctrl.abort(err);
      reject(err);
    }, timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    ctrl.signal.addEventListener('abort', () => reject(ctrl.signal.reason), { once: true });
  });
  try {
    return await Promise.race([provider.complete(req, ctrl.signal), timeout, aborted]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

export function createLlmClient(opts: LlmClientOptions): LlmClient {
  const semaphore = new Semaphore(opts.maxConcurrency);
  // Экспонента с джиттером (рекомендация OpenAI «rate limits»: exponential backoff + random jitter),
  // чтобы 10 одновременных диалогов после общего 429 не ударили провайдера синхронно.
  const backoff = opts.backoffMs ?? ((n: number) => Math.round(500 * 2 ** (n - 1) * (0.75 + Math.random() * 0.5)));
  const { provider } = opts;

  async function record(run: AgentRunRecord) {
    if (!opts.recordRun) return;
    try {
      await opts.recordRun(run);
    } catch (err) {
      console.error('[llm] AgentRun record failed', err);
    }
  }

  async function complete(ctx: LlmCallContext, req: CompleteRequest, signal?: AbortSignal): Promise<CompleteResult> {
    const queuedAt = Date.now();
    const release = await semaphore.acquire({ onQueue: ctx.onQueue, signal });
    const queueWaitMs = Date.now() - queuedAt;
    const startedAt = Date.now();
    const timeoutMs = req.timeoutMs ?? opts.timeoutMs;
    const planB = Boolean(req.tools?.length) && !provider.supportsTools;
    // Дельты — только для свободного текста: в плане В и по JSON-схеме модель пишет служебный JSON.
    // После неудачной попытки, успевшей что-то показать, повтор идёт без дельт: итог придёт событием message.
    let streamed = false;
    const userDelta = planB || req.schema ? undefined : req.onDelta;
    const { onDelta: _drop, ...bare } = req;
    void _drop;
    const reqFor = (): CompleteRequest =>
      userDelta && !streamed
        ? {
            ...bare,
            onDelta: (t) => {
              streamed = true;
              userDelta(t);
            },
          }
        : bare;
    let attempts = 0;
    let lastErr: unknown;
    try {
      while (attempts <= opts.maxRetries) {
        attempts++;
        try {
          // План В: разбор JSON-действия и один ремонт — внутри попытки (у каждого вызова свой таймаут).
          const result = planB
            ? await runPlanB(bare, (r) => attemptWithTimeout(provider, r, timeoutMs, signal))
            : await attemptWithTimeout(provider, reqFor(), timeoutMs, signal);
          await record({
            purpose: req.purpose,
            provider: result.provider,
            model: result.model,
            latencyMs: Date.now() - startedAt,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            ok: true,
            // Факт строгого JSON по запрошенной схеме; семантику проверяет вызывающий (Zod).
            jsonValid: req.schema ? result.kind === 'json' && result.json !== undefined : null,
            error: null,
            attempts,
            queueWaitMs,
            candidateId: ctx.candidateId ?? null,
            conversationId: ctx.conversationId ?? null,
          });
          return result;
        } catch (err) {
          lastErr = err;
          if (attempts > opts.maxRetries || !isRetryable(err) || signal?.aborted) break;
          // Retry-After провайдера важнее своей экспоненты (но не дольше RETRY_AFTER_CAP_MS).
          const wait = opts.backoffMs ? backoff(attempts) : (retryAfterMs(err) ?? backoff(attempts));
          await sleep(wait, signal);
        }
      }
      await record({
        purpose: req.purpose,
        provider: provider.name,
        model: provider.model,
        latencyMs: Date.now() - startedAt,
        inputTokens: 0,
        outputTokens: 0,
        ok: false,
        jsonValid: req.schema ? false : null,
        error: errorText(lastErr),
        attempts,
        queueWaitMs,
        candidateId: ctx.candidateId ?? null,
        conversationId: ctx.conversationId ?? null,
      });
      throw lastErr instanceof LlmError
        ? lastErr
        : new LlmError(
            errorStatus(lastErr) === 429 ? 'rate_limited' : 'unavailable',
            errorText(lastErr),
            errorStatus(lastErr),
            { cause: lastErr },
          );
    } finally {
      release();
    }
  }

  return {
    semaphore,
    forContext(ctx: LlmCallContext = {}): LlmProvider {
      return {
        name: provider.name,
        model: provider.model,
        supportsTools: true, // план В делает tools доступными всегда
        supportsJsonSchema: provider.supportsJsonSchema,
        complete: (req, signal) => complete(ctx, req, signal),
      };
    },
  };
}

let defaultClient: LlmClient | undefined;

/**
 * Клиент приложения: провайдер по env LLM_PROVIDER, семафор
 * LLM_MAX_CONCURRENCY, таймаут LLM_TIMEOUT_MS, ретраи LLM_MAX_RETRIES,
 * журнал AgentRun в БД. Создаётся при первом обращении.
 */
export function getLlmClient(): LlmClient {
  if (defaultClient) return defaultClient;
  const env = getEnv();
  defaultClient = createLlmClient({
    provider: createProvider(env),
    maxConcurrency: env.LLM_MAX_CONCURRENCY,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxRetries: env.LLM_MAX_RETRIES,
    recordRun: async (run) => {
      await prisma.agentRun.create({ data: run });
    },
  });
  return defaultClient;
}

/**
 * Главная точка входа для лейнов: `const llm = getLlm({ candidateId, conversationId, onQueue })`.
 * Возвращает LlmProvider — тот же интерфейс, что у сырых провайдеров.
 */
export function getLlm(ctx?: LlmCallContext): LlmProvider {
  return getLlmClient().forContext(ctx);
}

/** Только для тестов. */
export function resetLlmClient(): void {
  defaultClient = undefined;
}
