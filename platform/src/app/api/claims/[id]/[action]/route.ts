import type { Claim } from '@prisma/client';
import { z } from 'zod';

import { confirmClaim, editClaim, rejectClaim } from '@/server/claims';
import { errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

const EditBody = z.object({ statement: z.string() });

function view(c: Claim) {
  return {
    id: c.id,
    catalogId: c.catalogId,
    statement: c.statement,
    wording: c.wording,
    level: c.level,
    quote: c.quote,
    sourceRef: c.sourceRef,
    sourceKind: c.sourceKind,
    status: c.status,
    confirmedAt: c.confirmedAt ? c.confirmedAt.toISOString() : null,
  };
}

/**
 * POST /api/claims/:id/confirm | edit | reject — карточка «да / поправить / нет».
 * Только владелец: чужое и несуществующее → 404. edit: `{ statement }` — меняет только формулировку
 * (и показываемую кандидату `wording`, и `statement`).
 */
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string; action: string }> }) => {
  const candidateId = requireCandidate(req);
  const { id, action } = await ctx.params;
  let claim: Claim;
  switch (action) {
    case 'confirm':
      claim = await confirmClaim(candidateId, id);
      break;
    case 'reject':
      claim = await rejectClaim(candidateId, id);
      break;
    case 'edit': {
      const body = EditBody.parse(await req.json().catch(() => ({})));
      claim = await editClaim(candidateId, id, body.statement);
      break;
    }
    default:
      throw errors.notFound('Неизвестное действие');
  }
  return Response.json({ claim: view(claim) });
});
