// Драйвер вида созвона `interview` (ИИнтервью): вопросы по блокам модели компетенций, оценка — тот же слепой
// оценщик A-02 ×3 (call/evaluator.ts), компетенция = «тема» карты глубины; сверху — оси, соответствие грейду,
// итог (verdict.ts). Подтверждённые компетенции поднимают их утверждения до platform тем же путём, что созвон.
import type { ClaimStatus, Prisma } from '@prisma/client';

import { PLATFORM_UPGRADABLE } from '../claims/levels';
import { type CallDriver, type DriverSession, registerCallDriver } from '../call/drivers';
import { type EvalTopic, evaluateCall, notProbedItem } from '../call/evaluator';
import type { QuestionLevel, TranscriptEntry } from '../call/types';
import { type InterviewContext, loadInterviewContext } from './context';
import { nextInterviewQuestion } from './interviewer';
import { type BlockId, type CompetencyDef, competencyById } from './model';
import { INTERVIEW_CLOSING_LINE, INTERVIEW_LIMITS, type InterviewTurn } from './plan';
import { INTERVIEW_DISCLAIMER, buildInterviewSummary, interviewSummaryText } from './verdict';

/** Пары вопрос ИИ → ответ кандидата с компетенцией и блоком из meta (реплики без competencyId пропускаются). */
export function interviewTurns(transcript: readonly TranscriptEntry[]): (InterviewTurn & { aiIndex: number })[] {
  const out: (InterviewTurn & { aiIndex: number })[] = [];
  for (const e of transcript) {
    if (e.role === 'ai' && e.meta?.competencyId && e.meta.block) {
      out.push({ question: e.text, answer: null, competencyId: e.meta.competencyId, block: e.meta.block, level: e.meta.level, aiIndex: e.index, ...(e.meta.probe ? { probe: true } : {}) });
    } else if (e.role === 'candidate') {
      const last = out[out.length - 1];
      if (last) last.answer = last.answer === null ? e.text : `${last.answer}\n${e.text}`;
    }
  }
  return out;
}

function competencyByTitle(ctx: InterviewContext, title: string): CompetencyDef | null {
  for (const list of Object.values(ctx.plan)) {
    const hit = list.find((c) => c.title === title);
    if (hit) return hit;
  }
  return null;
}

