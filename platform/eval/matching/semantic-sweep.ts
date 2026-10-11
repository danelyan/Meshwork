// Подбор веса семантического сигнала (semantic.ts, R-N-02) на расширенном наборе: P@5, nDCG@10, Recall@50 и число
// вакансий, где наш подбор хуже BM25 больше чем на 0,05 (P@10 или nDCG@10) — тот же критерий, что в run.ts.
//   npx tsx eval/matching/semantic-sweep.ts [веса через запятую] [--write]   # --write: ключ semantic в results.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { dropUncovered, rankCandidates, type CandidateEvidence } from '../../src/server/employer/ranking';

import { bm25Rank } from './bm25';
import { ndcgAtK, precisionAtK, recallAtK } from './metrics';
import { generateSynthetic, SYN_SEED } from './synthetic';

const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
const syn = generateSynthetic(SYN_SEED);
const ev: CandidateEvidence[] = syn.profiles.map((p) => ({
  id: p.id, specialization: p.specialization, fspState: p.fspState, category: p.category,
  claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: catalog.get(catalogId)?.statement ?? catalogId, quote: p.stack.join(', ') })),
}));
const docs = syn.profiles.map((p) => ({ id: p.id, text: p.text }));
const bm = new Map(syn.vacancies.map((v) => [v.id, bm25Rank(docs, v.text).map((d) => d.id)]));
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export function sweep(weights: number[]) {
  return weights.map((w) => {
    const p5: number[] = [], nd: number[] = [], r50: number[] = [];
    let worse = 0;
    for (const v of syn.vacancies) {
      const rel = syn.relevance[v.id] ?? {};
      const ranked = dropUncovered(rankCandidates(ev, { specialization: v.specialization, grade: v.grade, needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })), stack: v.stack }, catalog, {}, { semantic: w > 0, semanticWeight: w })).map((r) => r.candidateId);
      const b = bm.get(v.id)!;
      p5.push(precisionAtK(ranked, rel, 5)); nd.push(ndcgAtK(ranked, rel, 10));
      const r = recallAtK(ranked, rel, 50); if (r !== null) r50.push(r);
      if (precisionAtK(ranked, rel, 10) < precisionAtK(b, rel, 10) - 0.05 || ndcgAtK(ranked, rel, 10) < ndcgAtK(b, rel, 10) - 0.05) worse++;
    }
    return { weight: w, p5: mean(p5), ndcg10: mean(nd), recall50: mean(r50), worseThanBm25: worse };
  });
}

if (process.argv[1]?.endsWith('semantic-sweep.ts')) {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const rows = sweep(arg ? arg.split(',').map(Number) : [0, 0.05, 0.1, 0.15, 0.2]);
  console.log('вес    P@5    nDCG@10  Recall@50  хуже BM25');
  for (const r of rows) console.log(`${r.weight.toFixed(2)}   ${r.p5.toFixed(3)}  ${r.ndcg10.toFixed(3)}    ${r.recall50.toFixed(3)}      ${r.worseThanBm25}`);
  if (process.argv.includes('--write')) {
    const path = join(dirname(fileURLToPath(import.meta.url)), 'results.json');
    const prev = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    prev.semantic = {
      note: 'Семантический сигнал (semantic.ts): вес 0 = формула по умолчанию (сигнал выключен). Расширенный набор, без бутстрепа; «хуже BM25» — вакансий, где P@10 или nDCG@10 ниже BM25 больше чем на 0,05 (как в run.ts).',
      seed: SYN_SEED, profiles: syn.profiles.length, vacancies: syn.vacancies.length, rows,
    };
    writeFileSync(path, `${JSON.stringify(prev, null, 2)}\n`);
    console.log('записано: eval/matching/results.json (ключ semantic)');
  }
}
