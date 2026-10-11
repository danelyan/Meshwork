// Пример для /evaluate («Загрузить пример»): тот же набор, что eval/matching/run.ts – демо-пул сида,
// «трудные» профили eval и демо-вакансии, разметка агента labels.json. Формат – вход POST /api/evaluate.
import { DEMO_POOL, type DemoProfile } from '../../../prisma/seed/employer';
import { DEMO_VACANCIES } from '../../../prisma/seed/recommend';
import labels from '../../../eval/matching/labels.json';
import { EXTRA_PROFILES } from '../../../eval/matching/extra-profiles';

import type { EvaluateInput } from './evaluate';

interface Labels {
  relevance: Record<string, Record<string, number>>;
}

/** Демо-набор во входном формате /evaluate (k = 5, как в eval/matching/run.ts). */
export function sampleDataset(): EvaluateInput {
  const profiles: DemoProfile[] = [...DEMO_POOL, ...EXTRA_PROFILES];
  const known = new Set(profiles.map((p) => p.id));
  const relevance: Record<string, Record<string, 0 | 1 | 2>> = {};
  for (const v of DEMO_VACANCIES) {
    const row = (labels as unknown as Labels).relevance[v.id] ?? {};
    relevance[v.id] = Object.fromEntries(Object.entries(row).filter(([id]) => known.has(id)).map(([id, r]) => [id, Math.max(0, Math.min(2, r)) as 0 | 1 | 2]));
  }
  return {
    k: 5,
    vacancies: DEMO_VACANCIES.map((v) => ({
      id: v.id,
      title: v.title,
      specialization: v.specialization,
      grade: v.grade,
      needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })),
    })),
    candidates: profiles.map((p) => ({
      id: p.id,
      specialization: p.specialization,
      fspState: p.fspState,
      category: p.category,
      stack: p.stack,
      claims: p.claims.map(([catalogId, level]) => ({ catalogId, level })),
    })),
    relevance,
  };
}
