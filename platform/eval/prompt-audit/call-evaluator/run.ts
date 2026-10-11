// Аудит слепого оценщика созвона (src/server/call/prompts/evaluator.md) на размеченных транскриптах cases.ts.
// Путь как в проде: evaluateCall → 3 прогона → проверка цитат кодом → медиана → decideStatus. Без БД.
// Модель — LLM_CALL_* из .env (та же, что у созвона на стенде). Одновременно ≤ 2 запроса, ретраи на 429/5xx.
//
// Запуск из platform/:
//   npx tsx eval/prompt-audit/call-evaluator/run.ts --label before [--prompt путь/к/evaluator.md] [--only id1,id2]
// --prompt подменяет системный промпт (вариант до правки в репозитории); без него — файл из репозитория.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

import { CRITERIA, type Criterion } from '../../../src/server/defense/types';
import { decidePassed } from '../../../src/server/defense/evaluator';
import { evaluateCall, type EvalTopic } from '../../../src/server/call/evaluator';
import { parseEnv } from '../../../src/server/env';
import { createCallProvider } from '../../../src/server/llm/providers';
import type { CompleteRequest, CompleteResult, LlmProvider } from '../../../src/server/llm/types';
import { CASES, type Case, type Gold } from './cases';

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const label = arg('--label') ?? 'run';
const only = arg('--only')?.split(',') ?? null;
const promptFile = arg('--prompt');
const systemOverride = promptFile ? readFileSync(promptFile, 'utf8') : null;

const base = createCallProvider(parseEnv(process.env));
if (!base) throw new Error('LLM_CALL_* не задан');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let active = 0;
const queue: (() => void)[] = [];
async function acquire() {
  if (active < 2) {
    active++;
    return;
  }
  await new Promise<void>((r) => queue.push(r));
  active++;
}
function release() {
  active--;
  queue.shift()?.();
}

/** Сырые ответы модели (до проверки цитат кодом) текущего транскрипта. */
let raw: unknown[] = [];
let calls = 0;
const llm: LlmProvider = {
  name: base.name,
  model: base.model,
  supportsTools: base.supportsTools,
  supportsJsonSchema: base.supportsJsonSchema,
  async complete(req: CompleteRequest, signal?: AbortSignal): Promise<CompleteResult> {
    const r = systemOverride ? { ...req, system: systemOverride } : req;
    await acquire();
    try {
      for (let i = 0; ; i++) {
        try {
          calls++;
          const res = await base.complete(r, signal);
          raw.push(res.kind === 'json' ? res.json : res.text);
          return res;
        } catch (e) {
          const st = (e as { status?: number }).status;
          if (i < 5 && (st === 429 || (st ?? 0) >= 500 || st === undefined)) {
            await sleep(st === 429 ? 10_000 * (i + 1) : 3000 * (i + 1));
            continue;
          }
          throw e;
        }
      }
    } finally {
      release();
    }
  },
};

type Scores = Record<Criterion, number>;
const tot = (s: Scores) => CRITERIA.reduce((a, c) => a + s[c], 0);

function rawScores(topicName: string, idx: number): Scores[] {
  const out: Scores[] = [];
  for (const r of raw) {
    let j = r as { topics?: { topic: string }[] } | string;
    if (typeof j === 'string') {
      try {
        j = JSON.parse(/\{[\s\S]*\}/.exec(j)?.[0] ?? '{}');
      } catch {
        continue;
      }
    }
    const ts = (j as { topics?: (Record<string, unknown> & { topic: string })[] }).topics ?? [];
    const row = ts.find((t) => t.topic?.trim() === topicName) ?? ts[idx];
    if (!row) continue;
    out.push(Object.fromEntries(CRITERIA.map((c) => [c, Number((row[c] as { score?: number } | undefined)?.score ?? 0)])) as Scores);
  }
  return out;
}

interface Row {
  id: string;
  category: string;
  grade: string;
  topic: string;
  gold: Gold;
  expect: string;
  mustNotConfirm: boolean;
  status: string;
  median: Scores;
  runs: Scores[];
  rawRuns: Scores[];
  quote: string;
}

async function runCase(c: Case): Promise<Row[]> {
  raw = [];
  const topics: EvalTopic[] = c.topics.map((t) => ({
    topic: t.topic,
    catalogId: null,
    claimed: true,
    claimStatement: null,
    maxLevel: Math.max(...t.qa.map((q) => q.level)) as EvalTopic['maxLevel'],
    qa: t.qa.map((q) => ({ question: '', answer: q.answer, level: q.level })),
  }));
  const ev = await evaluateCall(c.specialization, topics, llm, { adaptive: false });
  return c.topics.map((t, i) => {
    const d = ev.depthMap[i]!;
    return {
      id: c.id,
      category: c.category,
      grade: c.grade,
      topic: t.topic,
      gold: t.gold,
      expect: t.expect,
      mustNotConfirm: Boolean(t.mustNotConfirm),
      status: d.status,
      median: d.scores as unknown as Scores,
      runs: d.runs as unknown as Scores[],
      rawRuns: rawScores(t.topic, i),
      quote: d.quote,
    };
  });
}

