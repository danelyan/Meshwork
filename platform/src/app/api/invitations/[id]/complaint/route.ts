import { assertSameOrigin } from '@/server/auth/csrf';
import { fileComplaint } from '@/server/employer/complaints';
import { ComplaintInput } from '@/server/employer/schemas';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/invitations/:id/complaint `{ reason: spam | salary_mismatch | offensive | fake_company | other, comment? }` (R-X-01).
 * Жалоба кандидата на полученное приглашение: чужое — 404, повторная — 409, комментарий до 1000 символов.
 * Статус приглашения не меняется; жалобы за 30 дней снижают лимит приглашений компании.
 */
export const POST = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const { id } = await params;
  const input = ComplaintInput.parse(await req.json().catch(() => ({})));
  return Response.json(await fileComplaint(candidateId, id, input), { status: 201 });
});
