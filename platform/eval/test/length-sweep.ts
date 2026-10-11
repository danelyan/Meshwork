// Перебор лимитов длины основной фазы (MIN…MAX заданий) – ретест κ, длина, ранние остановки. Дефолты policy.ts не меняются:
// каждый вариант – отдельный прогон eval/test/run.ts с --min/--max (StopLimits), тот же seed и те же популяции.
// Модель ошибки – «экземпляр» (σ = 0,2), как строка «Мы» в docs/validation-results.md; --retest-only (без утечки и пересдач:
// на ретест и длину не влияют, их попытки идут раньше на том же rng).
//
// Запуск из platform/:
//   npx tsx eval/test/length-sweep.ts                 # N = 2000, seed 1, пишет ключ lengthSweep в eval/test/results.json
//   npx tsx eval/test/length-sweep.ts --n 500 --no-write
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MAX_ITEMS, MIN_ITEMS } from '../../src/server/test/policy';

import { parseLengthSweepRun, type LengthSweepVariant } from '../../src/server/validation/length-sweep';

const args = process.argv.slice(2);
const argStr = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const N = Number(argStr('n') ?? 2000);
const SEED = Number(argStr('seed') ?? 1);
const WRITE = !args.includes('--no-write');
const OUT = argStr('json') ?? 'eval/test/results.json';
const VARIANTS: [number, number][] = (argStr('variants') ?? `${MIN_ITEMS}-${MAX_ITEMS},9-12,10-14,12-16`)
  .split(',')
  .map((v) => v.split('-').map(Number) as [number, number]);

const dir = mkdtempSync(join(tmpdir(), 'length-sweep-'));
const variants: LengthSweepVariant[] = [];
for (const [min, max] of VARIANTS) {
  const file = join(dir, `${min}-${max}.json`);
  const t0 = Date.now();
  const cmd = ['tsx', 'eval/test/run.ts', '--n', String(N), '--seed', String(SEED), '--error', 'instance', '--retest-only', '--min', String(min), '--max', String(max), '--json', file];
  const r = spawnSync('npx', cmd, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) throw new Error(`run.ts ${min}–${max}: код ${r.status}`);
  const v = parseLengthSweepRun(JSON.parse(readFileSync(file, 'utf8')), { min, max, current: min === MIN_ITEMS && max === MAX_ITEMS });
  variants.push(v);
  const f = (x: number | null) => (x === null ? '–' : x.toFixed(3));
  console.log(`${min}–${max}: κ ${f(v.strict.kappa)} (конк. ${f(v.competitor.kappa)}), длина ${f(v.strict.lengthMean)} / ${f(v.competitor.lengthMean)}, ранние ${f(v.strict.earlyStopShare)}, ложн. подтв. ${f(v.strict.falsePass)} / ${f(v.competitor.falsePass)}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
}

const sweep = {
  generatedAt: new Date().toISOString(),
  command: `npx tsx eval/test/length-sweep.ts ${args.join(' ')}`.trim(),
  config: { n: N, seed: SEED, errorModel: 'instance' },
  variants,
};
if (WRITE) {
  const out = JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>;
  out.lengthSweep = sweep;
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`lengthSweep → ${OUT}`);
} else console.log(JSON.stringify(sweep, null, 2));
