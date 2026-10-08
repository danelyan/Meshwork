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
    return new LlmError(codeForStatus(err.status), `${provider}: ${short(err.message)}`, err.status, { cause: err });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new LlmError('unavailable', `${provider}: ${short(msg)}`, undefined, { cause: err });
}
