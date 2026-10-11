import { listDirections } from '@/server/directions';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** GET /api/directions – четыре направления, их подкатегории (Subcategory) и есть ли тест на грейд. R-T-05, ADR 0003. */
export const GET = withErrors(async () => {
  return Response.json({ directions: await listDirections() });
});
