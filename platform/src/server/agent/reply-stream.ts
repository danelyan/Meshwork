/**
 * Стриминг реплики агента в SSE (контракт — docs/platform.md, «События SSE»):
 *  - `delta {id, text}` — очередной кусок текста реплики `id` (клиент дописывает с плавным догоном);
 *  - `discard {id}` — накопленный текст `id` не ответ (модель ушла в инструменты) — клиент убирает его;
 *  - `message {id, text}` — итог реплики, авторитетный: клиент заменяет накопленное этим текстом.
 * Провайдер, который стримит (openai-chat, `stream: true`), отдаёт дельты по мере генерации;
 * остальные источники (stub, Responses API, демо-шаблоны, план В) — `finish` нарезает готовый
 * текст на куски по словам с паузой 20–40 мс, чтобы лента выглядела одинаково.
 */

/** Минимальный эмиттер: подходит и кандидатскому AgentEvent, и EmployerAgentEvent. */
export type ReplyEmit = (
  e: { type: 'delta'; id: string; text: string } | { type: 'discard'; id: string } | { type: 'message'; id: string; text: string },
) => void;

let seq = 0;
const nextId = () => `r${Date.now().toString(36)}${(++seq).toString(36)}`;

/** Пауза между искусственными чанками; в тестах (NODE_ENV=test) — без пауз. */
export function chunkDelayMs(): number {
  if (process.env.NODE_ENV === 'test') return 0;
  return 20 + Math.floor(Math.random() * 21);
}

/** Куски по 2–4 слова (не длиннее ~32 символов); пробелы остаются в кусках — склейка даёт исходный текст. */
export function splitChunks(text: string): string[] {
  const words = text.match(/\S+\s*|\s+/g) ?? [];
  const out: string[] = [];
  let cur = '';
  let n = 0;
  for (const w of words) {
    cur += w;
    n++;
    if (n >= 3 || cur.length >= 32) {
      out.push(cur);
      cur = '';
      n = 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

export interface ReplyStream {
  /** Текущий id реплики (меняется после `discard`). */
  readonly id: string;
  /** Колбэк для CompleteRequest.onDelta. */
  onDelta(text: string): void;
  /** Модель ответила вызовом инструментов (или повтор попытки): показанный текст не ответ. */
  discard(): void;
  /**
   * Итог реплики: если дельт не было — нарезать текст, затем `message`. Возвращает текст, который
   * надо сохранить как ответ: весь `text`; при стопе посреди нарезки — показанный кусок; null — ничего
   * не показано (стоп до первого куска).
   */
  finish(text: string): Promise<string | null>;
  /**
   * Стоп посреди дельт модели: показанный кусок становится ответом — `message` с ним.
   * Возвращает этот текст (сохранить в БД) или null, если дельт не было.
   */
  stop(): string | null;
}

/**
 * `signal` — стоп хода (кнопка «Стоп», таймаут): дельты больше не шлём, нарезку обрываем.
 * `pace` — когда нарезку не ждать (по умолчанию тот же `signal`; маршрут передаёт «клиент ушёл
 * или стоп»): при разрыве соединения паузы не нужны, но `message` с полным текстом отдаём.
 */
export function createReplyStream(
  emit: ReplyEmit,
  signal?: AbortSignal,
  delay: () => number = chunkDelayMs,
  pace: AbortSignal | undefined = signal,
): ReplyStream {
  let id = nextId();
  let streamed = false;
  let acc = '';
  const reset = () => {
    streamed = false;
    acc = '';
    id = nextId();
  };
  return {
    get id() {
      return id;
    },
    onDelta(text) {
      if (!text || signal?.aborted) return;
      streamed = true;
      acc += text;
      emit({ type: 'delta', id, text });
    },
    discard() {
      if (streamed) emit({ type: 'discard', id });
      reset();
    },
    async finish(text) {
      let shown = '';
      let cut = false;
      if (!streamed) {
        for (const chunk of splitChunks(text)) {
          if (signal?.aborted) {
            cut = true;
            break;
          }
          if (pace?.aborted) break;
          emit({ type: 'delta', id, text: chunk });
          shown += chunk;
          await sleep(delay(), pace);
        }
      }
      const out = cut ? shown.trim() : text;
      if (!out) {
        reset();
        return null;
      }
      emit({ type: 'message', id, text: out });
      reset();
      return out;
    },
    stop() {
      const text = acc.trim();
      if (!streamed || !text) {
        reset();
        return null;
      }
      emit({ type: 'message', id, text });
      reset();
      return text;
    },
  };
}
