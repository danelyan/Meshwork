import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors';
import { yandexAuthHeader } from '@/server/llm/providers/yandex-responses';

/**
 * Распознавание голоса для композера чата. Режим — env STT_PROVIDER:
 *  - yandex — SpeechKit, синхронный REST v1 `stt:recognize` (короткое аудио: ≤ 30 с, ≤ 1 МБ, 1 канал;
 *    форматы lpcm/oggopus — webm не принимает, поэтому клиент пишет LPCM 16 кГц через Web Audio);
 *  - openai — OpenAI-совместимый `POST {STT_OPENAI_BASE_URL}/audio/transcriptions` (vLLM whisper-large-v3 в Selectel):
 *    LPCM заворачивается в WAV, тот же лимит 30 с / 1 МБ, что и у yandex; включается только явно, `auto` его не выбирает;
 *  - browser — распознаёт браузер (Web Speech API), сервер не участвует;
 *  - off — кнопки микрофона нет;
 *  - auto (по умолчанию) — yandex при YANDEX_API_KEY + YANDEX_FOLDER_ID, иначе browser.
 * Аудио на сервере не хранится и не пишется в журнал: тело запроса уходит в SpeechKit и забывается.
 */
export type SttMode = 'yandex' | 'openai' | 'browser' | 'off';

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
  if (want === 'openai') return env.STT_OPENAI_BASE_URL && env.STT_OPENAI_API_KEY ? 'openai' : 'browser';
  if (want === 'yandex') return hasKeys ? 'yandex' : 'browser';
  return hasKeys ? 'yandex' : 'browser';
}

/** LPCM 16 бит, моно, 16 кГц → текст. `fetchImpl` подменяется в тестах. */
export async function recognizeYandex(
  audio: Uint8Array,
  opts: { apiKey: string; folderId?: string; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<string> {
  if (audio.byteLength === 0) throw new AppError('bad_request', 'Пустая запись', 400);
  if (audio.byteLength > STT_MAX_BYTES) throw new AppError('payload_too_large', `Запись длиннее ${STT_MAX_SECONDS} секунд - скажи короче`, 413);
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
    throw new AppError('stt_unavailable', 'Распознавание сейчас недоступно - напиши текстом', 503);
  }
  if (!res.ok) {
    const status = res.status === 429 ? 429 : 503;
    throw new AppError(status === 429 ? 'rate_limited' : 'stt_unavailable', 'Распознавание сейчас недоступно - напиши текстом', status);
  }
  const body = (await res.json().catch(() => ({}))) as { result?: unknown };
  return typeof body.result === 'string' ? body.result.trim() : '';
}

/** PCM 16 бит моно → WAV (44-байтный RIFF-заголовок). */
export function pcmToWav(pcm: Uint8Array, sampleRate = STT_SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength);
  const v = new DataView(out.buffer);
  const tag = (off: number, s: string) => [...s].forEach((c, i) => (out[off + i] = c.charCodeAt(0)));
  tag(0, 'RIFF');
  v.setUint32(4, 36 + pcm.byteLength, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // моно
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}

/** LPCM 16 бит, моно, 16 кГц → текст через OpenAI-совместимый /audio/transcriptions (vLLM whisper). Аудио не хранится и не логируется. */
export async function recognizeOpenai(
  audio: Uint8Array,
  opts: { baseUrl: string; apiKey: string; model?: string; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<string> {
  if (audio.byteLength === 0) throw new AppError('bad_request', 'Пустая запись', 400);
  if (audio.byteLength > STT_MAX_BYTES) throw new AppError('payload_too_large', `Запись длиннее ${STT_MAX_SECONDS} секунд - скажи короче`, 413);
  const form = new FormData();
  form.set('file', new Blob([pcmToWav(audio) as unknown as BlobPart], { type: 'audio/wav' }), 'audio.wav');
  form.set('model', opts.model || 'whisper-large-v3');
  form.set('language', 'ru');
  form.set('response_format', 'json');
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${opts.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
      signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AppError('stt_unavailable', 'Распознавание сейчас недоступно - напиши текстом', 503);
  }
  if (!res.ok) {
    const status = res.status === 429 ? 429 : 503;
    throw new AppError(status === 429 ? 'rate_limited' : 'stt_unavailable', 'Распознавание сейчас недоступно - напиши текстом', status);
  }
  const body = (await res.json().catch(() => ({}))) as { text?: unknown };
  return typeof body.text === 'string' ? body.text.trim() : '';
}

/** Серверное распознавание по текущему режиму (yandex | openai). */
export async function recognizeServer(audio: Uint8Array, signal?: AbortSignal, env = getEnv()): Promise<string> {
  if (sttMode(env) === 'openai') {
    return recognizeOpenai(audio, { baseUrl: env.STT_OPENAI_BASE_URL as string, apiKey: env.STT_OPENAI_API_KEY as string, model: env.STT_OPENAI_MODEL, signal });
  }
  return recognizeYandex(audio, { apiKey: env.YANDEX_API_KEY as string, folderId: env.YANDEX_FOLDER_ID, signal });
}

/**
 * Лимит запросов распознавания на сессию: скользящее окно в памяти процесса (один инстанс на стенде), как у
 * озвучки (`ttsRateLimit`). Запись — до 30 с, диктовка в чате и в защите даёт единицы запросов в минуту; 30 в минуту —
 * только цикл на клиенте. Защищает платный сервис распознавания, не замена квоте облака.
 */
export const STT_RATE = { windowMs: 60_000, max: 30 };

const hits = new Map<string, number[]>();

export function sttRateLimit(key: string, now = Date.now(), rate = STT_RATE): boolean {
  const recent = (hits.get(key) ?? []).filter((at) => now - at < rate.windowMs);
  if (recent.length >= rate.max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((at) => now - at < rate.windowMs)) hits.delete(k);
  }
  return true;
}

/** Только для тестов. */
export function resetSttRateLimit(): void {
  hits.clear();
}
