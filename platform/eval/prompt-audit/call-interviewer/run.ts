// Живой аудит интервьюера созвона на модели созвона (LLM_CALL_*), без БД: nextCallQuestion в потоковом режиме,
// замер «старт → первое предложение / конец генерации», порядок полей в сыром JSON и проверки правил промпта.
// Запуск из platform/:  set -a; source .env; set +a; npx tsx eval/prompt-audit/call-interviewer/run.ts --tag before [--reps 2] [--only id1,id2]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getEnv } from '../../../src/server/env';
import { createCallProvider } from '../../../src/server/llm/providers';
import type { LlmProvider } from '../../../src/server/llm/types';
import { nextCallQuestion, type InterviewerInput } from '../../../src/server/call/interviewer';
import { CALL_LIMITS, REFUSED_RE, REFUSAL_LINE } from '../../../src/server/call/plan';
import { PROFILES, SCENARIOS, type Scenario } from './scenarios';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const tag = arg('tag') ?? 'run';
const reps = Number(arg('reps') ?? 2);
const only = arg('only')?.split(',');

const base = createCallProvider(getEnv());
if (!base) throw new Error('LLM_CALL_* не задан');

interface Probe {
  raw: string;
  tFirstDelta: number | null;
  tEnd: number | null;
  chunks: [number, number][];
  netRetries: number;
  restart?: () => void;
}

function instrumented(p: LlmProvider, probe: Probe, t0: () => number): LlmProvider {
  return {
    ...p,
    async complete(req, signal) {
      const orig = req.onJsonDelta;
      // Квота Yandex общая на все лейны (10 одновременных сессий): 429/504 — пауза и повтор, не шаблон.
      for (let i = 0; ; i++) {
        try {
          return await once();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (i >= 6 || !/429|ResourceExhausted|504|Gateway/i.test(msg)) throw e;
          probe.netRetries++;
          await new Promise((r) => setTimeout(r, 3000 + Math.random() * 4000));
          probe.restart?.();
        }
      }
      async function once() {
      const res = await p.complete(
        {
          ...req,
          onJsonDelta: (c: string) => {
            if (probe.tFirstDelta === null) probe.tFirstDelta = t0();
            probe.raw += c; probe.chunks.push([t0(), c.length]);
            orig?.(c);
          },
        },
        signal,
      );
      if (!probe.raw && res.kind === 'json') probe.raw = JSON.stringify(res.json);
      probe.tEnd = t0();
      return res;
      }
    },
  };
}

