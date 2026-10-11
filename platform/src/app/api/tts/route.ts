import { z } from 'zod';

import { TTS_MAX_CHARS, cleanForSpeech } from '@/lib/speech-text';
import { assertSameOrigin } from '@/server/auth/csrf';
import { getEnv } from '@/server/env';
import { errors, withErrors } from '@/server/errors';
import { getSession } from '@/server/session';
import { TTS_CONTENT_TYPE, synthesizeElevenLabs, synthesizeYandex, ttsMode, ttsRateLimit } from '@/server/tts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Доступна ли озвучка аватару: yandex / elevenlabs / off. */
export const GET = withErrors(async () => Response.json({ mode: ttsMode(), maxChars: TTS_MAX_CHARS }));

// Сырой текст до чистки может быть длиннее (markdown, ссылки) — режем после чистки.
const Body = z.object({
  text: z.string().min(1).max(TTS_MAX_CHARS * 4),
  /** `employer` — второй голос (TTS_VOICE_EMPLOYER): реплики работодателя в защите проекта. */
  voice: z.enum(['companion', 'employer']).optional(),
});

/**
 * Текст ответа компаньона → аудио SpeechKit (mp3 по умолчанию). Только для вошедших, ≤ 1000 знаков
 * после чистки markdown, лимит запросов на сессию. Аудио не хранится: ответ SpeechKit сразу уходит клиенту.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const session = getSession(req);
  if (!session) throw errors.unauthorized();
  const mode = ttsMode();
  if (mode === 'off') throw errors.badRequest('Озвучка выключена');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw errors.badRequest('Нужен текст для озвучки');
  const text = cleanForSpeech(parsed.data.text);
  if (!text) throw errors.badRequest('Озвучивать нечего');
  if (text.length > TTS_MAX_CHARS) throw errors.payloadTooLarge(`Для озвучки — не больше ${TTS_MAX_CHARS} знаков`);
  const key = session.userId ?? session.candidateId ?? 'anon';
  if (!ttsRateLimit(key, text.length)) throw errors.rateLimited('Слишком часто — озвучка передохнёт минуту');
  const env = getEnv();
  const started = Date.now();
  const employer = parsed.data.voice === 'employer';
  if (mode === 'elevenlabs') {
    const audio = await synthesizeElevenLabs(text, {
      apiKey: env.ELEVENLABS_API_KEY as string,
      voiceId: (employer ? env.ELEVENLABS_VOICE_EMPLOYER || env.ELEVENLABS_VOICE : env.ELEVENLABS_VOICE) as string,
      model: env.ELEVENLABS_MODEL,
      baseUrl: env.ELEVENLABS_BASE_URL,
      speed: env.TTS_SPEED,
      signal: req.signal,
    });
    return new Response(audio, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'server-timing': `tts;dur=${Date.now() - started}` } });
  }
  const audio = await synthesizeYandex(text, {
    apiKey: env.YANDEX_API_KEY as string,
    folderId: env.YANDEX_FOLDER_ID,
    voice: employer ? env.TTS_VOICE_EMPLOYER : env.TTS_VOICE,
    emotion: employer ? undefined : env.TTS_EMOTION || undefined,
    speed: env.TTS_SPEED,
    format: env.TTS_FORMAT,
    signal: req.signal,
  });
  // Замер синтеза (лейн call-speed): SpeechKit v1 отдаёт файл целиком, первый байт = конец синтеза.
  const ttsMs = Date.now() - started;
  return new Response(audio, { headers: { 'content-type': TTS_CONTENT_TYPE[env.TTS_FORMAT], 'cache-control': 'no-store', 'server-timing': `tts;dur=${ttsMs}` } });
});
