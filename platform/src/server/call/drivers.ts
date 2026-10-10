// Драйверы видов созвона: что спрашивает ИИ и как оценивается результат. Общее (транскрипт, SSE,
// запись, доступ, согласие) — в service.ts. Ступень 1 — qualifying (здесь); defense-room регистрирует
// свой драйвер `registerCallDriver('defense', …)` — вопросы QLC по коду и очередь вопросов работодателя.
import type { Prisma } from '@prisma/client';

import { PLATFORM_UPGRADABLE } from '../claims/levels';
import { AppError } from '../errors';
import type { LlmProvider } from '../llm/types';
import { loadCallContext } from './context';
import { type EvalTopic, evaluateCall, notProbedItem } from './evaluator';
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
  /** hardMaxQuestions — потолок с дополнительными вопросами по неопределённым темам (без него их нет). */
  limits: { minQuestions: number; maxQuestions: number; hardMaxQuestions?: number };
  /** Закрывающая реплика ИИ, когда вопросы закончились (по умолчанию CLOSING_LINE созвона). */
  closingLine?: string;
  /** Дисклеймер вида созвона в CallView (по умолчанию CALL_DISCLAIMER). */
  disclaimer?: string;
  /** Проверка перед стартом (например, сабмит проекта принадлежит кандидату). */
  assertCanStart?(candidateId: string, projectSubmissionId: string | null): Promise<void>;
  nextQuestion(session: DriverSession, llm: LlmProvider, opts?: { signal?: AbortSignal; force?: { topic: string; level: QuestionLevel } }): Promise<DriverQuestion>;
  /** interim — промежуточная оценка этого же созвона: досчитываются только темы с дополнительными вопросами. */
  evaluate(session: DriverSession, llm: LlmProvider, opts?: { signal?: AbortSignal; interim?: CallVerdict | null }): Promise<Omit<CallVerdict, 'upgradedCatalogIds' | 'evaluatedAt'>>;
  /** Последствия вердикта в той же транзакции, что и завершение (уровни утверждений). Возвращает поднятые catalogId. */
  applyVerdict?(tx: Prisma.TransactionClient, candidateId: string, verdict: Omit<CallVerdict, 'upgradedCatalogIds' | 'evaluatedAt'>): Promise<string[]>;
}

/** Пары вопрос ИИ (с meta) → ответ кандидата, по порядку. Реплики работодателя не входят. */
export function questionTurns(transcript: readonly TranscriptEntry[]): (PlanTurn & { aiIndex: number; probe?: 'inconclusive' })[] {
  const out: (PlanTurn & { aiIndex: number; probe?: 'inconclusive' })[] = [];
  for (const e of transcript) {
    if (e.role === 'ai' && e.meta) {
      out.push({ question: e.text, answer: null, topic: e.meta.topic, catalogId: e.meta.catalogId, level: e.meta.level, aiIndex: e.index, ...(e.meta.probe ? { probe: e.meta.probe } : {}) });
    } else if (e.role === 'candidate') {
      const last = out[out.length - 1];
      if (last) last.answer = last.answer === null ? e.text : `${last.answer}\n${e.text}`;
    }
  }
  return out;
}

export const CALL_DISCLAIMER =
  'Созвон проверяет, насколько глубоко ты понимаешь темы своей специализации сейчас. Он не доказывает подлинность истории из резюме и не меняет категорию - её даёт только тест. Грамотность, акцент и ошибки распознавания речи не оцениваются.';

export function summaryOf(depthMap: CallVerdict['depthMap']): string {
  const probed = depthMap.filter((d) => d.status !== 'not_probed');
  if (probed.length === 0) return 'Ответов для оценки не было.';
  const ok = probed.filter((d) => d.status === 'confirmed');
  const unsure = probed.filter((d) => d.status === 'inconclusive');
  const skipped = depthMap.length - probed.length;
  const head = `Подтверждено тем: ${ok.length} из ${probed.length} проверенных.`;
  const list = ok.length ? ` Подтвердились: ${ok.map((d) => `«${d.topic}»`).join(', ')}.` : '';
  const tail = [
    unsure.length ? ` Не определено (оценщик разошёлся и после дополнительного вопроса): ${unsure.map((d) => `«${d.topic}»`).join(', ')}.` : '',
    skipped ? ` Не проверено в этом созвоне: ${skipped}.` : '',
  ].join('');
  return head + list + tail;
}

