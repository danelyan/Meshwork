// Сравнение моделей на боевом извлекателе:
// тот же промпт (src/server/claims/prompts/extractor.md), каталог (prisma/seed/claims-catalog.json),
// схема и проверка цитат (verifyClaims), что на стенде. Эталон – eval/labels (30 резюме + 3 демо),
// атаки – eval/attacks. Дополняет run.ts: там диалог консультанта с инструментами, здесь – качество
// извлечения, доля JSON-ошибок, латентность и стоимость на одном и том же наборе.
//
//   npx tsx eval/llm-bench/compare.ts                         # alice, giga, deepseek – у кого есть ключи
//   npx tsx eval/llm-bench/compare.ts --models alice,deepseek --repeats 2
//   npx tsx eval/llm-bench/compare.ts --models stub            # самопроверка без сети
//
// Результат: eval/results/llm-compare-<МСК>.md (таблица) и .json (сырые цифры).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { extractClaims } from '../../src/server/claims/extractor';
import { extractorDictionaryStub } from '../../src/server/claims/stub-demo';
import { verifyClaims } from '../../src/server/claims/verifier';
import { registerStubResponse } from '../../src/server/llm/providers/stub';
import { LlmError, type CompleteRequest, type LlmProvider } from '../../src/server/llm/types';
import { textToDoc } from '../predictors/doc';
import { evaluate, type Predict } from '../run';
import { env, makeModels, type ModelDef } from './models';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
};
const MODEL_ARG = opt('models', 'alice,giga,deepseek').split(',');
const REPEATS = Number(opt('repeats', '1'));
const TIMEOUT_MS = Number(opt('timeout', '60000'));
/** Резюме, строки которых взяты в few-shot промпта извлекателя, – вне метрик (иначе утечка эталона). */
export const FEW_SHOT_IDS = ['b02', 'f03'];

interface Call { ms: number; ok: boolean; inTok: number; outTok: number; repair: boolean; status?: number }
interface Run { calls: Call[]; invalidOutput: number; failedDocs: number; docs: number }

/** Провайдер-обёртка: латентность, токены, ремонты (повторный запрос с текстом ошибки схемы). */
function instrument(p: LlmProvider, run: Run): LlmProvider {
  return {
    ...p,
    async complete(req: CompleteRequest, signal?: AbortSignal) {
      const t = Date.now();
      const repair = req.messages.length > 1;
      try {
        const r = await p.complete({ ...req, timeoutMs: TIMEOUT_MS }, signal);
        run.calls.push({ ms: Date.now() - t, ok: true, inTok: r.usage.inputTokens, outTok: r.usage.outputTokens, repair });
        return r;
      } catch (e) {
        run.calls.push({ ms: Date.now() - t, ok: false, inTok: 0, outTok: 0, repair, ...(e instanceof LlmError && e.status ? { status: e.status } : {}) });
        throw e;
      }
    },
  };
}

function predictor(p: LlmProvider, run: Run): Predict {
  const catalog = catalogFromFile();
  return async (text, ctx) => {
    run.docs++;
    const doc = textToDoc(text, ctx.id);
    try {
      const proposed = await extractClaims(doc, catalog, instrument(p, run));
      return verifyClaims(proposed, [doc], catalog).accepted;
    } catch (e) {
      if (e instanceof LlmError && e.code === 'invalid_output') run.invalidOutput++;
      else run.failedDocs++;
      return [];
    }
  };
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)] as number;
};
const prf = (tp: number, fp: number, fn: number) => {
  const p = tp + fp ? tp / (tp + fp) : NaN;
  const r = tp + fn ? tp / (tp + fn) : NaN;
  return { precision: p, recall: r, f1: p + r ? (2 * p * r) / (p + r) : NaN };
};
const f3 = (x: number) => (Number.isNaN(x) ? 'н/д' : x.toFixed(3));
const p1 = (x: number) => (Number.isNaN(x) ? 'н/д' : `${(x * 100).toFixed(1)} %`);

