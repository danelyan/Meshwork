// Имя принявшего кандидата в ленте помощника (решение владельца 09.10).
// Граница доверия: имя добавляется ЗДЕСЬ, после хода агента, на пути к клиенту (SSE и
// восстановление чата). Инструменты и история модели имени не знают: AssistantCandidateSchema
// `.strict()` не пропустит поле `name`, а этот модуль вызывается только из route/restore.
import { prisma } from '@/server/db';
import { acceptedCandidateIds } from '@/server/employer/matching';

import type { CandidatesBlock, CandidatesBlockView, EmployerAgentEvent } from './types';

/** Имена кандидатов, принявших приглашение именно этой компании. Остальным имя не отдаётся. */
export async function acceptedNames(companyId: string, candidateIds: string[]): Promise<Map<string, string>> {
  const accepted = await acceptedCandidateIds(companyId, candidateIds);
  if (accepted.size === 0) return new Map();
  const rows = await prisma.candidate.findMany({ where: { id: { in: [...accepted] } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function withAcceptedNames(companyId: string, block: CandidatesBlock | CandidatesBlockView): Promise<CandidatesBlockView> {
  const names = await acceptedNames(companyId, block.items.map((c) => c.candidateId));
  return { ...block, items: block.items.map((c) => ({ ...c, ...(names.has(c.candidateId) ? { name: names.get(c.candidateId)! } : {}) })) };
}

/** Событие для клиента: карточки подборки обогащаются именем принявших, остальное — как есть. */
export async function enrichEvent(companyId: string, e: EmployerAgentEvent): Promise<EmployerAgentEvent> {
  return e.type === 'candidates' ? { type: 'candidates', block: await withAcceptedNames(companyId, e.block) } : e;
}
