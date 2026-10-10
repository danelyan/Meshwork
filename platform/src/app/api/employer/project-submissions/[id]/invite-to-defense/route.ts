import { assertSameOrigin } from '@/server/auth/csrf';
import { loadEmployerContext } from '@/server/employer';
import { withErrors } from '@/server/errors';
import { InviteToDefenseInput } from '@/server/project/schemas';
import { inviteToDefense } from '@/server/project/service';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST `{ message, salaryFrom, salaryTo }` — позвать автора сдачи на защиту: приглашение с вилкой по потребности
 * задания (R-E-05) и сессия защиты (lane call). Только проверенная сдача; повторно — 409.
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { employerProfileId } = requireEmployer(req);
  const { id } = await params;
  const input = InviteToDefenseInput.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await inviteToDefense(ctx, id, input), { status: 201 });
});
