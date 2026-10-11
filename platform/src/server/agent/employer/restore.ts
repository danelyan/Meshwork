import { prisma } from '@/server/db';
import { loadEmployerContext } from '@/server/employer';
import type { ToolCall } from '@/server/llm/types';

import { PAUSE_MARK_RE } from '@/server/onboarding/match';

import { pauseStepOf } from '../restore';
import { withAcceptedNames } from './names';
import type { CandidatesBlock, CompanyDraft, EmployerAgentEvent, InvitationDraft, NeedDraft, ProjectTaskDraft } from './types';

/** `stepId` + `paused` — реплика (и ответ на неё) из паузы знакомства: лента ставит их под шаг (как у кандидата, restore.ts). */
export type EmployerRestoredItem =
  | { id: string; role: 'user'; text: string; stepId?: string; paused?: true }
  | { id: string; role: 'agent'; event: EmployerAgentEvent; stepId?: string; paused?: true };

export interface EmployerRestoredChat {
  conversationId: string | null;
  items: EmployerRestoredItem[];
}

function parse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** Результат инструмента-черновика = черновик + служебные флаги (`drafted`, `saved`); флаги в ленту не идут. */
function draftOf<T>(out: Record<string, unknown>): T {
  const draft = { ...out };
  delete draft.drafted;
  delete draft.saved;
  return draft as T;
}

/**
 * Последний разговор работодателя для перезагрузки: реплики и карточки из результатов
 * инструментов (выдача, черновики) — те же данные, что видела модель, без имён и контактов (имя принявших добавляется отдельно, names.ts).
 * Статус приглашения в карточках — актуальный из БД (мог смениться после разговора).
 * Чужие разговоры не читаются: выборка по employerProfileId.
 */
export async function loadLastEmployerChat(employerProfileId: string): Promise<EmployerRestoredChat> {
  const conv = await prisma.employerConversation.findFirst({ where: { employerProfileId }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
  if (!conv) return { conversationId: null, items: [] };
  const rows = await prisma.employerMessage.findMany({
    where: { conversationId: conv.id, role: { in: ['user', 'assistant', 'tool'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, toolCalls: true, toolCallId: true },
  });
  const nameById = new Map<string, string>();
  const items: EmployerRestoredItem[] = [];
  // Метка паузы стоит у реплики работодателя и действует на ответы (текст, карточки) до его следующей реплики.
  let tag: { stepId?: string; paused?: true } = {};
  for (const m of rows) {
    if (m.role === 'user') {
      const pause = pauseStepOf(m.content);
      tag = pause ? { stepId: pause, paused: true } : {};
      const text = m.content
        .split('\n')
        .filter((line) => !PAUSE_MARK_RE.test(line.trim()))
        .join('\n');
      items.push({ id: `r-${m.id}`, role: 'user', text, ...tag });
    } else if (m.role === 'assistant') {
      if (Array.isArray(m.toolCalls)) for (const c of m.toolCalls as unknown as ToolCall[]) nameById.set(c.id, c.name);
      if (m.content.trim()) items.push({ id: `r-${m.id}`, role: 'agent', event: { type: 'message', text: m.content }, ...tag });
    } else {
      const name = m.toolCallId ? nameById.get(m.toolCallId) : undefined;
      const out = parse(m.content) as Record<string, unknown> | null;
      if (!name || !out || 'error' in out) continue;
      if (name === 'match_for_need' || name === 'search_candidates') items.push({ id: `r-${m.id}`, role: 'agent', event: { type: 'candidates', block: out as unknown as CandidatesBlock }, ...tag });
      else if (name === 'draft_invitation') items.push({ id: `r-${m.id}`, role: 'agent', event: { type: 'invitation_draft', draft: out as unknown as InvitationDraft }, ...tag });
      else if (name === 'draft_company_profile') items.push({ id: `r-${m.id}`, role: 'agent', event: { type: 'company_draft', draft: draftOf<CompanyDraft>(out) }, ...tag });
      else if (name === 'create_project_task_draft') items.push({ id: `r-${m.id}`, role: 'agent', event: { type: 'project_task_draft', draft: draftOf<ProjectTaskDraft>(out) }, ...tag });
      else if (name === 'create_need_draft') items.push({ id: `r-${m.id}`, role: 'agent', event: { type: 'need_draft', draft: out as unknown as NeedDraft }, ...tag });
    }
  }
  // Актуальные статусы приглашений для показанных кандидатов.
  const ids = new Set<string>();
  for (const it of items) if (it.role === 'agent' && it.event.type === 'candidates') for (const c of it.event.block.items) ids.add(c.candidateId);
  if (ids.size) {
    const { companyId } = await loadEmployerContext(employerProfileId);
    const inv = await prisma.invitation.findMany({
      where: { companyId, candidateId: { in: [...ids] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: { candidateId: true, status: true },
    });
    const last = new Map<string, (typeof inv)[number]['status']>();
    for (const r of inv) if (!last.has(r.candidateId)) last.set(r.candidateId, r.status);
    for (const it of items) {
      if (it.role !== 'agent' || it.event.type !== 'candidates') continue;
      const block = it.event.block;
      const fresh = { ...block, items: block.items.map((c) => ({ ...c, invitation: last.get(c.candidateId) ?? null })) };
      // Имя принявших — только для ленты, не из истории модели (names.ts).
      it.event = { type: 'candidates', block: await withAcceptedNames(companyId, fresh) };
    }
  }
  return { conversationId: conv.id, items };
}
