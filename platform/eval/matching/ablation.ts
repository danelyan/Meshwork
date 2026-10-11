// Абляция подбора: выключаем по одному сигналу формулы (RankOptions.ablate в ranking.ts) и смотрим, на сколько
// падают P@5 и nDCG@10 на расширенном наборе (247 профилей × 24 вакансии, разметка — скрытая истина генератора).
//   npx tsx eval/matching/ablation.ts [--no-write]     # таблица + ключ ablation в eval/matching/results.json
// Без БД и сети. Разметка — одним агентом/генератором: цифры показывают вклад сигнала в ЭТОМ наборе, не в мире.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { ABLATION_SIGNALS, dropUncovered, rankCandidates, type AblationSignal, type CandidateEvidence } from '../../src/server/employer/ranking';

import { bootstrapDiff, bootstrapMean, ndcgAtK, precisionAtK, type Interval } from './metrics';
import { generateSynthetic, SYN_SEED } from './synthetic';

const REPS = 1000;
const here = dirname(fileURLToPath(import.meta.url));
const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
const syn = generateSynthetic(SYN_SEED);
const evidence: CandidateEvidence[] = syn.profiles.map((p) => ({
  id: p.id, specialization: p.specialization, fspState: p.fspState, category: p.category,
  claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: catalog.get(catalogId)?.statement ?? catalogId, quote: p.stack.join(', ') })),
}));

const SIGNAL_LABEL: Record<AblationSignal, string> = {
  coverage: 'покрытие требований вакансии',
  proven: 'доказанность (вес уровня подтверждения)',
  category: 'категория из теста (база и множитель грейда)',
  fsp: 'достижения ФСП',
  stack: 'метки стека (точные и близкие технологии)',
  stack_partial: 'близкие технологии (частичный зачёт стека)',
  spec_penalty: 'штраф за другую специализацию',
  project: 'проверенный проект (ADR 0003)',
  calls: 'темы, подтверждённые созвоном (ADR 0003)',
};
/** Сигналы без данных в оценочном наборе: профили не несут проектов и созвонов — вклад в этом прогоне не измеряется. */
const NOT_IN_SET: AblationSignal[] = ['project', 'calls'];

type Per = { p5: number[]; ndcg10: number[] };
function run(ablate: AblationSignal[]): Per {
  const per: Per = { p5: [], ndcg10: [] };
  for (const v of syn.vacancies) {
    const rel = syn.relevance[v.id] ?? {};
    const ranked = dropUncovered(rankCandidates(evidence, {
      specialization: v.specialization, grade: v.grade, needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })), stack: v.stack,
    }, catalog, {}, { ablate })).map((r) => r.candidateId);
    per.p5.push(precisionAtK(ranked, rel, 5));
    per.ndcg10.push(ndcgAtK(ranked, rel, 10));
  }
  return per;
}

const full = run([]);
export interface AblationRow { signal: AblationSignal | 'full'; label: string; p5: Interval; ndcg10: Interval; dP5: Interval | null; dNdcg10: Interval | null; measured: boolean }
const rows: AblationRow[] = [{ signal: 'full', label: 'полная формула', p5: bootstrapMean(full.p5, REPS, SYN_SEED + 1), ndcg10: bootstrapMean(full.ndcg10, REPS, SYN_SEED + 2), dP5: null, dNdcg10: null, measured: true }];
ABLATION_SIGNALS.forEach((s, i) => {
  const a = run([s]);
  // Δ = без сигнала − полная формула (отрицательная — сигнал помогает); парный бутстреп по вакансиям.
  rows.push({
    signal: s, label: SIGNAL_LABEL[s], p5: bootstrapMean(a.p5, REPS, SYN_SEED + 10 + i), ndcg10: bootstrapMean(a.ndcg10, REPS, SYN_SEED + 40 + i),
    dP5: bootstrapDiff(a.p5, full.p5, REPS, SYN_SEED + 70 + i), dNdcg10: bootstrapDiff(a.ndcg10, full.ndcg10, REPS, SYN_SEED + 100 + i), measured: !NOT_IN_SET.includes(s),
  });
});

const f = (x: number) => x.toFixed(3);
const d = (i: Interval | null) => (i ? `${i.mean >= 0 ? '+' : ''}${f(i.mean)} [${f(i.lo)}; ${f(i.hi)}]` : '-');
console.log(`Абляция: ${syn.profiles.length} профилей × ${syn.vacancies.length} вакансий, seed ${SYN_SEED}`);
console.log('режим                                                P@5     nDCG@10  ΔP@5 [95 %]                ΔnDCG@10 [95 %]');
for (const r of rows) console.log(`${r.label.padEnd(50)}  ${f(r.p5.mean)}   ${f(r.ndcg10.mean)}    ${d(r.dP5).padEnd(26)} ${d(r.dNdcg10)}${r.measured ? '' : '  (нет данных в наборе)'}`);

if (!process.argv.includes('--no-write')) {
  const path = join(here, 'results.json');
  const prev = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  prev.ablation = {
    note: 'Абляция (скрипт eval/matching/ablation.ts): сигнал выключается через RankOptions.ablate, остальная формула прежняя. Δ = без сигнала − полная формула, парный бутстреп по 24 вакансиям, 1000 повторов, 95 %. Разметка — скрытая истина генератора (одна схема, не независимые эксперты); набор синтетический, проектов и созвонов в нём нет.',
    seed: SYN_SEED, profiles: syn.profiles.length, vacancies: syn.vacancies.length, reps: REPS, rows,
  };
  writeFileSync(path, `${JSON.stringify(prev, null, 2)}\n`);
  console.log('\nзаписано: eval/matching/results.json (ключ ablation)');
}
