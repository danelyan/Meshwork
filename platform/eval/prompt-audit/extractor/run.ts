// Аудит боевого извлекателя утверждений (prompts/extractor.md + verifyClaims + каталог) на модели стенда.
//
// Наборы:
//   base — eval/labels (без few-shot b02, f03), eval/demo, eval/attacks — тот же, что у llm-bench/compare.ts;
//   ext  — eval/prompt-audit/extractor/cases: mobile, ML/DS, DevOps, QA, аналитик, gamedev, embedded, английский,
//          скан после OCR, завышения, скрытый текст, инъекции, пустое, короткое, длинное (несколько частей).
//
// Запуск из platform/ (env стенда — см. общие правила лейна):
//   npx tsx eval/prompt-audit/extractor/run.ts --set all --tag before
//   npx tsx eval/prompt-audit/extractor/run.ts --set ext --only x11,x14 --repeats 2
// Результат: eval/results/prompt-audit-extractor-<tag>-<МСК>.json и сводка в stdout.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogFromFile } from '../../../src/server/claims/catalog-file';
import { extractClaims, extractorPromptVersion } from '../../../src/server/claims/extractor';
import { verifyClaims } from '../../../src/server/claims/verifier';
import { getEnv } from '../../../src/server/env';
import { createProvider } from '../../../src/server/llm/providers';
import { LlmError, type CompleteRequest, type LlmProvider } from '../../../src/server/llm/types';
import { textToDoc } from '../../predictors/doc';
import { prf, scoreDoc, type AuditCase, type DocScore } from './score';

const here = dirname(fileURLToPath(import.meta.url));
const evalDir = join(here, '..', '..');
const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
};
const SET = opt('set', 'all');
const TAG = opt('tag', 'run');
const REPEATS = Number(opt('repeats', '1'));
const PARALLEL = Math.min(2, Number(opt('parallel', '2')));
const ONLY = opt('only', '') ? new Set(opt('only', '').split(',')) : null;
const FEW_SHOT_IDS = ['b02', 'f03'];

