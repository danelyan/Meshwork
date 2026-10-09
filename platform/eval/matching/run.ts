// Валидация подбора работодателя (Q-07, критерий 1). Без БД и сети.
//   npx tsx eval/matching/run.ts            # таблица + eval/matching/results.json
//   npx tsx eval/matching/run.ts --no-write
// Ранжирует 16 профилей (8 демо-пула + 8 «трудных») под 8 демо-вакансий тем же
// кодом, что и кабинет (src/server/employer/ranking.ts), и сравнивает с разметкой
// labels.json (разметка агента, 3 уровня). Базовая линия — «больше подтверждённых
// утверждений своей специализации выше», без учёта требований вакансии.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEMO_POOL, type DemoProfile } from '../../prisma/seed/employer';
import { DEMO_VACANCIES } from '../../prisma/seed/recommend';
import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { rankCandidates, type CandidateEvidence } from '../../src/server/employer/ranking';

import { EXTRA_PROFILES } from './extra-profiles';
import { maxPrecisionAtK, ndcgAtK, precisionAtK } from './metrics';

const K = 5;
const here = dirname(fileURLToPath(import.meta.url));
const labels = JSON.parse(readFileSync(join(here, 'labels.json'), 'utf8')) as {
  candidates: string[];
  relevance: Record<string, Record<string, number>>;
};

const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
const profiles: DemoProfile[] = [...DEMO_POOL, ...EXTRA_PROFILES];
const evidence: CandidateEvidence[] = profiles.map((p) => ({
  id: p.id,
  specialization: p.specialization,
  fspState: p.fspState,
  category: p.category,
  claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: catalog.get(catalogId)?.statement ?? catalogId, quote: p.stack.join(', ') })),
}));

const missing = labels.candidates.filter((id) => !profiles.some((p) => p.id === id));
if (missing.length) throw new Error(`В разметке есть кандидаты без профиля: ${missing.join(', ')}`);

function baseline(spec: string): string[] {
  return [...evidence]
    .filter((c) => c.specialization === spec)
    .sort((a, b) => b.claims.length - a.claims.length || a.id.localeCompare(b.id))
    .map((c) => c.id);
}

interface Row { vacancy: string; p: number; pMax: number; ndcg: number; bP: number; bNdcg: number; top: string[] }
const rows: Row[] = [];
for (const v of DEMO_VACANCIES) {
  const rel = labels.relevance[v.id] ?? {};
  const ranked = rankCandidates(evidence, {
    specialization: v.specialization,
    grade: v.grade,
    needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })),
    stack: [],
  }, catalog).map((r) => r.candidateId);
  const b = baseline(v.specialization);
  rows.push({
    vacancy: v.id,
    p: precisionAtK(ranked, rel, K),
    pMax: maxPrecisionAtK(rel, K),
    ndcg: ndcgAtK(ranked, rel, K),
    bP: precisionAtK(b, rel, K),
    bNdcg: ndcgAtK(b, rel, K),
    top: ranked.slice(0, K),
  });
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const f = (x: number) => x.toFixed(3);
console.log(`Подбор: ${profiles.length} профилей × ${DEMO_VACANCIES.length} вакансий, k = ${K}\n`);
console.log('вакансия            P@5    потолок  nDCG@5 | база P@5  база nDCG@5');
for (const r of rows) console.log(`${r.vacancy.padEnd(18)}  ${f(r.p)}  ${f(r.pMax)}    ${f(r.ndcg)} | ${f(r.bP)}     ${f(r.bNdcg)}`);
const summary = {
  k: K,
  profiles: profiles.length,
  vacancies: rows.length,
  precisionAt5: mean(rows.map((r) => r.p)),
  precisionAt5Ceiling: mean(rows.map((r) => r.pMax)),
  ndcgAt5: mean(rows.map((r) => r.ndcg)),
  baseline: { precisionAt5: mean(rows.map((r) => r.bP)), ndcgAt5: mean(rows.map((r) => r.bNdcg)) },
};
console.log(`\nсреднее              ${f(summary.precisionAt5)}  ${f(summary.precisionAt5Ceiling)}    ${f(summary.ndcgAt5)} | ${f(summary.baseline.precisionAt5)}     ${f(summary.baseline.ndcgAt5)}`);
if (!process.argv.includes('--no-write')) {
  writeFileSync(join(here, 'results.json'), `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  console.log('\nзаписано: eval/matching/results.json');
}
