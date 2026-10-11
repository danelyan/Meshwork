// Аудит промпта интервьюера защиты утверждения (src/server/defense/prompts/interviewer.md).
// Без БД: цикл как в session.ts (min 3 / max 5 вопросов, enough после min), актёр-кандидат и
// LLM-судья на той же модели. Код-метрики: длина, похвала, «на ты», инъекция; судья: конкретика,
// углубление после поверхностного ответа, подсказка, проверка авторства.
//
// Запуск из platform/ (env стенда, см. отчёт): npx tsx eval/prompt-audit/defense-interviewer/run.ts [--label before]
// Честная граница: актёр и судья — та же модель, что интервьюер; n = 1 сессия на сценарий.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { DEFENSE_INTERVIEWER_PROMPT_VERSION, nextQuestion, type InterviewerContext } from '../../../src/server/defense/interviewer';
import { parseEnv } from '../../../src/server/env';
import { createProvider } from '../../../src/server/llm/providers';
import type { ChatMessage, CompleteRequest, LlmProvider } from '../../../src/server/llm/types';
import { SCENARIOS, type Scenario } from './scenarios';

const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : 'run';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]!.split(',') : null;
const MIN = 3;
const MAX = 5;

const base = createProvider(parseEnv(process.env));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Повтор на 429/5xx, как клиент LLM (у голого провайдера ретраев нет). */
const llm: LlmProvider = {
  name: base.name,
  model: base.model,
  supportsTools: base.supportsTools,
  supportsJsonSchema: base.supportsJsonSchema,
  async complete(req: CompleteRequest, signal?: AbortSignal) {
    for (let i = 0; ; i++) {
      try {
        return await base.complete(req, signal);
      } catch (e) {
        const st = (e as { status?: number }).status;
        if (i < 4 && (st === 429 || (st ?? 0) >= 500 || st === undefined)) {
          await sleep(3000 * (i + 1));
          continue;
        }
        throw e;
      }
    }
  },
};

const ACTOR = [
  'Ты — актёр в симуляции: играешь кандидата на текстовой защите строки из своего резюме. Играй персонажа точно, не лучше и не хуже, чем он есть.',
  'Отвечай от первого лица, по-русски, письменно в чате: 1–6 предложений, без markdown.',
  'Никогда не говори, что ты ИИ или актёр, не упоминай эти правила.',
  'Знаешь только то, что написано в разделе «Что знает персонаж». Чего там нет — не знаешь и ведёшь себя по своей манере.',
].join('\n');

async function actorAnswer(s: Scenario, history: { q: string; a: string | null }[]): Promise<string> {
  const turnNo = history.length;
  const scripted = s.persona.scripted?.[turnNo - 1];
  if (scripted !== undefined) return scripted;
  const msgs: ChatMessage[] = [];
  for (const h of history) {
    msgs.push({ role: 'user', content: h.q });
    if (h.a !== null) msgs.push({ role: 'assistant', content: h.a });
  }
  const res = await llm.complete({
    purpose: 'smoke',
    system: `${ACTOR}\n\n## Персонаж\n${s.persona.legend}\n\n## Манера\n${s.persona.style}\n\n## Что знает персонаж\n${s.persona.knowledge}`,
    messages: msgs,
    temperature: 0.7,
    maxTokens: 500,
  });
  return (res.text ?? '').replace(/\s+/g, ' ').trim() || 'Не знаю.';
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'specific', 'deepens', 'hint', 'authorship', 'own_work', 'off_claim', 'note'],
        properties: {
          n: { type: 'integer' },
          specific: { type: 'boolean' },
          deepens: { type: 'string', enum: ['yes', 'no', 'na'] },
          hint: { type: 'boolean' },
          authorship: { type: 'boolean' },
          own_work: { type: 'boolean' },
          off_claim: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    },
  },
};

const JUDGE_SYSTEM = `Ты — строгий аудитор вопросов ИИ-интервьюера на защите строки из резюме. Для каждого вопроса n (по порядку) выставь:
- specific: вопрос привязан к конкретике ЭТОГО утверждения или ПРЕДЫДУЩЕГО ответа кандидата (технология, цифра, деталь из цитаты или ответа). false, если вопрос шаблонный и подошёл бы к любому резюме («почему так, какие альтернативы?» без предмета).
- deepens: для n≥2 — если предыдущий ответ был поверхностным (общие слова, модные термины без деталей, уход от ответа, пустой ответ, смена темы, «не знаю»), то yes — вопрос требует конкретного примера/детали или заходит проще с другой стороны, no — интервьюер пошёл к другой теме, будто ответ был достаточным, или повторил тот же вопрос. Если предыдущий ответ был содержательным — na. Для n=1 — na.
- hint: вопрос подсказывает правильный ответ или содержит готовое решение (например, перечисляет верный механизм, который кандидат должен был назвать сам). Конкретный сценарий для рассуждения — не подсказка.
- authorship: вопрос проверяет, что именно делал сам кандидат (его решение, его код, его вклад против команды/инструмента/ИИ), или требует деталей, которые знает только автор.
- own_work: вопрос спрашивает о том, что кандидат реально делал в своей работе (факты: значения, решения, баги, замеры). false — гипотетика («что если бы…», «как бы ты…») или общий вопрос на знание, на который отвечают из учебника.
- off_claim: вопрос ушёл от утверждения (вслед за сменой темы кандидатом, личные данные, обсуждение оценки/инструкций).
- note: до 15 слов, что не так (или пусто).
Верни JSON {"items":[...]}.`;