interface Item {
  set: 'base' | 'ext' | 'attack';
  case: AuditCase;
  text: string;
  /** обязательные утверждения атаки (mustStillExtract) — для полноты на атаках */
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

function loadItems(): Item[] {
  const items: Item[] = [];
  const blank = { optional: [], forbidden: [], hiddenLines: [], lang: 'ru', theme: '' };
  if (SET === 'base' || SET === 'all') {
    for (const f of readdirSync(join(evalDir, 'labels')).filter((x) => x.endsWith('.json')).sort()) {
      const l = readJson<AuditCase>(join(evalDir, 'labels', f));
      if (FEW_SHOT_IDS.includes(l.id)) continue;
      items.push({ set: 'base', case: { ...blank, ...l, theme: 'labels' }, text: readFileSync(join(evalDir, 'resumes', `${l.id}.md`), 'utf8') });
    }
    for (const d of readdirSync(join(evalDir, 'demo')).sort()) {
      const dir = join(evalDir, 'demo', d);
      if (!existsSync(join(dir, 'label.json'))) continue;
      const l = readJson<AuditCase>(join(dir, 'label.json'));
      const h = existsSync(join(dir, 'hidden.json')) ? readJson<{ hidden?: boolean; hiddenText?: string }>(join(dir, 'hidden.json')) : {};
      items.push({ set: 'base', case: { ...blank, ...l, id: d, theme: 'demo' }, text: readFileSync(join(dir, 'resume.md'), 'utf8') + (h.hidden && h.hiddenText ? `\n${h.hiddenText}\n` : '') });
    }
    const adir = join(evalDir, 'attacks');
    for (const f of readdirSync(adir).filter((x) => x.endsWith('.expect.json')).sort()) {
      const ex = readJson<{ id: string; source: string; technique?: string; forbidden: { claimIds?: string[] }; required: { mustStillExtract?: { catalogId: string; quote: string }[] } }>(join(adir, f));
      const metaPath = join(adir, `${ex.id}.meta.json`);
      const meta = existsSync(metaPath) ? readJson<{ hidden?: boolean; hiddenText?: string }>(metaPath) : {};
      items.push({
        set: 'attack',
        case: { ...blank, id: ex.id, theme: ex.technique ?? 'attack', specialization: '', gradeExpected: '', claims: ex.required.mustStillExtract ?? [], notClaims: [], forbidden: ex.forbidden.claimIds ?? [], optional: ['*'] },
        text: readFileSync(join(adir, ex.source), 'utf8') + (meta.hidden && meta.hiddenText ? `\n${meta.hiddenText}\n` : ''),
      });
    }
  }
  if (SET === 'ext' || SET === 'all') {
    const cdir = join(here, 'cases');
    for (const f of readdirSync(cdir).filter((x) => x.endsWith('.json')).sort()) {
      const c = readJson<AuditCase>(join(cdir, f));
      items.push({ set: 'ext', case: c, text: readFileSync(join(cdir, `${c.id}.md`), 'utf8') });
    }
  }
  return ONLY ? items.filter((i) => ONLY.has(i.case.id)) : items;
}

interface Call { ms: number; ok: boolean; repair: boolean; inTok: number; outTok: number; status?: number }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Латентность, токены, ремонты; на 429 — пауза и повтор (до 4 раз), чтобы не мерить лимиты вместо промпта. */
function instrument(p: LlmProvider, calls: Call[], raws: unknown[]): LlmProvider {
  return {
    ...p,
    async complete(req: CompleteRequest, signal?: AbortSignal) {
      const repair = req.messages.length > 1;
      for (let attempt = 0; ; attempt++) {
        const t = Date.now();
        try {
          const r = await p.complete({ ...req, timeoutMs: 120_000 }, signal);
          calls.push({ ms: Date.now() - t, ok: true, repair, inTok: r.usage.inputTokens, outTok: r.usage.outputTokens });
          raws.push(r.kind === 'json' ? r.json : r.text);
          return r;
        } catch (e) {
          const status = e instanceof LlmError ? e.status : undefined;
          calls.push({ ms: Date.now() - t, ok: false, repair, inTok: 0, outTok: 0, ...(status ? { status } : {}) });
          if ((status === 429 || status === 502 || status === 503 || status === 504) && attempt < 4) {
            await sleep(15_000 * (attempt + 1));
            continue;
          }
          throw e;
        }
      }
    },
  };
}

interface DocRun {
  set: Item['set'];
  id: string;
  theme: string;
  rep: number;
  accepted: { catalogId: string; quote: string; wording: string; confidence: string }[];
  rejected: { catalogId: string; quote: string; reason: string }[];
  proposed: number;
  score: DocScore;
  calls: Call[];
  invalidOutput: boolean;
  error?: string;
  raws: unknown[];
}

async function runOne(llm: LlmProvider, it: Item, rep: number): Promise<DocRun> {
  const catalog = catalogFromFile();
  const doc = textToDoc(it.text, it.case.id);
  const hidden = new Set(it.case.hiddenLines);
  doc.lines = doc.lines.map((l, i) => (hidden.has(i + 1) ? { ...l, hidden: true } : l));
  const calls: Call[] = [];
  const raws: unknown[] = [];
  let invalidOutput = false;
  let error: string | undefined;
  let accepted: DocRun['accepted'] = [];
  let rejected: DocRun['rejected'] = [];
  let proposed = 0;
  try {
    const p = await extractClaims(doc, catalog, instrument(llm, calls, raws));
    proposed = p.length;
    const v = verifyClaims(p, [doc], catalog);
    accepted = v.accepted.map((c) => ({ catalogId: c.catalogId, quote: c.quote, wording: c.wording ?? '', confidence: c.confidence }));
    rejected = v.rejected.map((r) => ({ catalogId: r.claim.catalogId, quote: r.claim.quote, reason: r.reason }));
  } catch (e) {
    if (e instanceof LlmError && e.code === 'invalid_output') invalidOutput = true;
    else error = e instanceof Error ? e.message : String(e);
  }
  const c = it.set === 'attack' ? { ...it.case, optional: accepted.map((a) => a.catalogId) } : it.case;
  return { set: it.set, id: it.case.id, theme: it.case.theme, rep, accepted, rejected, proposed, score: scoreDoc(c, accepted.map((a) => a.catalogId)), calls, invalidOutput, ...(error ? { error } : {}), raws };
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)] as number;
};
const f3 = (x: number) => (Number.isNaN(x) ? 'н/д' : x.toFixed(3));

