// Отличает ли поиск по категории Senior от Middle (колонка S каталога, scripts/catalog-senior.json). Без БД и сети.
//   npx tsx eval/matching/senior-category.ts
// Демо-пул по категориям (prisma/seed/pool-*.ts): в каждой подкатегории Middle и Senior ранжируются под потребности
// категории Senior (categoryNeeds) БЕЗ категории теста — только по утверждениям. «До» — каталог без Senior-only записей
// и с весом Senior = Middle (как до 11.10). Оговорка: профили и их Senior-навыки написали мы — это проверка механики,
// не независимая валидация.
// Второй блок — расширенная синтетика (synthetic.ts): генератор написан до колонки S и её не знает; истина — латентный
// грейд генератора (Senior против Middle), категория теста скрыта. Меряем, поднимают ли веса S истинных Senior выше.
import { DEMO_POOL_CATEGORIES } from '../../prisma/seed/pool-categories';
import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { categoryNeeds, rankCandidates, type CandidateEvidence } from '../../src/server/employer/ranking';
import { SUBCATEGORIES } from '../../src/lib/directions';
import type { CatalogEntry } from '../../src/server/claims/types';

import { generateSynthetic, SYN_SEED } from './synthetic';

const full = catalogFromFile();
const after = new Map(full.map((e) => [e.id, e]));
// «до»: без Senior-only записей, вес Senior = Middle (как было)
const strip = (e: CatalogEntry): CatalogEntry => {
  const w = JSON.parse(JSON.stringify(e.weights ?? null));
  if (w) for (const t of 'junior' in w ? [w] : Object.values(w)) delete (t as Record<string, unknown>).senior;
  return { ...e, weights: w ?? undefined } as CatalogEntry;
};
const before = new Map(full.filter((e) => !(e.grades.length === 1 && e.grades[0] === 'senior')).map((e) => [e.id, strip(e)]));
function run(cat: Map<string, CatalogEntry>, label: string) {
  let pairs = 0, wins = 0, top2 = 0, n = 0;
  for (const s of SUBCATEGORIES) {
    const pool = DEMO_POOL_CATEGORIES.filter((p) => p.subcategoryId === s.id && p.category?.grade !== 'junior');
    const ev: CandidateEvidence[] = pool.map((p) => ({ id: p.id, specialization: p.specialization, fspState: 'not_linked', category: null,
      claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: cat.get(catalogId)?.statement ?? catalogId, quote: '' })) }));
    const r = rankCandidates(ev, { specialization: s.specialization, subcategoryId: s.id, grade: 'senior', needs: categoryNeeds(cat, s.specialization, 'senior'), stack: [] }, cat);
    const score = new Map(r.map((x) => [x.candidateId, x.score]));
    const sen = pool.filter((p) => p.category?.grade === 'senior'), mid = pool.filter((p) => p.category?.grade === 'middle');
    for (const a of sen) for (const b of mid) { pairs++; const d = (score.get(a.id) ?? 0) - (score.get(b.id) ?? 0); wins += d > 0 ? 1 : d === 0 ? 0.5 : 0; }
    const k = sen.length; top2 += r.slice(0, k).filter((x) => x.candidateId.includes('-s-')).length; n += k;
  }
  console.log(`${label}: Senior выше Middle в парах ${(wins / pairs).toFixed(3)} (${pairs} пар); доля Senior в топ-k ${(top2 / n).toFixed(3)} (${n})`);
}
run(before, 'до калибровки ');
run(after, 'после         ');

