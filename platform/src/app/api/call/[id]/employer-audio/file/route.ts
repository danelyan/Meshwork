import { EMPLOYER_AUDIO_CONTENT_TYPE, getEmployerAudio } from '@/server/defense-room';
import { EmployerAudioSegmentQuery } from '@/server/defense-room/schemas';
import { errors, withErrors } from '@/server/errors';
import { getSession } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/call/{id}/employer-audio/file?segment=NNN-<startMs>.webm — один сегмент голоса работодателя (доступ как к списку). */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  const s = getSession(req);
  if (!s) throw errors.unauthorized();
  const { id } = await params;
  const { segment } = EmployerAudioSegmentQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const bytes = await getEmployerAudio(s, id, segment);
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': EMPLOYER_AUDIO_CONTENT_TYPE, 'cache-control': 'private, no-store', 'content-disposition': `inline; filename="employer-${segment}"` },
  });
});
