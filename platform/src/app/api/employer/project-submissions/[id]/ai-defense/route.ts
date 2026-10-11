import { assertEmployerConsents } from '@/server/consent/service';
import { getEmployerAiDefense } from '@/server/defense-room';
import { loadEmployerContext } from '@/server/employer';
import { withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — вердикт ИИ-защиты сдачи (ADR 0008 п. 1). До принятого приглашения — псевдоним, баллы по рубрике A-02 и флаги;
 * без транскрипта, записи и ссылки на репозиторий. После accepted с действующим раскрытием — ещё `sessionId`,
 * `transcript`, `hasRecording` (запись — `/api/call/{sessionId}/recording`) и `repoUrl`. Сдача чужой вакансии или
 * скрытого кандидата — 404.
 */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  const { employerProfileId, userId } = requireEmployer(req);
  await assertEmployerConsents(userId); // ADR 0005: данные кандидатов — после оферты и обязательства
  const { id } = await params;
  const ctx = await loadEmployerContext(employerProfileId);
  return Response.json(await getEmployerAiDefense(ctx.companyId, id));
});