const PRAISE_RE = /(отличн|\bверно\b|правильн|молодец|здорово|прекрасн|супер|хороший ответ|ты прав|точно подмечен|классн|интересн\w* (ответ|подход)|хорошо объясн|сильн\w* ответ)/i;
const GREET_RE = /(привет|здравствуй|добр\w+ (день|утро|вечер))/i;
const INTRO_RE = /(меня зовут|я\s*[—-]?\s*кира|это кира)/i;
const LAST_RE = /(последн\w+ вопрос|напоследок|вопросы закончил|заканчиваем)/i;
// Род кандидата не угадываем: «ты выбирал», «ты упомянул» — мужской род прошедшего времени.
const GENDER_RE = /(?<![а-яё])ты\s+(?:сам\s+|уже\s+|когда-нибудь\s+|раньше\s+|обычно\s+)?[а-яё]+(?:л|лся)(?![а-яё])|(?<![а-яё])[а-яё]+(?:л|лся)\s+ли\s+ты(?![а-яё])/i;
const MD_RE = /(\*\*|`|^\s*[-•]\s|#)/m;

function firstSentence(q: string): string {
  const m = /^.*?[.!?…](\s|$)/.exec(q.trim());
  return (m ? m[0] : q).trim();
}

async function runOne(s: Scenario, rep: number) {
  const prof = PROFILES.find((p) => p.id === s.profile)!;
  const input: InterviewerInput = {
    specialization: prof.specialization,
    claimedGrade: prof.grade,
    topics: prof.topics,
    turns: s.turns,
    limits: { minQuestions: CALL_LIMITS.minQuestions, maxQuestions: CALL_LIMITS.maxQuestions },
  };
  const probe: Probe = { raw: '', tFirstDelta: null, tEnd: null, chunks: [], netRetries: 0 };
  let start = performance.now();
  const t0 = () => Math.round(performance.now() - start);
  // Сетевой повтор не считается в задержку хода: отсчёт заново (поток к этому моменту ничего не озвучил).
  probe.restart = () => {
    start = performance.now();
    probe.tFirstDelta = null;
  };
  let tFirstSentence: number | null = null;
  const sentences: string[] = [];
  const llm = instrumented(base!, probe, t0);
  let out;
  let error: string | null = null;
  try {
    out = await nextCallQuestion(input, llm, undefined, {
      onSentence: (text, n) => {
        if (n === 0) tFirstSentence = t0();
        sentences.push(text);
      },
      closable: Boolean(s.closable),
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const total = t0();
  const raw = probe.raw;
  let rawJson: Record<string, unknown> | null = null;
  const attempts = raw ? raw.split('}{').length : 0;
  try {
    rawJson = JSON.parse(attempts > 1 ? `{${raw.split('}{').pop()}` : raw);
  } catch {
    /* сырой поток мог не дойти */
  }
  const iDone = raw.indexOf('"done"');
  const iQ = raw.indexOf('"question"');
  const q = out?.question ?? '';
  const qNoRefusal = q.replace(REFUSAL_LINE, '').trim();
  const last = s.turns[s.turns.length - 1];
  const signal = (rawJson?.answerSignal as string | undefined) ?? null;
  const checks: Record<string, boolean | null> = {
    llmOk: !out?.meta.fallback && !error,
    length300: q.length <= 300,
    oneQuestion: (q.match(/\?/g) ?? []).length <= 2,
    noMarkdown: !MD_RE.test(q),
    noPraise: !PRAISE_RE.test(qNoRefusal),
    noLastMention: !LAST_RE.test(q),
    noGender: !GENDER_RE.test(q),
    greeting: s.expect.greeting ? GREET_RE.test(firstSentence(q)) : !GREET_RE.test(q) && !INTRO_RE.test(q),
    topic: s.expect.topic === 'any' || !last ? null : s.expect.topic === 'same' ? out?.meta.topic === last.topic : out?.meta.topic !== last.topic,
    signal: s.expect.signal && s.turns.length ? (signal ? s.expect.signal.includes(signal as never) : false) : null,
    done: s.expect.done === undefined ? null : out?.done === s.expect.done || (s.expect.done === true && (rawJson?.done as boolean | undefined) === true),
    refusal: s.expect.refusal ? REFUSED_RE.test(q) : null,
  };
  const failed = Object.entries(checks).filter(([, v]) => v === false).map(([k]) => k);
  return {
    id: s.id, rep, profile: s.profile, style: s.style,
    question: q, firstSentence: firstSentence(q), firstSentenceChars: firstSentence(q).length,
    meta: out?.meta ?? null, done: out?.done ?? null, rawDone: rawJson?.done ?? null, signal,
    doneBeforeQuestion: iDone >= 0 && iQ >= 0 ? iDone < iQ : null,
    ms: { firstDelta: probe.tFirstDelta, firstSentence: tFirstSentence, end: probe.tEnd, total },
    streamedSentences: sentences.length, firstChunk: sentences[0] ?? null, attempts, netRetries: probe.netRetries, raw, chunks: probe.chunks.length,
    checks, failed, error,
  };
}

async function main() {
  const list = SCENARIOS.filter((s) => !only || only.includes(s.id));
  const jobs: { s: Scenario; rep: number }[] = [];
  for (let r = 0; r < reps; r++) for (const s of list) jobs.push({ s, rep: r });
  const results: Awaited<ReturnType<typeof runOne>>[] = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const j = jobs[next++]!;
      let r = await runOne(j.s, j.rep);
      if (r.error && /429|rate/i.test(r.error)) {
        await new Promise((res) => setTimeout(res, 5000));
        r = await runOne(j.s, j.rep);
      }
      results.push(r);
      console.log(`${r.id}#${r.rep} ${r.failed.length ? 'FAIL ' + r.failed.join(',') : 'ok'} | ${r.ms.firstSentence ?? '—'}/${r.ms.total} мс | ${r.question}`);
    }
  }
  await Promise.all([worker(), worker()]);
  results.sort((a, b) => a.id.localeCompare(b.id) || a.rep - b.rep);
  const n = results.length;
  const pct = (k: number) => Math.round((k / n) * 1000) / 10;
  const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : null);
  const p90 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)]! : null);
  const checkNames = Object.keys(results[0]!.checks);
  const perCheck = Object.fromEntries(
    checkNames.map((c) => {
      const applicable = results.filter((r) => r.checks[c] !== null);
      return [c, { pass: applicable.filter((r) => r.checks[c]).length, of: applicable.length }];
    }),
  );
  const fs = results.map((r) => r.ms.firstSentence).filter((x): x is number => x !== null);
  const gap = results.filter((r) => r.ms.firstSentence !== null && r.ms.end !== null).map((r) => r.ms.end! - r.ms.firstSentence!);
  const summary = {
    tag, model: base!.model, at: new Date().toISOString(), runs: n,
    allChecksPass: pct(results.filter((r) => !r.failed.length).length),
    perCheck,
    streamedShare: pct(results.filter((r) => r.ms.firstSentence !== null).length),
    firstSentenceMs: { p50: med(fs), p90: p90(fs) },
    totalMs: { p50: med(results.map((r) => r.ms.total)), p90: p90(results.map((r) => r.ms.total)) },
    savedBeforeEndMs: { p50: med(gap) },
    doneBeforeQuestion: results.filter((r) => r.doneBeforeQuestion).length,
    firstSentenceChars: { p50: med(results.map((r) => r.firstSentenceChars)) },
    fallbacks: results.filter((r) => r.meta?.fallback).length,
    retries: results.filter((r) => r.attempts > 1).length,
    firstChunkChars: { p50: med(results.map((r) => r.firstChunk?.length ?? r.question.length)) },
  };
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' }).replace(/[: ]/g, '-').slice(0, 16);
  const file = join(process.cwd(), 'eval/results', `prompt-audit-call-interviewer-${tag}-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ summary, results }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  console.log(file);
}

void main();