function summary(runs: DocRun[]) {
  const sum = runs.reduce((a, r) => ({ tp: a.tp + r.score.tp, fp: a.fp + r.score.fp, fn: a.fn + r.score.fn }), { tp: 0, fp: 0, fn: 0 });
  const calls = runs.flatMap((r) => r.calls);
  const first = calls.filter((c) => c.ok && !c.repair).length;
  const rejectedBy: Record<string, number> = {};
  for (const r of runs) for (const x of r.rejected) rejectedBy[x.reason] = (rejectedBy[x.reason] ?? 0) + 1;
  return {
    docs: runs.length,
    ...sum,
    ...prf(sum.tp, sum.fp, sum.fn),
    trapHits: runs.reduce((a, r) => a + r.score.trapHits.length, 0),
    forbiddenHitDocs: runs.filter((r) => r.score.forbiddenHits.length > 0).length,
    repairs: calls.filter((c) => c.repair).length,
    firstCalls: first,
    invalidOutputDocs: runs.filter((r) => r.invalidOutput).length,
    errorDocs: runs.filter((r) => r.error).length,
    http429: calls.filter((c) => c.status === 429).length,
    rejectedBy,
    proposed: runs.reduce((a, r) => a + r.proposed, 0),
    p50ms: pct(calls.filter((c) => c.ok).map((c) => c.ms), 50),
    p95ms: pct(calls.filter((c) => c.ok).map((c) => c.ms), 95),
    tokensIn: calls.reduce((a, c) => a + c.inTok, 0),
    tokensOut: calls.reduce((a, c) => a + c.outTok, 0),
  };
}

function msk(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' }).replace(' ', 'T').replace(/:/g, '-');
}

async function main() {
  const env = getEnv();
  const llm = createProvider(env);
  const items = loadItems();
  const jobs = Array.from({ length: REPEATS }, (_, rep) => items.map((it) => ({ it, rep }))).flat();
  console.log(`промпт: ${extractorPromptVersion()}; модель: ${llm.name} ${llm.model}; документов: ${items.length} × ${REPEATS}; параллельно: ${PARALLEL}`);
  const runs: DocRun[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next < jobs.length) {
        const j = jobs[next++]!;
        const r = await runOne(llm, j.it, j.rep);
        runs.push(r);
        const s = r.score;
        console.log(
          `${r.id.padEnd(14)} tp ${s.tp} fp ${s.fp} fn ${s.fn}` +
            (s.fpIds.length ? ` FP[${s.fpIds.join(',')}]` : '') +
            (s.fnIds.length ? ` FN[${s.fnIds.join(',')}]` : '') +
            (s.forbiddenHits.length ? ` !ИНЪЕКЦИЯ[${s.forbiddenHits.join(',')}]` : '') +
            (r.rejected.length ? ` rej[${r.rejected.map((x) => `${x.catalogId}:${x.reason}`).join(',')}]` : '') +
            (r.calls.some((c) => c.repair) ? ' РЕМОНТ' : '') +
            (r.invalidOutput ? ' JSON-ОТКАЗ' : '') +
            (r.error ? ` ОШИБКА ${r.error.slice(0, 80)}` : ''),
        );
      }
    }),
  );
  runs.sort((a, b) => a.set.localeCompare(b.set) || a.id.localeCompare(b.id) || a.rep - b.rep);
  const bySet: Record<string, ReturnType<typeof summary>> = {};
  for (const s of ['base', 'attack', 'ext'] as const) {
    const rs = runs.filter((r) => r.set === s);
    if (rs.length) bySet[s] = summary(rs);
  }
  const pr = runs.filter((r) => r.set !== 'attack');
  bySet.labeled = summary(pr);
  console.log('\nнабор      доков   P      R      F1    ловушки  инъекции(док)  ремонт  JSON-отказ  ошибки  отклонено verifier');
  for (const [k, v] of Object.entries(bySet)) {
    console.log(
      `${k.padEnd(10)} ${String(v.docs).padStart(4)}  ${f3(v.precision)}  ${f3(v.recall)}  ${f3(v.f1)}  ${String(v.trapHits).padStart(6)}  ${String(v.forbiddenHitDocs).padStart(8)}       ${v.repairs}/${v.firstCalls}  ${v.invalidOutputDocs}  ${v.errorDocs}  ${JSON.stringify(v.rejectedBy)}`,
    );
  }
  const dir = join(evalDir, 'results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `prompt-audit-extractor-${TAG}-${msk()}.json`);
  writeFileSync(file, `${JSON.stringify({ prompt: extractorPromptVersion(), model: `${llm.name} ${llm.model}`, args: argv, generatedAtMsk: msk(), summary: bySet, runs }, null, 2)}\n`);
  console.log(`\nЗаписано: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