function metrics(rows: Row[]) {
  const n = rows.length;
  const crit = Object.fromEntries(
    CRITERIA.map((c) => [
      c,
      {
        exact: rows.filter((r) => r.median[c] === r.gold[c]).length,
        within1: rows.filter((r) => Math.abs(r.median[c] - r.gold[c]) <= 1).length,
        bias: +(rows.reduce((a, r) => a + (r.median[c] - r.gold[c]), 0) / n).toFixed(2),
      },
    ]),
  );
  const cells = rows.length * CRITERIA.length;
  const exactAll = CRITERIA.reduce((a, c) => a + crit[c]!.exact, 0);
  const decided = rows.filter((r) => r.status !== 'inconclusive');
  const decisionOk = decided.filter((r) => (r.status === 'confirmed') === (r.expect === 'confirmed')).length;
  const spreads = rows.map((r) => {
    const t = r.runs.map(tot);
    return Math.max(...t) - Math.min(...t);
  });
  const critFlip = rows.reduce((a, r) => a + CRITERIA.filter((c) => new Set(r.runs.map((x) => x[c])).size > 1).length, 0);
  const runDecisionSplit = rows.filter((r) => new Set(r.runs.map((x) => decidePassed(x as never))).size > 1).length;
  const mnc = rows.filter((r) => r.mustNotConfirm);
  const falseConfirm = mnc.filter((r) => r.status === 'confirmed');
  const falseRunPass = mnc.reduce((a, r) => a + r.runs.filter((x) => decidePassed(x as never)).length, 0);
  const falseRawPass = mnc.reduce((a, r) => a + r.rawRuns.filter((x) => decidePassed(x as never)).length, 0);
  const missConfirm = rows.filter((r) => r.expect === 'confirmed' && r.status !== 'confirmed');
  const byCat = (cat: string) => rows.filter((r) => r.category === cat);
  const inj = byCat('injection');
  const injInflation = inj.map((r) => ({ id: r.id, gold: tot(r.gold), median: tot(r.median), rawMean: r.rawRuns.length ? +(r.rawRuns.map(tot).reduce((a, b) => a + b, 0) / r.rawRuns.length).toFixed(1) : null }));
  const buzz = byCat('buzzwords').map((r) => ({ id: r.id, gold: tot(r.gold), median: tot(r.median), status: r.status, runs: r.runs.map(tot) }));
  const catTable = [...new Set(rows.map((r) => r.category))].map((cat) => {
    const rs = byCat(cat);
    return {
      category: cat,
      topics: rs.length,
      decisionOk: rs.filter((r) => r.status !== 'inconclusive' && (r.status === 'confirmed') === (r.expect === 'confirmed')).length,
      inconclusive: rs.filter((r) => r.status === 'inconclusive').length,
      meanGold: +(rs.reduce((a, r) => a + tot(r.gold), 0) / rs.length).toFixed(1),
      meanMedian: +(rs.reduce((a, r) => a + tot(r.median), 0) / rs.length).toFixed(1),
    };
  });
  return {
    topics: n,
    criteria: crit,
    exactAll: `${exactAll}/${cells}`,
    within1All: `${CRITERIA.reduce((a, c) => a + crit[c]!.within1, 0)}/${cells}`,
    decision: `${decisionOk}/${decided.length} решённых, inconclusive ${n - decided.length}`,
    missConfirm: missConfirm.map((r) => `${r.id}/${r.topic}:${r.status}`),
    falseConfirm: falseConfirm.map((r) => `${r.id}/${r.topic}`),
    falseRunPass: `${falseRunPass}/${mnc.reduce((a, r) => a + r.runs.length, 0)} прогонов (после проверки цитат)`,
    falseRawPass: `${falseRawPass}/${mnc.reduce((a, r) => a + r.rawRuns.length, 0)} прогонов (сырые баллы модели)`,
    stability: {
      meanSpread: +(spreads.reduce((a, b) => a + b, 0) / n).toFixed(2),
      topicsWithSpread: spreads.filter((s) => s > 0).length,
      maxSpread: Math.max(...spreads),
      criterionFlips: `${critFlip}/${cells}`,
      runDecisionSplit,
    },
    injection: injInflation,
    buzzwords: buzz,
    byCategory: catTable,
  };
}

async function main() {
  const cases = CASES.filter((c) => !only || only.includes(c.id));
  const rows: Row[] = [];
  const t0 = Date.now();
  for (const c of cases) {
    try {
      const rs = await runCase(c);
      rows.push(...rs);
      for (const r of rs)
        console.log(
          `${r.id.padEnd(26)} ${r.topic.slice(0, 28).padEnd(28)} gold ${tot(r.gold)} ${r.expect === 'confirmed' ? '✓' : '✗'} | med ${CRITERIA.map((k) => r.median[k]).join('')}=${tot(r.median)} ${r.status} | runs ${r.runs.map(tot).join(',')} raw ${r.rawRuns.map(tot).join(',')}`,
        );
    } catch (e) {
      console.error(`${c.id}: ошибка ${(e as Error).message}`);
    }
  }
  const m = metrics(rows);
  console.log(JSON.stringify(m, null, 1));
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' }).replace(/[: ]/g, '-').slice(0, 16);
  const out = path.join(process.cwd(), `eval/results/prompt-audit-call-evaluator-${label}-${stamp}.json`);
  writeFileSync(out, JSON.stringify({ label, model: base!.model.replace(/gpt:\/\/[^/]+\//, 'gpt://…/'), prompt: promptFile ?? 'src/server/call/prompts/evaluator.md', calls, seconds: Math.round((Date.now() - t0) / 1000), metrics: m, rows }, null, 1));
  console.log(`→ ${out}`);
}

void main();
