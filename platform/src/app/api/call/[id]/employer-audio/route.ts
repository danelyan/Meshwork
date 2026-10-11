import { listEmployerAudio } from '@/server/defense-room';
import { errors, withErrors } from '@/server/errors';
import { getSession } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/call/{id}/employer-audio – сегменты голоса работодателя в живой защите (ADR 0008 п. 3). Доступ как к записи
 * защиты: кандидату – своя; работодателю – только компании-владельцу живой защиты после принятого приглашения.
 */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  const s = getSession(req);
  if (!s) throw errors.unauthorized();
  const { id } = await params;
  return Response.json(await listEmployerAudio(s, id));
});
