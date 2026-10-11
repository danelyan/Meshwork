// Аудит оценщика защиты (src/server/defense/prompts/evaluator.md) на размеченных транскриптах cases.ts.
// Зовёт тот же код, что и сессия защиты: evaluateDefense (промпт + схема + проверка цитат) → decidePassed.
//
//   cd platform && set -a && . ./.env && set +a
//   export OPENAI_CHAT_BASE_URL="$LLM_CALL_BASE_URL" OPENAI_CHAT_API_KEY="$LLM_CALL_API_KEY" \
//          OPENAI_CHAT_MODEL="$LLM_CALL_MODEL" LLM_PROVIDER=openai-chat; unset OPENAI_CHAT_EXTRA_BODY
//   npx tsx eval/prompt-audit/defense-evaluator/run.ts --label before            # 34 случая × 3 повтора, по 2 параллельно
//   npx tsx eval/prompt-audit/defense-evaluator/run.ts --cases I4-weak-plus-sneaky-praise --repeats 1
//   npx tsx eval/prompt-audit/defense-evaluator/run.ts --rescore eval/results/prompt-audit-defense-evaluator-….json
//
// БД не нужна. Итог — eval/results/prompt-audit-defense-evaluator-<label>-<МСК>.json.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { decidePassed, evaluateDefense, scoreTotal, type EvaluationResult } from '../../../src/server/defense/evaluator';
import { getEnv } from '../../../src/server/env';
import { createLlmClient } from '../../../src/server/llm/client';
import { createProvider } from '../../../src/server/llm/providers';
import { CASES, type DefenseCase } from './cases';

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
};
const REPEATS = Number(opt('repeats', '3'));
const PARALLEL = Math.max(1, Math.min(2, Number(opt('parallel', '2'))));
const LABEL = opt('label', 'run');
const ONLY = opt('cases', '');
const RESCORE = opt('rescore', '');

interface RunRecord {
  caseId: string;
  repeat: number;
  ok: boolean;
  error?: string;
  passed?: boolean;
  total?: number;
  scores?: EvaluationResult['scores'];
  criteria?: EvaluationResult['criteria'];
  attempts?: number;
  ms?: number;
}

export function injectionLeaks(c: DefenseCase, r: RunRecord): string[] {
  if (!c.injection || !r.criteria) return [];
  return r.criteria
    .filter((x) => x.quoteValid && x.score > 0)
    .filter((x) => c.injection!.some((frag) => x.quote.toLowerCase().includes(frag.toLowerCase())))
    .map((x) => `${x.criterion}: ${x.quote.slice(0, 80)}`);
}

function summarize(runs: RunRecord[]) {
  const byCase = new Map<string, RunRecord[]>();
  for (const r of runs) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);
  const rows = CASES.filter((c) => byCase.has(c.id)).map((c) => {
    const rs = byCase.get(c.id)!.filter((r) => r.ok);
    const passes = rs.map((r) => r.passed!);
    const totals = rs.map((r) => r.total!);
    const majority = passes.filter(Boolean).length * 2 > passes.length;
    const rejected = rs.flatMap((r) => (r.criteria ?? []).filter((x) => !x.quoteValid && x.modelScore > 0).map((x) => `${x.criterion}:${x.quoteRejection}`));
    return {
      id: c.id,
      category: c.category,
      clear: c.clear,
      expectPassed: c.expectPassed,
      runs: rs.length,
      errors: byCase.get(c.id)!.length - rs.length,
      passes,
      totals,
      majority,
      agree: rs.length ? majority === c.expectPassed : null,
      stable: rs.length > 1 && new Set(passes).size === 1,
      spread: totals.length ? Math.max(...totals) - Math.min(...totals) : 0,
      scores: rs.map((r) => r.scores),
      rejectedPositive: rejected,
      injectionLeaks: rs.flatMap((r) => injectionLeaks(c, r)),
    };
  });
  const clear = rows.filter((r) => r.clear && r.runs);
  const allRuns = rows.flatMap((r) => r.passes.map((p) => ({ p, row: r })));
  const clearRuns = allRuns.filter((x) => x.row.clear);
  const metrics = {
    cases: rows.length,
    clearCases: clear.length,
    agreementClearMajority: `${clear.filter((r) => r.agree).length}/${clear.length}`,
    agreementClearRuns: `${clearRuns.filter((x) => x.p === x.row.expectPassed).length}/${clearRuns.length}`,
    falsePassRuns: `${clearRuns.filter((x) => x.p && !x.row.expectPassed).length}/${clearRuns.filter((x) => !x.row.expectPassed).length}`,
    falseFailRuns: `${clearRuns.filter((x) => !x.p && x.row.expectPassed).length}/${clearRuns.filter((x) => x.row.expectPassed).length}`,
    stableCases: `${rows.filter((r) => r.stable).length}/${rows.filter((r) => r.runs > 1).length}`,
    meanTotalSpread: +(rows.reduce((s, r) => s + r.spread, 0) / Math.max(1, rows.length)).toFixed(2),
    injectionCasesHeld: `${rows.filter((r) => r.category.startsWith('injection') && r.agree && !r.injectionLeaks.length).length}/${rows.filter((r) => r.category.startsWith('injection')).length}`,
    injectionLeakRuns: rows.reduce((s, r) => s + r.injectionLeaks.length, 0),
    positiveScoresRejectedByCode: rows.reduce((s, r) => s + r.rejectedPositive.length, 0),
    errors: rows.reduce((s, r) => s + r.errors, 0),
  };
  return { metrics, rows };
}

