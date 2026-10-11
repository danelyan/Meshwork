import { z } from 'zod';

import { ClaimPatch, updateClaim } from '@/server/admin/catalogs';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** PATCH { statement?, limits?, reason } - текст записи каталога утверждений; id, веса, грейды и маркеры не меняются (edit_catalogs). */
export const PATCH = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'edit_catalogs');
  const { id } = await ctx.params;
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { reason } = z.object({ reason: z.string() }).parse(raw);
  const patch = ClaimPatch.parse({ statement: raw.statement, limits: raw.limits });
  return Response.json({ claim: await updateClaim(id, patch, staff, reason) });
});
