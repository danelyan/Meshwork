import { assertSameOrigin } from '@/server/auth/csrf';
import { errors, withErrors } from '@/server/errors';
import { getSession } from '@/server/session';
import { STT_MAX_BYTES, STT_SAMPLE_RATE, recognizeServer, sttMode, sttRateLimit } from '@/server/stt';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Какой распознаватель доступен композеру: yandex / openai / browser / off. */
export const GET = withErrors(async () => Response.json({ mode: sttMode(), sampleRate: STT_SAMPLE_RATE, maxBytes: STT_MAX_BYTES }));

/**
 * Голос → текст через Yandex SpeechKit или OpenAI-совместимый whisper (STT_PROVIDER). Тело – LPCM 16 бит моно 16 кГц (`audio/l16`), до 1 МБ (≈ 30 с).
 * Только для вошедших, лимит запросов на сессию (STT_RATE). Аудио не сохраняется: читаем поток в память, отдаём SpeechKit, забываем.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const session = getSession(req);
  if (!session) throw errors.unauthorized();
  if (sttMode() === 'browser' || sttMode() === 'off') throw errors.badRequest('Серверное распознавание выключено');
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > STT_MAX_BYTES) throw errors.payloadTooLarge('Запись длиннее 30 секунд - скажи короче');
  if (!req.body) throw errors.badRequest('Пустая запись');
  const key = session.userId ?? session.candidateId ?? 'anon';
  if (!sttRateLimit(key)) throw errors.rateLimited('Слишком часто - распознавание передохнёт минуту, напиши текстом');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > STT_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw errors.payloadTooLarge('Запись длиннее 30 секунд - скажи короче');
    }
    chunks.push(value);
  }
  const audio = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    audio.set(c, off);
    off += c.byteLength;
  }
  const text = await recognizeServer(audio, req.signal);
  return Response.json({ text });
});
