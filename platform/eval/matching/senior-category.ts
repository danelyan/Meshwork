// Отличает ли поиск по категории Senior от Middle (колонка S каталога, scripts/catalog-senior.json). Без БД и сети.
//   npx tsx eval/matching/senior-category.ts
// Демо-пул по категориям (prisma/seed/pool-*.ts): в каждой подкатегории Middle и Senior ранжируются под потребности
// категории Senior (categoryNeeds) БЕЗ категории теста — только по утверждениям. «До» — каталог без Senior-only записей
// и с весом Senior = Middle (как до 11.10). Оговорка: профили и их Senior-навыки написали мы — это проверка механики,
// не независимая валидация.
import { DEMO_POOL_CATEGORIES } from '../../prisma/seed/pool-categories';
import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { categoryNeeds, rankCandidates, type CandidateEvidence } from '../../src/server/employer/ranking';
import { SUBCATEGORIES } from '../../src/lib/directions';
import type { CatalogEntry } from '../../src/server/claims/types';

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