const qualifying: CallDriver = {
  kind: 'qualifying',
  limits: { minQuestions: CALL_LIMITS.minQuestions, maxQuestions: CALL_LIMITS.maxQuestions, hardMaxQuestions: CALL_LIMITS.hardMaxQuestions },

  async nextQuestion(session, llm, opts = {}) {
    const ctx = await loadCallContext(session.candidateId);
    const turns = questionTurns(session.transcript);
    const q = await nextCallQuestion(
      { specialization: ctx.specialization, claimedGrade: ctx.claimedGrade, topics: ctx.topics, turns, limits: this.limits, ...(opts.force ? { force: opts.force } : {}) },
      llm,
      opts.signal,
    );
    return { text: q.question, meta: q.meta, done: q.done };
  },

  async evaluate(session, llm, opts = {}) {
    const ctx = await loadCallContext(session.candidateId);
    const turns = questionTurns(session.transcript).filter((t) => t.answer !== null);
    const byTopic = new Map<string, EvalTopic & { extraProbe: boolean }>();
    for (const t of turns) {
      const seed = ctx.topics.find((s) => s.topic === t.topic);
      const cur = byTopic.get(t.topic) ?? {
        topic: t.topic,
        catalogId: t.catalogId,
        claimed: Boolean(seed?.claimStatement),
        claimStatement: seed?.claimStatement ?? null,
        maxLevel: 1 as QuestionLevel,
        qa: [],
        extraProbe: false,
      };
      cur.qa.push({ question: t.question, answer: t.answer ?? '', level: t.level });
      cur.maxLevel = Math.max(cur.maxLevel, t.level) as QuestionLevel;
      if (t.probe) cur.extraProbe = true;
      byTopic.set(t.topic, cur);
    }
    const redact = [...ctx.resumeFacts, ...ctx.topics.flatMap((t) => (t.claimStatement ? [t.claimStatement] : []))];
    const interim = opts.interim?.interim ? opts.interim : null;
    // После дополнительных вопросов досчитываются только эти темы; решения по остальным — из промежуточной оценки.
    const toEval = interim ? [...byTopic.values()].filter((t) => t.extraProbe) : [...byTopic.values()];
    const ev = toEval.length
      ? await evaluateCall(ctx.specialization, toEval, llm, { redact, signal: opts.signal })
      : { depthMap: [], runs: 0, validRuns: 0, thresholdVersion: interim?.thresholdVersion ?? '' };
    const fresh = new Map(ev.depthMap.map((d) => [d.topic, { ...d, ...(byTopic.get(d.topic)?.extraProbe ? { extraProbe: true } : {}) }]));
    const evaluated = interim
      ? interim.depthMap.filter((d) => d.status !== 'not_probed').map((d) => fresh.get(d.topic) ?? d)
      : [...fresh.values()];
    for (const d of fresh.values()) if (!evaluated.some((x) => x.topic === d.topic)) evaluated.push(d);
    const asked = new Set(evaluated.map((d) => d.topic));
    const depthMap = [...evaluated, ...ctx.topics.filter((t) => !asked.has(t.topic)).map(notProbedItem)];
    return {
      kind: 'qualifying',
      depthMap,
      runs: (interim?.runs ?? 0) + ev.runs,
      validRuns: (interim?.validRuns ?? 0) + ev.validRuns,
      summary: summaryOf(depthMap),
      thresholdVersion: ev.thresholdVersion || interim?.thresholdVersion || '',
      disclaimer: CALL_DISCLAIMER,
    };
  },

  // Подтверждённые темы с catalogId → утверждения кандидата до platform: тот же путь, что тест
  // (test/service.ts finalize) и защита: updateMany только по confirmed/edited ниже platform.
  async applyVerdict(tx, candidateId, verdict) {
    // Только status=confirmed: «не определено» и «не проверено» уровень не поднимают.
    const ids = [...new Set(verdict.depthMap.filter((d) => d.status === 'confirmed' && d.confirmed && d.catalogId).map((d) => d.catalogId as string))];
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
