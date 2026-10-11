import { assertSameOrigin } from '@/server/auth/csrf';
import { addVideo, callPrincipal, getVideo } from '@/server/call';
import { VideoQuery } from '@/server/call/schemas';
import { VIDEO_CONTENT_TYPE, VIDEO_SEGMENT_MAX_BYTES } from '@/server/call/video';
import { errors, withErrors } from '@/server/errors';
import { getSession, requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/call/{id}/video?startMs= – сегмент видео с камеры кандидата (WebM, до 8 МБ): файл созвона рядом с аудио.
 * Видео не анализируется – хранится как материал созвона (согласие: пункт о камере).
 * Без действующего согласия на запись сегмент не сохраняется: 409 `call_recording_off`, как у аудио.
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  // Маршрут уровня session (GET доступен и работодателю); загрузка – только кандидату.
  if (!getSession(req)) throw errors.unauthorized();
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const q = VideoQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > VIDEO_SEGMENT_MAX_BYTES) throw errors.payloadTooLarge('Сегмент видео слишком большой');
  if (!req.body) throw errors.badRequest('Пустой сегмент видео');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > VIDEO_SEGMENT_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw errors.payloadTooLarge('Сегмент видео слишком большой');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  return Response.json(await addVideo(candidateId, id, bytes, q.startMs), { status: 201 });
});

/** GET /api/call/{id}/video?segment=NNN-<startMs>.webm – кандидату всегда, работодателю после принятого приглашения. */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  if (!getSession(req)) throw errors.unauthorized();
  const who = callPrincipal(req);
  const { id } = await params;
  const segment = new URL(req.url).searchParams.get('segment');
  if (!segment) throw errors.badRequest('Нужен параметр segment');
  const bytes = await getVideo(who, id, segment);
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': VIDEO_CONTENT_TYPE, 'cache-control': 'private, no-store', 'content-disposition': `inline; filename="${segment}"` },
  });
});
