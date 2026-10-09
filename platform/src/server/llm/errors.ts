import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';
import { LlmError, type LlmErrorCode } from './types';

/** Код LlmError по HTTP-статусу. client ретраит только rate_limited и server_error (429, 5xx). */
export function codeForStatus(status: number): LlmErrorCode {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 400) return 'bad_request';
  return 'unavailable';
}

/**
 * Признак «не влезло в контекст» в тексте 400-й ошибки. OpenAI: код
 * `context_length_exceeded` / «maximum context length»; vLLM: «maximum context
 * length … tokens»; у Yandex точной формулировки в доке нет — ловим общие
 * слова про лимит токенов (инференс, проверить на живом ключе).
 */
export const CONTEXT_LENGTH_RE =
  /context[_ ]length|maximum context|context window|too many (input )?tokens|input tokens? (count )?(exceeds|is greater|must be (no more|less))|prompt is too long|token limit|превыш\S* (лимит|длин|максимальн)/i;

export function isContextLengthMessage(text: string): boolean {
  return CONTEXT_LENGTH_RE.test(text);
}

function short(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * Любая ошибка вызова провайдера → LlmError.
 *  - отмена (наш AbortSignal) → причина отмены, если это LlmError (таймаут client'а), иначе 'aborted';
 *  - таймаут соединения SDK → 'timeout';
 *  - сетевой сбой без ответа → 'server_error' без статуса (client его ретраит);
 *  - HTTP-ошибка → код по статусу, статус сохраняется.
 * Ключ в сообщение не попадает: SDK его в тексте ошибок не печатает, мы — тоже.
 */
export function toLlmError(err: unknown, provider: string, signal?: AbortSignal): LlmError {
  if (err instanceof LlmError) return err;
  if (signal?.aborted || err instanceof APIUserAbortError) {
    const reason: unknown = signal?.reason;
    return reason instanceof LlmError ? reason : new LlmError('aborted', 'Запрос отменён', undefined, { cause: err });
  }
  if (err instanceof APIConnectionTimeoutError) {
    return new LlmError('timeout', `${provider}: таймаут соединения`, undefined, { cause: err });
  }
  if (err instanceof APIConnectionError) {
    return new LlmError('server_error', `${provider}: сеть недоступна (${short(err.message)})`, undefined, { cause: err });
  }
  if (err instanceof APIError && typeof err.status === 'number') {
    const code = (err as { code?: unknown }).code;
    if ((err.status === 400 || err.status === 413) && (code === 'context_length_exceeded' || isContextLengthMessage(err.message))) {
      return new LlmError('context_length', `${provider}: запрос не влез в контекст модели (${short(err.message)})`, err.status, { cause: err });
    }
    return new LlmError(codeForStatus(err.status), `${provider}: ${short(err.message)}`, err.status, { cause: err });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new LlmError('unavailable', `${provider}: ${short(msg)}`, undefined, { cause: err });
}
