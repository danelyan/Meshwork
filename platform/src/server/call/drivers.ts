// Драйверы видов созвона: что спрашивает ИИ и как оценивается результат. Общее (транскрипт, SSE,
// запись, доступ, согласие) — в service.ts. Ступень 1 — qualifying (здесь); defense-room регистрирует
// свой драйвер `registerCallDriver('defense', …)` — вопросы QLC по коду и очередь вопросов работодателя.
import type { Prisma } from '@prisma/client';

import { PLATFORM_UPGRADABLE } from '../claims/levels';
import { AppError } from '../errors';
import type { LlmProvider } from '../llm/types';
import { loadCallContext } from './context';
import { type EvalTopic, evaluateCall } from './evaluator';
import { nextCallQuestion } from './interviewer';
import { CALL_LIMITS, type PlanTurn } from './plan';
import type { CallKind, CallVerdict, QuestionLevel, TranscriptEntry } from './types';

export interface DriverSession {
  id: string;
  candidateId: string;
  kind: CallKind;
  projectSubmissionId: string | null;
  transcript: TranscriptEntry[];
}

export interface DriverQuestion {
  text: string;
  meta: NonNullable<TranscriptEntry['meta']>;
  /** Драйвер считает, что вопросов достаточно (код проверяет минимум). */
  done: boolean;
}

export interface CallDriver {
  kind: CallKind;
  limits: { minQuestions: number; maxQuestions: number };
  /** Проверка перед стартом (например, сабмит проекта принадлежит кандидату). */
  assertCanStart?(candidateId: string, projectSubmissionId: string | null): Promise<void>;
  nextQuestion(session: DriverSession, llm: LlmProvider, signal?: AbortSignal): Promise<DriverQuestion>;
  evaluate(session: DriverSession, llm: LlmProvider, signal?: AbortSignal): Promise<Omit<CallVerdict, 'upgradedCatalogIds' | 'evaluatedAt'>>;
  /** Последствия вердикта в той же транзакции, что и завершение (уровни утверждений). Возвращает поднятые catalogId. */
  applyVerdict?(tx: Prisma.TransactionClient, candidateId: string, verdict: Omit<CallVerdict, 'upgradedCatalogIds' | 'evaluatedAt'>): Promise<string[]>;
}

/** Пары вопрос ИИ (с meta) → ответ кандидата, по порядку. Реплики работодателя не входят. */
export function questionTurns(transcript: readonly TranscriptEntry[]): (PlanTurn & { aiIndex: number })[] {
  const out: (PlanTurn & { aiIndex: number })[] = [];
  for (const e of transcript) {
    if (e.role === 'ai' && e.meta) {
      out.push({ question: e.text, answer: null, topic: e.meta.topic, catalogId: e.meta.catalogId, level: e.meta.level, aiIndex: e.index });
    } else if (e.role === 'candidate') {
      const last = out[out.length - 1];
      if (last) last.answer = last.answer === null ? e.text : `${last.answer}\n${e.text}`;
    }
  }
  return out;
}

export const CALL_DISCLAIMER =
  'Созвон проверяет, насколько глубоко ты понимаешь темы своей специализации сейчас. Он не доказывает подлинность истории из резюме и не меняет категорию - её даёт только тест. Грамотность, акцент и ошибки распознавания речи не оцениваются.';

function summaryOf(depthMap: CallVerdict['depthMap']): string {
  if (depthMap.length === 0) return 'Ответов для оценки не было.';
  const ok = depthMap.filter((d) => d.confirmed);
  const head = `Подтверждено тем: ${ok.length} из ${depthMap.length}.`;
  const list = ok.length ? ` Подтвердились: ${ok.map((d) => `«${d.topic}»`).join(', ')}.` : '';
  return head + list;
}

const qualifying: CallDriver = {
  kind: 'qualifying',
  limits: { minQuestions: CALL_LIMITS.minQuestions, maxQuestions: CALL_LIMITS.maxQuestions },

  async nextQuestion(session, llm, signal) {
    const ctx = await loadCallContext(session.candidateId);
    const turns = questionTurns(session.transcript);
    const q = await nextCallQuestion(
      { specialization: ctx.specialization, claimedGrade: ctx.claimedGrade, topics: ctx.topics, turns, limits: this.limits },
      llm,
      signal,
    );
    return { text: q.question, meta: q.meta, done: q.done };
  },

  async evaluate(session, llm, signal) {
    const ctx = await loadCallContext(session.candidateId);
    const turns = questionTurns(session.transcript).filter((t) => t.answer !== null);
    const byTopic = new Map<string, EvalTopic>();
    for (const t of turns) {
      const seed = ctx.topics.find((s) => s.topic === t.topic);
      const cur = byTopic.get(t.topic) ?? {
        topic: t.topic,
        catalogId: t.catalogId,
        claimed: Boolean(seed?.claimStatement),
        claimStatement: seed?.claimStatement ?? null,
        maxLevel: 1 as QuestionLevel,
        qa: [],
      };
      cur.qa.push({ question: t.question, answer: t.answer ?? '' });
      cur.maxLevel = Math.max(cur.maxLevel, t.level) as QuestionLevel;
      byTopic.set(t.topic, cur);
    }
    const ev = await evaluateCall(ctx.specialization, [...byTopic.values()], llm, { redact: ctx.resumeFacts, signal });
    return {
      kind: 'qualifying',
      depthMap: ev.depthMap,
      runs: ev.runs,
      validRuns: ev.validRuns,
      summary: summaryOf(ev.depthMap),
      thresholdVersion: ev.thresholdVersion,
      disclaimer: CALL_DISCLAIMER,
    };
  },

  // Подтверждённые темы с catalogId → утверждения кандидата до platform: тот же путь, что тест
  // (test/service.ts finalize) и защита: updateMany только по confirmed/edited ниже platform.
  async applyVerdict(tx, candidateId, verdict) {
    const ids = [...new Set(verdict.depthMap.filter((d) => d.confirmed && d.catalogId).map((d) => d.catalogId as string))];
    if (ids.length === 0) return [];
    const eligible = await tx.claim.findMany({
      where: { candidateId, catalogId: { in: ids }, status: { in: ['confirmed', 'edited'] }, level: { in: [...PLATFORM_UPGRADABLE] } },
      select: { catalogId: true },
    });
    if (eligible.length === 0) return [];
    await tx.claim.updateMany({
      where: { candidateId, catalogId: { in: ids }, status: { in: ['confirmed', 'edited'] }, level: { in: [...PLATFORM_UPGRADABLE] } },
      data: { level: 'platform' },
    });
    return [...new Set(eligible.map((e) => e.catalogId))].sort();
  },
};

const drivers = new Map<CallKind, CallDriver>([['qualifying', qualifying]]);

export function registerCallDriver(driver: CallDriver): void {
  drivers.set(driver.kind, driver);
}

export function callDriver(kind: CallKind): CallDriver {
  const d = drivers.get(kind);
  if (!d) throw new AppError('not_implemented', 'Этот вид созвона ещё не подключён', 501);
  return d;
}