function print(s: ReturnType<typeof summarize>) {
  for (const r of s.rows) {
    const mark = r.agree === null ? '??' : r.agree ? 'ok' : 'XX';
    console.log(
      `${mark} ${r.id.padEnd(36)} exp=${r.expectPassed ? 'pass' : 'fail'}${r.clear ? '' : '(погр.)'} got=${r.passes.map((p) => (p ? 'P' : 'f')).join('')} totals=${r.totals.join(',')}${r.rejectedPositive.length ? ` rej=${r.rejectedPositive.join(' ')}` : ''}${r.injectionLeaks.length ? ` LEAK=${r.injectionLeaks.join(' | ')}` : ''}`,
    );
  }
  console.log(JSON.stringify(s.metrics, null, 2));
}

async function main() {
  if (RESCORE) {
    const saved = JSON.parse(readFileSync(RESCORE, 'utf8')) as { runs: RunRecord[] };
    print(summarize(saved.runs));
    return;
  }
  const env = getEnv();
  if (env.LLM_PROVIDER === 'stub') throw new Error('Нужна живая модель: LLM_PROVIDER не stub');
  const llm = createLlmClient({ provider: createProvider(env), maxConcurrency: PARALLEL, timeoutMs: 90_000, maxRetries: 4 }).forContext();
  const promptText = readFileSync(path.join(process.cwd(), 'src/server/defense/prompts/evaluator.md'), 'utf8');
  const promptHash = createHash('sha256').update(promptText).digest('hex').slice(0, 12);
  const cases = CASES.filter((c) => !ONLY || ONLY.split(',').includes(c.id));
  const jobs = cases.flatMap((c) => Array.from({ length: REPEATS }, (_, i) => ({ c, i })));
  const runs: RunRecord[] = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { c, i } = jobs[next++]!;
      const t0 = Date.now();
      try {
        const res = await evaluateDefense({ claimStatement: c.claimStatement, catalogStatement: c.catalogStatement, turns: c.turns }, llm);
        const passed = decidePassed(res.scores);
        runs.push({ caseId: c.id, repeat: i, ok: true, passed, total: scoreTotal(res.scores), scores: res.scores, criteria: res.criteria, attempts: res.attempts, ms: Date.now() - t0 });
        process.stdout.write(`${c.id}#${i} ${passed ? 'P' : 'f'} ${scoreTotal(res.scores)}\n`);
      } catch (err) {
        runs.push({ caseId: c.id, repeat: i, ok: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 });
        process.stdout.write(`${c.id}#${i} ERROR ${err instanceof Error ? err.message.slice(0, 120) : err}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  const summary = summarize(runs);
  print(summary);
  const msk = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const out = path.join(process.cwd(), `eval/results/prompt-audit-defense-evaluator-${LABEL}-${msk}.json`);
  writeFileSync(
    out,
    JSON.stringify({ label: LABEL, model: env.OPENAI_CHAT_MODEL ?? env.LLM_PROVIDER, promptHash, repeats: REPEATS, at: new Date().toISOString(), metrics: summary.metrics, rows: summary.rows, runs }, null, 2),
  );
  console.log(`→ ${path.relative(process.cwd(), out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
