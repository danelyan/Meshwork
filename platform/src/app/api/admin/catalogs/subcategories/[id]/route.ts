import { z } from 'zod';

import { SubcategoryPatch, updateSubcategory } from '@/server/admin/catalogs';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** PATCH { status?, order?, reason } - статус и порядок подкатегории (edit_catalogs). */
export const PATCH = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'edit_catalogs');
  const { id } = await ctx.params;
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { reason } = z.object({ reason: z.string() }).parse(raw);
  const patch = SubcategoryPatch.parse({ status: raw.status, order: raw.order });
  return Response.json({ subcategory: await updateSubcategory(id, patch, staff, reason) });
});
