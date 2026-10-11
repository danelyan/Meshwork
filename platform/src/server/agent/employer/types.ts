// Помощник работодателя (lane emp-agent, решение владельца 09.10): контракт событий и контекста.
// Отдельно от кандидатского ToolContext/AgentEvent – роли не смешиваются ни в типах, ни в БД.
import type { InvitationStatus } from '@prisma/client';

import type { EvidenceLevel } from '@/server/claims/types';
import type { PublicSourceType } from '@/server/employer/privacy';
import type { LlmProvider } from '@/server/llm/types';
import type { Grade, Specialization } from '@/server/types';

/**
 * Кандидат глазами помощника – то, что уходит в модель (результат инструмента, история).
 * Только публичная часть (R-E-07): псевдоним, категория, ФСП, покрытие, утверждения
 * формулировкой каталога с уровнем и типом источника. Имени, почты и цитат нет НИКОГДА,
 * в том числе после принятия приглашения. Имя принявшего (решение владельца 09.10)
 * добавляется только в ленту – см. AssistantCandidateView; контакты – в «Приглашениях».
 */
export interface AssistantCandidate {
  candidateId: string;
  alias: string;
  rank: number;
  score: number;
  category: string | null;
  specialization: Specialization | null;
  fsp: boolean;
  covered: number;
  total: number;
  coveredItems: { statement: string; level: EvidenceLevel; sourceType: PublicSourceType | null }[];
  missing: string[];
  stackMatched: string[];
  summary: string;
  invitation: InvitationStatus | null;
}

/**
 * Карточка в ленте (SSE и восстановление чата): AssistantCandidate плюс `name` – только
 * если у компании есть принятое приглашение этого кандидата. Добавляет серверный слой
 * (employer/names.ts) уже после хода агента; в модель и в её историю поле не попадает.
 */
export type AssistantCandidateView = AssistantCandidate & { name?: string };

export interface CandidatesBlock {
  /** null – поиск по всей базе. */
  vacancy: { id: string; title: string; salaryFrom: number; salaryTo: number } | null;
  total: number;
  items: AssistantCandidate[];
}

export type CandidatesBlockView = Omit<CandidatesBlock, 'items'> & { items: AssistantCandidateView[] };

export interface InvitationDraft {
  candidateId: string;
  alias: string;
  vacancyId: string | null;
  vacancyTitle: string | null;
  /** Вилка, ₽ в месяц; null – нет потребности и не указана. */
  salaryFrom: number | null;
  salaryTo: number | null;
  message: string;
  limit: { sent: number; limit: number; left: number };
  /** Отправить нельзя: лимит, уже есть открытое приглашение или у компании нет способа связи (E05). */
  blocked: 'daily_limit' | 'open_invitation' | 'no_company_contact' | null;
}

export interface NeedDraft {
  title: string;
  specialization: Specialization;
  grade: Grade;
  stack: string[];
  salaryFrom: number | null;
  salaryTo: number | null;
  teamDescription: string | null;
  needs: { catalogId: string; statement: string; weight: number }[];
  /** Ссылка на форму потребности с предзаполнением – подтверждает человек. */
  formHref: string;
}

/**
 * Черновик профиля компании (решение владельца 11.10: через помощника можно «дополнить что-то по своей
 * компании»). Только поля, которые работодатель и так правит на /employer/company; применяет человек
 * кнопкой «Применить» → PATCH /api/employer/company. Поле null — не менять.
 */
export interface CompanyDraft {
  name: string | null;
  industry: string | null;
  description: string | null;
  contact: string | null;
  /** Что сейчас в профиле — лента показывает «было → станет». */
  current: { name: string; industry: string | null; description: string | null; contact: string | null };
  rationale: string;
}

/**
 * Черновик проектного задания к вакансии (решение владельца 11.10: «создать задания» из чата).
 * Шаблон и критерии — из каталога (контракт шаблона не меняется, R-C-10); создаёт человек кнопкой
 * «Сформировать» → POST /api/employer/needs/:id/project тем же телом, что и форма EmployerProjectBlock.
 */
export interface ProjectTaskDraft {
  vacancyId: string;
  vacancyTitle: string;
  templateId: string;
  templateTitle: string;
  criteria: { catalogId: string; statement: string }[];
  wishes: string;
  visibility: 'feed' | 'invited';
  /** Уже есть задание к этой вакансии — лента предупреждает, что оно будет заменено. */
  replacesExisting: boolean;
  rationale: string;
}

export type EmployerAgentEvent =
  | { type: 'conversation'; id: string }
  | { type: 'step'; text: string }
  | { type: 'queue'; position: number }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'candidates'; block: CandidatesBlockView }
  | { type: 'invitation_draft'; draft: InvitationDraft }
  | { type: 'need_draft'; draft: NeedDraft }
  | { type: 'company_draft'; draft: CompanyDraft }
  | { type: 'project_task_draft'; draft: ProjectTaskDraft }
  | { type: 'message'; text: string; id?: string }
  | { type: 'delta'; id: string; text: string }
  | { type: 'discard'; id: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' };

export interface EmployerToolContext {
  employerProfileId: string;
  companyId: string;
  conversationId: string;
  emit(e: EmployerAgentEvent): void;
  llm: LlmProvider;
  signal?: AbortSignal;
}

export interface EmployerTurnInput {
  employerProfileId: string;
  conversationId: string;
  text: string;
  /** Откуда пишет работодатель (плавающий чат): страница и вакансия на ней — модель начинает с этого контекста. */
  page?: { path: string; vacancyId?: string | null } | null;
}
