// Ширина банка заданий по подкатегориям: хватает ли семейств на длинный тест без повторов.
// Пул попытки Junior/Middle – свои семейства подкатегории + общие (common-map, доля ≤ MAX_COMMON_SHARE), как в проде
// (poolFor с common, attempt adr-0002-v7). Заявка Senior от длины не зависит (основная фаза – SENIOR_MAIN_MAX = 4).
//   reachable      – сколько заданий достижимо в одной попытке (reachableSize: все свои + общие в пределах доли);
//   shortBy[max]   – сколько не хватает на max основной фазы + JUNIOR_PROBE_MAX дозадавания (0 – хватает);
//   shortByRetest  – сколько не хватает на две попытки по max без единого повтора (ротация между попытками мягкая,
//                    вес 0,5, поэтому нехватка здесь – не поломка, а рост доли повторённых семейств в ретесте).
//
// Запуск из platform/:
//   npx tsx eval/test/bank-width.ts              # пишет ключ bankWidth в eval/test/results.json
//   npx tsx eval/test/bank-width.ts --no-write   # только таблица
import { readFileSync, writeFileSync } from 'node:fs';

import { SUBCATEGORIES } from '../../src/lib/directions';
import { generatorsForSubcategory, poolFor } from '../../src/server/test/generators';
import { JUNIOR_PROBE_MAX, MAX_ITEMS, reachableSize } from '../../src/server/test/policy';
import type { BankWidth, BankWidthRow } from '../../src/server/validation/length-sweep';

const args = process.argv.slice(2);
const WRITE = !args.includes('--no-write');
const OUT = 'eval/test/results.json';
const MAXES = [MAX_ITEMS, 12, 14, 16].filter((x, i, a) => a.indexOf(x) === i);

const rows: BankWidthRow[] = [];
for (const sub of SUBCATEGORIES) {
  const own = generatorsForSubcategory(sub.id);
  const tp = poolFor(sub.specialization, sub.id, { common: true });
  const pool = (tp?.generators ?? []).map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade, common: Boolean(g.shared) }));
  const reachable = tp && !tp.legacy ? reachableSize(pool) : 0;
  const shortBy: Record<string, number> = {};
  const shortByRetest: Record<string, number> = {};
  for (const m of MAXES) {
    shortBy[String(m)] = Math.max(0, m + JUNIOR_PROBE_MAX - reachable);
    shortByRetest[String(m)] = Math.max(0, 2 * m - reachable);
  }
  rows.push({
    subcategoryId: sub.id,
    title: sub.title,
    own: {
      junior: own.filter((g) => g.grade === 'junior').length,
      middle: own.filter((g) => g.grade === 'middle').length,
      senior: own.filter((g) => g.grade === 'senior').length,
    },
    common: tp?.commonCount ?? 0,
    reachable,
    shortBy,
    shortByRetest,
  });
}

console.log(`| Подкатегория | свои J/M/S | общие | достижимо в попытке | ${MAXES.map((m) => `нехватка max ${m}+${JUNIOR_PROBE_MAX}`).join(' | ')} | ${MAXES.map((m) => `ретест 2×${m}`).join(' | ')} |`);
console.log(`|---|---|---|---|${MAXES.map(() => '---|').join('')}${MAXES.map(() => '---|').join('')}`);
for (const r of rows) {
  console.log(
    `| ${r.subcategoryId} | ${r.own.junior}/${r.own.middle}/${r.own.senior} | ${r.common} | ${r.reachable} | ${MAXES.map((m) => r.shortBy[String(m)]).join(' | ')} | ${MAXES.map((m) => r.shortByRetest[String(m)]).join(' | ')} |`,
  );
}

const bank: BankWidth = {
  generatedAt: new Date().toISOString(),
  command: `npx tsx eval/test/bank-width.ts ${args.join(' ')}`.trim(),
  maxes: MAXES,
  probe: JUNIOR_PROBE_MAX,
  rows,
};
if (WRITE) {
  const out = JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>;
  out.bankWidth = bank;
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`bankWidth → ${OUT}`);
}
