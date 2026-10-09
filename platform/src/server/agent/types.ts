// Контракт агента-консультанта (лейн agent). E-01-plan.md § «Контракты», ТЗ § 4.1.
import type { ZodType } from 'zod';

import type { LlmProvider } from '../llm/types';
import type { OnboardingStepBrief } from '../onboarding/service';

export type AgentEvent =
  /** «читаю резюме…» */
  | { type: 'step'; text: string }
  | { type: 'queue'; position: number }
  | { type: 'claims'; proposed: unknown[]; rejected: number; rejectedByReason?: Record<string, number>; hiddenText?: number; alreadyKnown?: number }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'recommendations'; items: unknown[] }
  /** Итог реплики; `id` связывает его с дельтами (reply-stream.ts), текст авторитетный. */
  | { type: 'message'; text: string; id?: string }
  /** Кусок текста реплики `id` по мере генерации (docs/platform.md, «События SSE»). */
  | { type: 'delta'; id: string; text: string }
  /** Показанный текст реплики `id` — не ответ (модель ушла в инструменты): убрать. */
  | { type: 'discard'; id: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' }
  /** Первый кадр потока: id разговора (новый создаётся на первом ходе). Добавлено лейном agent. */
  | { type: 'conversation'; id: string };

export interface ToolContext {
  candidateId: string;
  conversationId: string;
  emit(e: AgentEvent): void;
  llm: LlmProvider;
  /** Разрыв SSE: инструменты с сетью/LLM обязаны уважать. */
  signal?: AbortSignal;
}

/** C — контекст роли: кандидат (ToolContext) или работодатель (employer/types.ts). */
export interface AgentTool<I, O, C = ToolContext> {
  name: string;
  description: string;
  input: ZodType<I>;
  output: ZodType<O>;
  handler(ctx: C, input: I): Promise<O>;
  /**
   * Результат содержит текст извне (документ, страница, README, ответ API):
   * цикл оборачивает его в `<external_data … trust="untrusted">` целиком.
   */
  untrusted?: boolean;
  /** После вызова ход заканчивается (ask_user: ждём ответа кандидата). */
  terminal?: boolean;
}

/** Лимит вызовов инструментов за один ход. */
export const MAX_TOOL_CALLS_PER_TURN = 6;

export interface TurnInput {
  candidateId: string;
  conversationId: string;
  text: string;
  /** Вложения первого хода: id из /api/uploads и ссылки. */
  uploadIds?: string[];
  urls?: string[];
  /** Свободный вопрос посреди онбординга: шаг, к которому вернуть (server/onboarding/service.asideContext). */
  onboarding?: OnboardingStepBrief;
}

/** Зависимости хода, подменяемые в тестах (по умолчанию — getLlm и реестр tools/index). */
export interface TurnOptions {
  llm?: LlmProvider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: AgentTool<any, any>[];
  /** Суточный бюджет токенов; по умолчанию env LLM_DAILY_TOKEN_BUDGET. 0 — без лимита. */
  dailyTokenBudget?: number;
  now?: () => Date;
}
