import { listClaims, listSubcategories, listTemplates } from '@/server/admin/catalogs';
import { requireStaff } from '@/server/admin/session';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Справочники: подкатегории, каталог утверждений (первые 500 по фильтру ?q=&specialization=), шаблоны заданий и проектов (edit_catalogs). */
export const GET = withErrors(async (req: Request) => {
  await requireStaff(req, 'edit_catalogs');
  const url = new URL(req.url);
  const [subcategories, claims, templates] = await Promise.all([
    listSubcategories(),
    listClaims({ q: url.searchParams.get('q') ?? undefined, specialization: url.searchParams.get('specialization') ?? undefined }),
    listTemplates(),
  ]);
  return Response.json({ subcategories, claims, templates });
});
