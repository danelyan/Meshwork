import { assertSameOrigin } from '@/server/auth/csrf';
import { ApplicationInput } from '@/server/employer/application-schemas';
import { createApplication } from '@/server/employer/applications';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/career/vacancies/:id/apply `{ message?, disclosureVersion }` — самоотклик на открытую вакансию (R-C-12).
 * Без `disclosureVersion` — 409 `consent_required` (раскрытие имени и контактов этой компании после принятия, R-E-07).
 * Архивная или несуществующая — 404, повтор — 409, больше 20 откликов за сутки — 429.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const input = ApplicationInput.parse(await req.json().catch(() => ({})));
  return Response.json(await createApplication(candidateId, id, input), { status: 201 });
});
