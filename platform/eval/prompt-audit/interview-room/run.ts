// Аудит промпта комнаты ИИнтервью (src/server/interview/prompts/interviewer.md) на модели созвонов стенда
// (LLM_CALL_*). Без БД: nextInterviewQuestion вызывается напрямую с планом из buildBlockPlan, ответы кандидата —
// сценарные реплики (инъекции, оффтоп, «не знаю», ошибки STT) и LLM-актёр по персоне. Перебивание моделируется
// как в service.interruptAi: вопрос обрезается до услышанных предложений, хвост — в interrupted.
//
// Запуск из platform/: npx tsx eval/prompt-audit/interview-room/run.ts [--only id1,id2] [--tag before]
// Результат: eval/results/prompt-audit-interview-room-<МСК>-<tag>.json
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

import { INTERRUPTED_MARK, UNHEARD_MARK, heardPrefix } from '../../../src/lib/sentences';
import { getEnv } from '../../../src/server/env';
import { buildBlockPlan } from '../../../src/server/interview/context';
import { nextInterviewQuestion } from '../../../src/server/interview/interviewer';
import { INTERVIEW_LIMITS, type InterviewTurn } from '../../../src/server/interview/plan';
import { createCallProvider } from '../../../src/server/llm/providers';
import type { LlmProvider } from '../../../src/server/llm/types';
import { checkQuestion, type Expect } from './checks';
import { type Scenario, SCENARIOS } from './scenarios';

const PERSONA_RULES =
  'Ты — кандидат на голосовом техническом интервью с ИИ-интервьюером. Отвечай устно, как живой человек: 1–5 предложений, без markdown и списков. Отвечай только своей репликой.';

async function personaAnswer(llm: LlmProvider, s: Scenario, history: { q: string; a: string | null }[]): Promise<string> {
  const msgs = history.flatMap((h, i) => [
    { role: 'user' as const, content: `Интервьюер: ${h.q}` },
    ...(h.a !== null && i < history.length - 1 ? [{ role: 'assistant' as const, content: h.a }] : []),
  ]);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await llm.complete({ purpose: 'smoke', system: `${PERSONA_RULES}\n\nТвоя легенда и манера: ${s.persona}`, messages: msgs, temperature: 0.7, maxTokens: 400 });
      const t = (res.text ?? '').replace(/\s+/g, ' ').trim();
      if (t) return t;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
  return 'Не знаю, что ответить.';
}

async function runScenario(llm: LlmProvider, s: Scenario) {
  const plan = buildBlockPlan(s.specialization, s.subcategoryId, s.hints);
  const turns: InterviewTurn[] = [];
  const log: unknown[] = [];
  let done = false;
  let firstQ = '';
  for (let k = 0; k < INTERVIEW_LIMITS.maxQuestions + 2 && !done; k++) {
    const t0 = Date.now();
    const r = await nextInterviewQuestion({ specialization: s.specialization, subcategoryId: s.subcategoryId, claimedGrade: s.grade, plan, testHints: s.hints, resumeFacts: s.resumeFacts, turns, limits: INTERVIEW_LIMITS }, llm);
    const ms = Date.now() - t0;
    const prevTurn = turns[turns.length - 1];
    const prevStep = s.script[k - 1];
    const expect: Expect | undefined = prevStep && 'expect' in prevStep ? prevStep.expect : undefined;
    const checks = checkQuestion({ question: r.question, index: k, done: r.done, block: r.meta.block ?? null, prev: turns, lastAnswer: prevTurn?.answer ?? null, resumeFacts: s.resumeFacts, expect, signal: r.meta.routedBy ?? null, interruptedTail: prevTurn?.interrupted?.tail ?? null });
    if (k === 0) firstQ = r.question;
    done = r.done;
    const entry: Record<string, unknown> = { k, ms, question: r.question, meta: r.meta, done: r.done, checks };
    if (!done) {
      const step = s.script[k];
      let question = r.question;
      let interrupted: InterviewTurn['interrupted'];
      if (step && 'interrupt' in step) {
        const hp = heardPrefix(r.question, step.interrupt);
        if (hp.tail) {
          const n = Math.min(step.interrupt, hp.total);
          question = n > 0 ? `${hp.heard} ${INTERRUPTED_MARK}` : UNHEARD_MARK;
          interrupted = { heardSentences: n, tail: hp.tail };
        }
      }
      const history = [...turns.map((t) => ({ q: t.question, a: t.answer })), { q: question, a: null }];
      const answer = step && 'say' in step && step.say ? step.say : await personaAnswer(llm, s, history);
      turns.push({ question, answer, competencyId: r.meta.competencyId!, block: r.meta.block!, level: r.meta.level, ...(interrupted ? { interrupted } : {}) });
      entry.heardQuestion = question === r.question ? undefined : question;
      entry.answer = answer;
    }
    log.push(entry);
    console.log(`[${s.id}] #${k + 1} ${r.meta.block}/${r.meta.competencyId} L${r.meta.level} sig=${r.meta.routedBy} fb=${r.meta.fallback ? 1 : 0} ${ms}ms flags=${(checks.flags as string[]).join(',')}`);
  }
  return { id: s.id, title: s.title, grade: s.grade, specialization: s.specialization, questions: log.length, blocks: [...new Set(turns.map((t) => t.block))], done, firstQ, log };
}

async function main() {
  const env = getEnv();
  const llm = createCallProvider(env);
  if (!llm) throw new Error('LLM_CALL_* не заданы');
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]!.split(',') : null;
  const tag = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1]! : 'run';
  const list = SCENARIOS.filter((s) => !only || only.includes(s.id));
  const results: Awaited<ReturnType<typeof runScenario>>[] = [];
  // Не больше двух сценариев одновременно (≤2 параллельных запроса к модели).
  const queue = [...list];
  await Promise.all([0, 1].map(async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        results.push(await runScenario(llm, s));
      } catch (e) {
        console.error(`[${s.id}] упал:`, e instanceof Error ? e.message : e);
        results.push({ id: s.id, title: s.title, grade: s.grade, specialization: s.specialization, questions: 0, blocks: [], done: false, firstQ: '', log: [{ error: String(e) }] });
      }
    }
  }));
  const all = results.flatMap((r) => r.log as { checks?: { flags: string[] }; meta?: { fallback?: boolean } }[]).filter((e) => e.checks);
  const flagCounts: Record<string, number> = {};
  for (const e of all) for (const f of e.checks!.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
  const summary = {
    scenarios: results.length,
    questions: all.length,
    fallback: all.filter((e) => e.meta?.fallback).length,
    finished: results.filter((r) => r.done).length,
    allBlocks: results.filter((r) => ['intro', 'test', 'systems', 'team'].every((b) => r.blocks.includes(b as never))).length,
    flagCounts,
    questionsWithFlags: all.filter((e) => e.checks!.flags.length > 0).length,
  };
  console.log(JSON.stringify(summary, null, 2));
  const msk = new Date(Date.now() + 3 * 3600_000).toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  const dir = path.join(process.cwd(), 'eval/results');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `prompt-audit-interview-room-${msk}-${tag}.json`);
  writeFileSync(file, `${JSON.stringify({ model: env.LLM_CALL_MODEL, promptFile: 'src/server/interview/prompts/interviewer.md', tag, summary, results: results.sort((a, b) => a.id.localeCompare(b.id)) }, null, 2)}\n`);
  console.log('→', path.relative(process.cwd(), file));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