export const interviewDriver: CallDriver = {
  kind: 'interview',
  limits: { minQuestions: INTERVIEW_LIMITS.minQuestions, maxQuestions: INTERVIEW_LIMITS.maxQuestions, hardMaxQuestions: INTERVIEW_LIMITS.hardMaxQuestions },
  closingLine: INTERVIEW_CLOSING_LINE,
  disclaimer: INTERVIEW_DISCLAIMER,

  async nextQuestion(session: DriverSession, llm, opts = {}) {
    const ctx = await loadInterviewContext(session.candidateId);
    const turns = interviewTurns(session.transcript);
    let force: { competency: CompetencyDef; block: BlockId; level: QuestionLevel } | undefined;
    if (opts.force) {
      const c = competencyByTitle(ctx, opts.force.topic);
      const block = [...turns].reverse().find((t) => c && t.competencyId === c.id)?.block ?? 'test';
      if (c) force = { competency: c, block, level: opts.force.level };
    }
    const q = await nextInterviewQuestion(
      {
        specialization: ctx.specialization,
        subcategoryId: ctx.subcategoryId,
        claimedGrade: ctx.claimedGrade,
        plan: ctx.plan,
        testHints: ctx.testHints,
        resumeFacts: ctx.resumeFacts,
        turns,
        limits: this.limits,
        ...(force ? { force } : {}),
      },
      llm,
      opts.signal,
    );
    return { text: q.question, meta: q.meta, done: q.done };
  },

  async evaluate(session, llm, opts = {}) {
    const ctx = await loadInterviewContext(session.candidateId);
    const turns = interviewTurns(session.transcript).filter((t) => t.answer !== null);
    const byComp = new Map<string, EvalTopic & { extraProbe: boolean; def: CompetencyDef }>();
    for (const t of turns) {
      const def = competencyById(t.competencyId);
      if (!def) continue;
      const cur = byComp.get(def.id) ?? {
        topic: def.title,
        catalogId: null,
        claimed: def.catalogIds.some((id) => ctx.claimedCatalogIds.has(id)),
        claimStatement: null,
        maxLevel: 1 as QuestionLevel,
        qa: [],
        extraProbe: false,
        def,
      };
      cur.qa.push({ question: t.question, answer: t.answer ?? '', level: t.level });
      cur.maxLevel = Math.max(cur.maxLevel, t.level) as QuestionLevel;
      if (t.probe) cur.extraProbe = true;
      byComp.set(def.id, cur);
    }
    const interim = opts.interim?.interim ? opts.interim : null;
    const toEval = interim ? [...byComp.values()].filter((t) => t.extraProbe) : [...byComp.values()];
    const ev = toEval.length
      ? await evaluateCall(ctx.specialization, toEval.map((t) => ({ topic: t.topic, catalogId: t.catalogId, claimed: t.claimed, claimStatement: t.claimStatement, maxLevel: t.maxLevel, qa: t.qa })), llm, { redact: ctx.resumeFacts, signal: opts.signal })
      : { depthMap: [], runs: 0, validRuns: 0, thresholdVersion: interim?.thresholdVersion ?? '' };
    const fresh = new Map(ev.depthMap.map((d) => [d.topic, { ...d, ...([...byComp.values()].find((t) => t.topic === d.topic)?.extraProbe ? { extraProbe: true } : {}) }]));
    const evaluated = interim ? interim.depthMap.filter((d) => d.status !== 'not_probed').map((d) => fresh.get(d.topic) ?? d) : [...fresh.values()];
    for (const d of fresh.values()) if (!evaluated.some((x) => x.topic === d.topic)) evaluated.push(d);
    const asked = new Set(evaluated.map((d) => d.topic));
    // «Не проверено» — технические и системные компетенции направления, до которых интервью не дошло.
    const rest = [...ctx.plan.test, ...ctx.plan.systems].filter((c) => !asked.has(c.title)).map((c) => notProbedItem({ topic: c.title, catalogId: null, claimStatement: null }));
    const depthMap = [...evaluated, ...rest];
    const blocks = [...new Set(turns.map((t) => t.block))];
    const summary = buildInterviewSummary({ depthMap, competencyOf: (title) => competencyByTitle(ctx, title), claimedGrade: ctx.claimedGrade, blocks });
    return {
      kind: 'interview',
      depthMap,
      runs: (interim?.runs ?? 0) + ev.runs,
      validRuns: (interim?.validRuns ?? 0) + ev.validRuns,
      summary: interviewSummaryText(summary),
      thresholdVersion: ev.thresholdVersion || interim?.thresholdVersion || '',
      disclaimer: INTERVIEW_DISCLAIMER,
      interview: summary,
    };
  },

  // Подтверждённые компетенции → их утверждения кандидата до platform (тот же путь, что созвон и тест).
  async applyVerdict(tx: Prisma.TransactionClient, candidateId: string, verdict) {
    const ids = [
      ...new Set(
        verdict.depthMap
          .filter((d) => d.status === 'confirmed' && d.confirmed)
          .flatMap((d) => verdict.interview?.competencies.find((c) => c.title === d.topic)?.id ?? [])
          .flatMap((id) => competencyById(id)?.catalogIds ?? []),
      ),
    ];
    if (ids.length === 0) return [];
    const where = { candidateId, catalogId: { in: ids }, status: { in: ['confirmed', 'edited'] as ClaimStatus[] }, level: { in: [...PLATFORM_UPGRADABLE] } };
    const eligible = await tx.claim.findMany({ where, select: { catalogId: true } });
    if (eligible.length === 0) return [];
    await tx.claim.updateMany({ where, data: { level: 'platform' } });
    return [...new Set(eligible.map((e) => e.catalogId))].sort();
  },
};

registerCallDriver(interviewDriver);