async function measure(def: ModelDef) {
  const rows: { tp: number; fp: number; fn: number }[] = [];
  const run: Run = { calls: [], invalidOutput: 0, failedDocs: 0, docs: 0 };
  let injectionsExecuted = 0;
  let injectionsTotal = 0;
  let trapHits = 0;
  const started = Date.now();
  for (let i = 0; i < REPEATS; i++) {
    const r = await evaluate(predictor(def.make(false), run));
    for (const row of r.perResume) if (!FEW_SHOT_IDS.includes(row.id)) rows.push(row);
    for (const row of r.perResume) if (!FEW_SHOT_IDS.includes(row.id)) trapHits += row.trapHits;
    injectionsExecuted += r.injections.executed;
    injectionsTotal += r.injections.total;
    process.stdout.write('.');
  }
  const sum = rows.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn }), { tp: 0, fp: 0, fn: 0 });
  const okCalls = run.calls.filter((c) => c.ok);
  const firstCalls = run.calls.filter((c) => !c.repair);
  const inTok = run.calls.reduce((s, c) => s + c.inTok, 0);
  const outTok = run.calls.reduce((s, c) => s + c.outTok, 0);
  return {
    model: def.id,
    title: def.title,
    ...prf(sum.tp, sum.fp, sum.fn),
    ...sum,
    trapHits,
    docs: run.docs,
    calls: run.calls.length,
    /** доля частей документа, где первый ответ не прошёл схему и понадобился ремонт */
    jsonRepairShare: firstCalls.length ? run.calls.filter((c) => c.repair).length / firstCalls.length : NaN,
    /** доля документов, где JSON не исправился и после ремонта */
    jsonFailShare: run.docs ? run.invalidOutput / run.docs : NaN,
    providerErrors: run.calls.filter((c) => !c.ok).length,
    http429: run.calls.filter((c) => c.status === 429).length,
    failedDocs: run.failedDocs,
    injections: `${injectionsExecuted} из ${injectionsTotal}`,
    callP50ms: pct(okCalls.map((c) => c.ms), 50),
    callP95ms: pct(okCalls.map((c) => c.ms), 95),
    wallSec: Math.round((Date.now() - started) / 1000),
    tokensIn: inTok,
    tokensOut: outTok,
    costUsd: def.price ? Math.round(((inTok * def.price.in + outTok * def.price.out) / 1e6) * 100) / 100 : null,
  };
}

function table(results: Awaited<ReturnType<typeof measure>>[]): string {
  const head = ['Модель', 'P', 'R', 'F1', 'ловушки (FP)', 'JSON: ремонт', 'JSON: отказ', 'ошибки / 429', 'инъекции', 'p50, мс', 'p95, мс', 'токены вх/вых', 'стоимость, $'];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of results) {
    lines.push(
      `| ${r.model} | ${f3(r.precision)} | ${f3(r.recall)} | ${f3(r.f1)} | ${r.trapHits} | ${p1(r.jsonRepairShare)} | ${p1(r.jsonFailShare)} | ${r.providerErrors} / ${r.http429} | ${r.injections} | ${r.callP50ms} | ${r.callP95ms} | ${r.tokensIn} / ${r.tokensOut} | ${r.costUsd ?? 'н/д'} |`,
    );
  }
  return lines.join('\n');
}

function msk(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' }).replace(' ', 'T').replace(/:/g, '-');
}

async function main() {
  const models = makeModels(TIMEOUT_MS);
  if (MODEL_ARG.includes('stub')) registerStubResponse('extractor', extractorDictionaryStub);
  const selected: ModelDef[] = [];
  for (const id of MODEL_ARG) {
    const def = models[id];
    if (!def) {
      console.log(`неизвестная модель: ${id} (есть: ${Object.keys(models).join(', ')})`);
      continue;
    }
    const missing = def.requiredEnv.filter((k) => !env(k));
    if (missing.length) {
      console.log(`${id}: ключ не задан: ${missing.join(', ')} – модель пропущена`);
      continue;
    }
    selected.push(def);
  }
  if (!selected.length) {
    console.log('Нет ни одной модели с ключами – сравнение не запускалось. Env – eval/llm-bench/README.md.');
    return;
  }
  const results = [];
  for (const def of selected) {
    process.stdout.write(`${def.id}: `);
    results.push(await measure(def));
    console.log(' готово');
  }
  const md = [
    `# Сравнение LLM на боевом извлекателе – ${msk()} МСК`,
    '',
    `Набор: eval/labels (без few-shot ${FEW_SHOT_IDS.join(', ')}), атаки eval/attacks; повторов: ${REPEATS}. P/R/F1 – по catalogId после verifyClaims.`,
    '',
    table(results),
    '',
    'JSON: ремонт – доля частей документа, где первый ответ не прошёл схему; отказ – доля документов, где не помог и ремонт. Стоимость – по прайсу из env (BENCH_*_PRICE_IN/OUT, $ за 1M токенов).',
  ].join('\n');
  console.log(`\n${md}`);
  const dir = join(here, '..', 'results');
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `llm-compare-${msk()}`);
  writeFileSync(`${base}.md`, `${md}\n`);
  writeFileSync(`${base}.json`, JSON.stringify({ args: argv, results }, null, 2));
  console.log(`\nРезультат: ${base}.md`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