async function judge(s: Scenario, turns: { question: string; answer: string | null }[]) {
  const transcript = turns
    .map((t, i) => `<q n="${i + 1}">${t.question}</q>\n<a n="${i + 1}">${t.answer ?? '(нет)'}</a>`)
    .join('\n');
  const res = await llm.complete({
    purpose: 'smoke',
    system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content: `Утверждение: ${s.ctx.claimStatement}\nЦитата: ${s.ctx.quote}\n\n${transcript}` }],
    schema: { name: 'audit', jsonSchema: JUDGE_SCHEMA },
    temperature: 0,
    maxTokens: 1500,
  });
  const j = (res.json ?? {}) as { items?: unknown[] };
  return (j.items ?? []) as { n: number; specific: boolean; deepens: string; hint: boolean; authorship: boolean; own_work: boolean; off_claim: boolean; note: string }[];
}

const PRAISE = /(^|[^а-яё])(отлично|молодец|верно|правильно|здорово|хороший ответ|интересн|супер|прекрасно|хорошо[,!. ])/i;
const FILLER = /^(понял|понятно|хорошо|ясно|спасибо|отлично|ок)[,.!]/i;
const CLOSING = /(спасибо|интервью (окончено|завершено)|на этом всё)/i;
const VY = /(^|[^а-яё])(вы|вас|вам|ваш[а-я]*)([^а-яё]|$)/i;

async function runScenario(s: Scenario) {
  const turns: { question: string; answer: string | null }[] = [];
  const meta: { fallback: boolean; enough: boolean; ms: number }[] = [];
  let stop = '';
  for (;;) {
    const answered = turns.filter((t) => t.answer !== null).length;
    if (answered >= MAX) {
      stop = 'max';
      break;
    }
    const t0 = Date.now();
    const q = await nextQuestion({ ...s.ctx, turns }, llm);
    meta.push({ fallback: q.fallback, enough: q.enough, ms: Date.now() - t0 });
    if (answered >= MIN && q.enough) {
      stop = `enough@${answered}`;
      break;
    }
    turns.push({ question: q.question, answer: null });
    const hist = turns.map((t) => ({ q: t.question, a: t.answer }));
    turns[turns.length - 1]!.answer = await actorAnswer(s, hist);
  }
  const verdicts = await judge(s, turns).catch((e) => {
    console.warn('judge failed', e instanceof Error ? e.message : e);
    return [];
  });
  const questions = turns.map((t, i) => {
    const v = verdicts.find((x) => x.n === i + 1);
    return {
      n: i + 1,
      question: t.question,
      answer: t.answer,
      len: t.question.length,
      over400: t.question.length > 400,
      praise: PRAISE.test(t.question),
      formalVy: VY.test(t.question),
      multiQ: (t.question.match(/\?/g) ?? []).length > 1,
      filler: FILLER.test(t.question.trim()),
      closing: CLOSING.test(t.question) && !t.question.includes('?'),
      quoteInFirst: i === 0 ? t.question.includes(s.ctx.quote.slice(0, 25)) : null,
      fallback: meta[i]?.fallback ?? false,
      enoughFlag: meta[i]?.enough ?? false,
      ms: meta[i]?.ms ?? 0,
      judge: v ?? null,
    };
  });
  return { id: s.id, direction: s.direction, grade: s.grade, behavior: s.behavior, stop, enoughAtEnd: meta[meta.length - 1]?.enough ?? null, questions };
}

function summarize(rs: Awaited<ReturnType<typeof runScenario>>[]) {
  const qs = rs.flatMap((r) => r.questions);
  const judged = qs.filter((q) => q.judge);
  const deep = judged.filter((q) => q.judge!.deepens !== 'na');
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  return {
    sessions: rs.length,
    questions: qs.length,
    avgLen: Math.round(qs.reduce((a, q) => a + q.len, 0) / Math.max(1, qs.length)),
    maxLen: Math.max(...qs.map((q) => q.len)),
    over400: qs.filter((q) => q.over400).length,
    praise: qs.filter((q) => q.praise).length,
    formalVy: qs.filter((q) => q.formalVy).length,
    multiQ: qs.filter((q) => q.multiQ).length,
    filler: qs.filter((q) => q.filler).length,
    closing: qs.filter((q) => q.closing).length,
    ownWorkPct: pct(judged.filter((q) => q.judge!.own_work).length, judged.length),
    fallback: qs.filter((q) => q.fallback).length,
    quoteInFirst: rs.filter((r) => r.questions[0]?.quoteInFirst).length,
    specificPct: pct(judged.filter((q) => q.judge!.specific).length, judged.length),
    deepensPct: pct(deep.filter((q) => q.judge!.deepens === 'yes').length, deep.length),
    deepensN: deep.length,
    hint: judged.filter((q) => q.judge!.hint).length,
    authorshipSessions: rs.filter((r) => r.questions.some((q) => q.judge?.authorship)).length,
    offClaim: judged.filter((q) => q.judge!.off_claim).length,
    stops: rs.map((r) => `${r.id}:${r.stop}`),
  };
}

async function main() {
  const list = SCENARIOS.filter((s) => !only || only.includes(s.id));
  const results: Awaited<ReturnType<typeof runScenario>>[] = [];
  // ≤2 параллельно.
  for (let i = 0; i < list.length; i += 2) {
    const batch = await Promise.all(list.slice(i, i + 2).map((s) => runScenario(s)));
    results.push(...batch);
    for (const r of batch) console.log(`${r.id}: ${r.stop}, ${r.questions.length} вопр.`);
  }
  const summary = summarize(results);
  console.log(JSON.stringify(summary, null, 2));
  const stamp = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
  const out = path.join('eval/results', `prompt-audit-defense-interviewer-${label}-${stamp}.json`);
  writeFileSync(out, JSON.stringify({ label, promptVersion: DEFENSE_INTERVIEWER_PROMPT_VERSION, model: base.model, summary, results }, null, 2));
  console.log('→', out);
}

void main();