// --- синтетика: истинный Senior против истинного Middle, без категории теста ---
const syn = generateSynthetic(SYN_SEED);
function runSyn(cat: Map<string, CatalogEntry>, label: string) {
  const out: string[] = [];
  let pairsAll = 0, winsAll = 0;
  for (const spec of ['backend', 'frontend', 'ai', 'engineering'] as const) {
    const pool = syn.profiles.filter((p) => p.specialization === spec && (p.trueGrade === 'senior' || p.trueGrade === 'middle'));
    const ev: CandidateEvidence[] = pool.map((p) => ({ id: p.id, specialization: p.specialization, fspState: 'not_linked', category: null,
      claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: cat.get(catalogId)?.statement ?? catalogId, quote: '' })) }));
    const r = rankCandidates(ev, { specialization: spec, grade: 'senior', needs: categoryNeeds(cat, spec, 'senior'), stack: [] }, cat);
    const score = new Map(r.map((x) => [x.candidateId, x.score]));
    const sen = pool.filter((p) => p.trueGrade === 'senior'), mid = pool.filter((p) => p.trueGrade === 'middle');
    let pairs = 0, wins = 0;
    for (const a of sen) for (const b of mid) { pairs++; const d = (score.get(a.id) ?? 0) - (score.get(b.id) ?? 0); wins += d > 0 ? 1 : d === 0 ? 0.5 : 0; }
    pairsAll += pairs; winsAll += wins;
    out.push(`${spec} ${(wins / pairs).toFixed(3)} (S ${sen.length} / M ${mid.length})`);
  }
  console.log(`синтетика, ${label}: AUC Senior против Middle ${(winsAll / pairsAll).toFixed(3)}; ${out.join('; ')}`);
}
runSyn(before, 'до калибровки');
runSyn(after, 'после        ');

// Парный бутстреп по профилям (внутри специализации пересэмплируем Senior и Middle), 1000 повторов: Δ AUC после − до.
function scoresOf(cat: Map<string, CatalogEntry>, spec: 'backend' | 'frontend' | 'ai' | 'engineering', pool: typeof syn.profiles) {
  const ev: CandidateEvidence[] = pool.map((p) => ({ id: p.id, specialization: p.specialization, fspState: 'not_linked', category: null,
    claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: cat.get(catalogId)?.statement ?? catalogId, quote: '' })) }));
  const r = rankCandidates(ev, { specialization: spec, grade: 'senior', needs: categoryNeeds(cat, spec, 'senior'), stack: [] }, cat);
  return new Map(r.map((x) => [x.candidateId, x.score]));
}
let seed = 20261011;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const specs = (['backend', 'frontend', 'ai', 'engineering'] as const).map((spec) => {
  const pool = syn.profiles.filter((p) => p.specialization === spec && (p.trueGrade === 'senior' || p.trueGrade === 'middle'));
  return { sen: pool.filter((p) => p.trueGrade === 'senior').map((p) => p.id), mid: pool.filter((p) => p.trueGrade === 'middle').map((p) => p.id), b: scoresOf(before, spec, pool), a: scoresOf(after, spec, pool) };
});
const auc = (sc: Map<string, number>, sen: string[], mid: string[]) => {
  let w = 0;
  for (const x of sen) for (const y of mid) { const d = (sc.get(x) ?? 0) - (sc.get(y) ?? 0); w += d > 0 ? 1 : d === 0 ? 0.5 : 0; }
  return { w, n: sen.length * mid.length };
};
const diffs: number[] = [];
for (let i = 0; i < 1000; i++) {
  let wa = 0, wb = 0, n = 0;
  for (const s of specs) {
    const sen = s.sen.map(() => s.sen[Math.floor(rnd() * s.sen.length)]!), mid = s.mid.map(() => s.mid[Math.floor(rnd() * s.mid.length)]!);
    const A = auc(s.a, sen, mid), B = auc(s.b, sen, mid);
    wa += A.w; wb += B.w; n += A.n;
  }
  diffs.push((wa - wb) / n);
}
diffs.sort((x, y) => x - y);
console.log(`синтетика: Δ AUC после − до ${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(3)} [${diffs[25]!.toFixed(3)}; ${diffs[974]!.toFixed(3)}] (бутстреп 95 %)`);
