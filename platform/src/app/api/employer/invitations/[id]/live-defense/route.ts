import { assertSameOrigin } from '@/server/auth/csrf';
import { loadEmployerContext } from '@/server/employer';
import { withErrors } from '@/server/errors';
import { proposeSlots } from '@/server/live-defense';
import { LiveSlotsInput } from '@/server/live-defense/schemas';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST `{ slots: ISO[], durationMin: 30|45, comment? }` — предложить слоты живой защиты по принятому приглашению своей
 * компании (ADR 0008): 2–5 слотов, не раньше чем через 2 часа и не позже 14 дней. Новое предложение заменяет старое.
 * Чужое — 404; не accepted — 409 `invitation_not_accepted`; у кандидата нет проверенного проекта — 409 `project_not_submitted`; время занято другим кандидатом — 409 `slot_taken`;
 * защита уже назначена — 409 `live_defense_scheduled` (сначала отмена).
 */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { employerProfileId, userId } = requireEmployer(req);
  const { id } = await params;
  const input = LiveSlotsInput.parse(await req.json().catch(() => ({})));
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await proposeSlots({ companyId: ctx.companyId, userId }, id, input), { status: 201 });
});
