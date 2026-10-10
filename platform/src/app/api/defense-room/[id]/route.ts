import { buildSnapshot, redactSnapshot, resolveViewer } from '@/server/defense-room';
import { withErrors } from '@/server/errors';
import { getSession } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — снимок защиты: транскрипт, участники, mute, прогресс, вердикт. Кандидату — своя сессия;
 * работодателю — только после принятого приглашения (реплики других компаний скрыты). Иначе 404.
 */
export const GET = withErrors(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { viewer } = await resolveViewer(getSession(req), id);
  return Response.json(redactSnapshot(await buildSnapshot(id), viewer));
});
