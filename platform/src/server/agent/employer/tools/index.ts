import { askEmployer } from './ask_user';
import { createNeedDraft } from './create_need_draft';
import { draftInvitation } from './draft_invitation';
import { explainCandidate } from './explain_candidate';
import { getEmployerContext } from './get_employer_context';
import { matchForNeed } from './match_for_need';
import { searchCandidates } from './search_candidates';
import type { EmployerTool } from './shared';

/**
 * Реестр помощника работодателя: 6 по решению владельца 09.10 + ask_user. Все — чтение
 * или черновик: отправка приглашения и сохранение потребности — кнопки человека.
 * Кандидатских инструментов здесь нет и наоборот — тест employer-tools.test.ts.
 */
export const employerTools: EmployerTool[] = [
  getEmployerContext,
  matchForNeed,
  searchCandidates,
  explainCandidate,
  draftInvitation,
  createNeedDraft,
  askEmployer,
];

export const EMPLOYER_TOOL_NAMES = employerTools.map((t) => t.name);
