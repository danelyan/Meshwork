import type { ExtractedDoc, SourceKind } from '@/server/collector/types';
import type { CatalogEntry } from '@/server/claims/types';

export function doc(lines: (string | { text: string; hidden?: boolean })[], opts?: { kind?: SourceKind; origin?: string }): ExtractedDoc {
  const origin = opts?.origin ?? 'cv.pdf';
  const ls = lines.map((l, i) => (typeof l === 'string' ? { ref: `${origin}#l${i + 1}`, text: l } : { ref: `${origin}#l${i + 1}`, ...l }));
  return {
    sourceKind: opts?.kind ?? 'resume',
    title: origin,
    origin,
    lines: ls,
    text: ls.map((l) => l.text).join('\n'),
    flags: {},
    fetchedAt: '2026-10-09T00:00:00.000Z',
  };
}

export const CATALOG: CatalogEntry[] = [
  {
    id: 'be.idempotency',
    specialization: 'backend',
    statement: 'Делал обработку повторных запросов идемпотентной',
    grades: ['middle'],
    weight: 3,
    proof: ['task:payment-retry', 'interview:defend'],
    markers: ['идемпотентность', 'idempotency key'],
    limits: 'Не доказывает: работу под нагрузкой',
  },
  {
    id: 'be.cache',
    specialization: 'backend',
    statement: 'Кэшировал данные',
    grades: ['junior', 'middle'],
    weight: 2,
    proof: ['interview:defend'],
    markers: ['Redis', 'кэш'],
    limits: 'Не доказывает: распределённый кэш',
  },
  {
    id: 'fe.ssr',
    specialization: 'frontend',
    statement: 'Делал серверный рендеринг',
    grades: ['middle'],
    weight: 2,
    proof: ['interview:defend'],
    markers: ['SSR', 'Next.js'],
    limits: 'Не доказывает: производительность',
  },
  {
    id: 'common.git',
    specialization: 'common',
    statement: 'Работал в Git',
    grades: ['junior', 'middle'],
    weight: 2,
    proof: ['task:git-history'],
    markers: ['Git', 'rebase', 'pull request'],
    limits: 'Не доказывает: культуру ревью',
  },
];
