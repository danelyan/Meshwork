import { type Env, getEnv } from '@/server/env';
import { AppError } from '@/server/errors';
import { yandexAuthHeader } from '@/server/llm/providers/yandex-responses';

/**
 * Озвучка ответов компаньона (3D-аватар в чате). Режим — env TTS_PROVIDER:
 *  - yandex — SpeechKit, REST v1 `tts:synthesize` (form-urlencoded: text, lang, voice, emotion, speed, format;
 *    лимит SpeechKit — 5000 знаков, у нас 1000);
 *  - off — кнопки озвучки нет;
 *  - auto (по умолчанию) — yandex при YANDEX_API_KEY + YANDEX_FOLDER_ID, иначе off.
 * Аудио не хранится и не пишется в журнал: ответ SpeechKit сразу уходит клиенту.
 */
export type TtsMode = 'yandex' | 'off';

export const TTS_URL = 'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize';

export const TTS_CONTENT_TYPE = { mp3: 'audio/mpeg', oggopus: 'audio/ogg; codecs=opus' } as const;

export function ttsMode(env: Env = getEnv()): TtsMode {
  if (env.TTS_PROVIDER === 'off') return 'off';
  return env.YANDEX_API_KEY && env.YANDEX_FOLDER_ID ? 'yandex' : 'off';
}

export interface SynthesizeOptions {
  apiKey: string;
  folderId?: string;
  voice: string;
  emotion?: string;
  speed: number;
  format: keyof typeof TTS_CONTENT_TYPE;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** Текст (уже очищенный) → байты аудио SpeechKit. `fetchImpl` подменяется в тестах. */
export async function synthesizeYandex(text: string, opts: SynthesizeOptions): Promise<ArrayBuffer> {
  const auth = yandexAuthHeader(opts.apiKey);
  const form = new URLSearchParams({ text, lang: 'ru-RU', voice: opts.voice, speed: opts.speed.toFixed(2), format: opts.format });
  if (opts.emotion) form.set('emotion', opts.emotion);
  // folderId — только при пользовательском IAM-токене; с ключом сервисного аккаунта не указывается (docs SpeechKit v1).
  if (auth.startsWith('Bearer') && opts.folderId) form.set('folderId', opts.folderId);
  const timeout = AbortSignal.timeout(15_000);
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(TTS_URL, {
      method: 'POST',
      headers: { Authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
  } catch {
    throw new AppError('tts_unavailable', 'Озвучка сейчас недоступна', 503);
  }
  if (!res.ok) {
    const limited = res.status === 429;
    throw new AppError(limited ? 'rate_limited' : 'tts_unavailable', 'Озвучка сейчас недоступна', limited ? 429 : 503);
  }
  return res.arrayBuffer();
}

/**
 * Лимит запросов озвучки на сессию: скользящее окно в памяти процесса (один инстанс на стенде).
 * Защищает платный SpeechKit от цикла на клиенте; не замена квоте облака.
 */
export const TTS_RATE = { windowMs: 60_000, max: 20, charsPerWindow: 8000 };

const hits = new Map<string, { at: number; chars: number }[]>();

export function ttsRateLimit(key: string, chars: number, now = Date.now(), rate = TTS_RATE): boolean {
  const recent = (hits.get(key) ?? []).filter((h) => now - h.at < rate.windowMs);
  const used = recent.reduce((s, h) => s + h.chars, 0);
  if (recent.length >= rate.max || used + chars > rate.charsPerWindow) {
    hits.set(key, recent);
    return false;
  }
  recent.push({ at: now, chars });
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((h) => now - h.at < rate.windowMs)) hits.delete(k);
  }
  return true;
}

export function resetTtsRateLimit(): void {
  hits.clear();
}
