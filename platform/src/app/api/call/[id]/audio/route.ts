import { assertSameOrigin } from '@/server/auth/csrf';
import { addAudio } from '@/server/call';
import { CALL_SEGMENT_MAX_BYTES } from '@/server/call/audio';
import { errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/call/{id}/audio — сегмент голоса кандидата (LPCM 16 бит моно 16 кГц, `audio/l16`, до 3 МБ):
 * сохраняется файлом созвона; при STT=yandex сразу распознаётся. Ответ `{audioRef, text}` → `/turn`.
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > CALL_SEGMENT_MAX_BYTES) throw errors.payloadTooLarge('Ответ длиннее полутора минут - раздели его на два');
  if (!req.body) throw errors.badRequest('Пустая запись');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CALL_SEGMENT_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw errors.payloadTooLarge('Ответ длиннее полутора минут - раздели его на два');
    }
    chunks.push(value);
  }
  const pcm = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    pcm.set(c, off);
    off += c.byteLength;
  }
  const obs: { sttMs?: number } = {};
  const result = await addAudio(candidateId, id, pcm, obs);
  // Замер STT (лейн call-speed): Server-Timing, без текста.
  return Response.json(result, { status: 201, headers: obs.sttMs !== undefined ? { 'server-timing': `stt;dur=${obs.sttMs}` } : {} });
});
