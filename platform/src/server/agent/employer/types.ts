// Помощник работодателя (lane emp-agent, решение владельца 09.10): контракт событий и контекста.
// Отдельно от кандидатского ToolContext/AgentEvent — роли не смешиваются ни в типах, ни в БД.
import type { InvitationStatus } from '@prisma/client';

import type { EvidenceLevel } from '@/server/claims/types';
import type { PublicSourceType } from '@/server/employer/privacy';
import type { LlmProvider } from '@/server/llm/types';
import type { Grade, Specialization } from '@/server/types';

/**
 * Кандидат глазами помощника — то, что уходит и в модель, и в ленту. Только публичная
 * часть (R-E-07): псевдоним, категория, ФСП, покрытие, утверждения формулировкой каталога
 * с уровнем и типом источника. Имени, почты и цитат нет НИКОГДА — даже после принятия
 * приглашения (контакты — в разделе «Приглашения», не в разговоре с моделью).
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

export interface CandidatesBlock {
  /** null — поиск по всей базе. */
  vacancy: { id: string; title: string; salaryFrom: number } | null;
  total: number;
  items: AssistantCandidate[];
}

export interface InvitationDraft {
  candidateId: string;
  alias: string;
  vacancyId: string | null;
  vacancyTitle: string | null;
  salaryOffer: number | null;
  message: string;
  limit: { sent: number; limit: number; left: number };
  /** Отправить нельзя: лимит или уже есть открытое приглашение. */
  blocked: 'daily_limit' | 'open_invitation' | null;
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
  /** Ссылка на форму потребности с предзаполнением — подтверждает человек. */
  formHref: string;
}

export type EmployerAgentEvent =
  | { type: 'conversation'; id: string }
  | { type: 'step'; text: string }
  | { type: 'queue'; position: number }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'candidates'; block: CandidatesBlock }
  | { type: 'invitation_draft'; draft: InvitationDraft }
  | { type: 'need_draft'; draft: NeedDraft }
  | { type: 'message'; text: string }
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
}
