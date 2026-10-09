import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors';
import { yandexAuthHeader } from '@/server/llm/providers/yandex-responses';

/**
 * Распознавание голоса для композера чата. Режим — env STT_PROVIDER:
 *  - yandex — SpeechKit, синхронный REST v1 `stt:recognize` (короткое аудио: ≤ 30 с, ≤ 1 МБ, 1 канал;
 *    форматы lpcm/oggopus — webm не принимает, поэтому клиент пишет LPCM 16 кГц через Web Audio);
 *  - browser — распознаёт браузер (Web Speech API), сервер не участвует;
 *  - off — кнопки микрофона нет;
 *  - auto (по умолчанию) — yandex при YANDEX_API_KEY + YANDEX_FOLDER_ID, иначе browser.
 * Аудио на сервере не хранится и не пишется в журнал: тело запроса уходит в SpeechKit и забывается.
 */
export type SttMode = 'yandex' | 'browser' | 'off';

export const STT_URL = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize';
/** Лимиты SpeechKit v1 для синхронного распознавания. */
export const STT_MAX_BYTES = 1024 * 1024;
export const STT_SAMPLE_RATE = 16_000;
export const STT_MAX_SECONDS = 30;

export function sttMode(env = getEnv()): SttMode {
  const want = env.STT_PROVIDER;
  const hasKeys = Boolean(env.YANDEX_API_KEY && env.YANDEX_FOLDER_ID);
  if (want === 'off') return 'off';
  if (want === 'browser') return 'browser';
  if (want === 'yandex') return hasKeys ? 'yandex' : 'browser';
  return hasKeys ? 'yandex' : 'browser';
}

/** LPCM 16 бит, моно, 16 кГц → текст. `fetchImpl` подменяется в тестах. */
export async function recognizeYandex(
  audio: Uint8Array,
  opts: { apiKey: string; folderId?: string; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<string> {
  if (audio.byteLength === 0) throw new AppError('bad_request', 'Пустая запись', 400);
  if (audio.byteLength > STT_MAX_BYTES) throw new AppError('payload_too_large', `Запись длиннее ${STT_MAX_SECONDS} секунд — скажи короче`, 413);
  const auth = yandexAuthHeader(opts.apiKey);
  const params = new URLSearchParams({ lang: 'ru-RU', format: 'lpcm', sampleRateHertz: String(STT_SAMPLE_RATE) });
  // folderId нужен только при авторизации пользовательским IAM-токеном; с ключом сервисного аккаунта — нельзя (docs SpeechKit v1).
  if (auth.startsWith('Bearer') && opts.folderId) params.set('folderId', opts.folderId);
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${STT_URL}?${params}`, {
      method: 'POST',
      headers: { Authorization: auth, 'content-type': 'application/octet-stream' },
      body: audio as unknown as BodyInit,
      signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError('stt_unavailable', 'Распознавание сейчас недоступно — напиши текстом', 503);
  }
  if (!res.ok) {
    const status = res.status === 429 ? 429 : 503;
    throw new AppError(status === 429 ? 'rate_limited' : 'stt_unavailable', 'Распознавание сейчас недоступно — напиши текстом', status);
  }
  const body = (await res.json().catch(() => ({}))) as { result?: unknown };
  return typeof body.result === 'string' ? body.result.trim() : '';
}
