import { assertSameOrigin } from '@/server/auth/csrf';
import { addEmployerAudio, EMPLOYER_AUDIO_SEGMENT_MAX_BYTES } from '@/server/defense-room';
import { EmployerAudioQuery } from '@/server/defense-room/schemas';
import { errors, withErrors } from '@/server/errors';
import { getSession, requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/employer/call/{id}/audio?startMs= – сегмент голоса работодателя в живой защите (WebM/Opus, до 4 МБ;
 * ADR 0008 п. 3: пишутся обе стороны). Только участник комнаты своей компании, подтвердивший запись при входе.
 */
export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  requireEmployer(req);
  const { id } = await ctx.params;
  const q = EmployerAudioQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > EMPLOYER_AUDIO_SEGMENT_MAX_BYTES) throw errors.payloadTooLarge('Сегмент аудио слишком большой');
  if (!req.body) throw errors.badRequest('Пустой сегмент аудио');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > EMPLOYER_AUDIO_SEGMENT_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw errors.payloadTooLarge('Сегмент аудио слишком большой');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  return Response.json(await addEmployerAudio(getSession(req), id, bytes, q.startMs), { status: 201 });
});
