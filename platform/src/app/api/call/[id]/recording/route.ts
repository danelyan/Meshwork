import { callPrincipal, getRecording } from '@/server/call';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/call/{id}/recording?segment=NNN.wav — аудио ответов кандидата одним WAV (или один сегмент).
 * Кандидату — всегда; работодателю — только после принятого приглашения (иначе 403).
 */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  const who = callPrincipal(req);
  const { id } = await params;
  const segment = new URL(req.url).searchParams.get('segment') ?? undefined;
  const wav = await getRecording(who, id, segment);
  return new Response(new Uint8Array(wav), {
    headers: { 'content-type': 'audio/wav', 'cache-control': 'private, no-store', 'content-disposition': `inline; filename="call-${id}.wav"` },
  });
});
