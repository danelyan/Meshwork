// Сравнение двух кандидатов подборки «Почему A выше B» (чистая функция, без БД).
// Новых весов нет: берутся уже посчитанные вклады формулы ranking.ts (покрытие + boosts), балл в п. = score × 100.
import type { RankedCandidate } from './ranking';

export const POINTS_PER_SCORE = 100;

/** Порог, ниже которого поправка честности (множитель) считается отсутствующей: балл округлён до 1e-4. */
const RESIDUAL_EPS = 0.0005;

export type CompareSide = Pick<RankedCandidate, 'candidateId' | 'score' | 'coverageScore' | 'boosts'>;

export interface CompareFactor {
  key: string;
  /** Название фактора - как в объяснении подборки. */
  label: string;
  /** Вклад в баллы (п.). */
  a: number;
  b: number;
  /** a - b, в п. */
  diff: number;
}

export interface Comparison {
  aId: string;
  bId: string;
  aScore: number;
  bScore: number;
  /** aScore - bScore, п. (может быть отрицательной, если A ниже B). */
  diff: number;
  factors: CompareFactor[];
  /** Факторы, давшие самую большую долю разницы в сторону лидера (до 3), ключи factors. */
  advantage: string[];
  /** Строка «Разница +N п. Преимущество: …». */
  headline: string;
}

const pts = (x: number) => Math.round(x * POINTS_PER_SCORE * 10) / 10;

export function formatPoints(n: number): string {
  const s = Math.abs(n).toFixed(1).replace('.', ',');
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${s}`;
}

type Extract = (c: CompareSide) => number | undefined;
const FACTORS: { key: string; label: string; get: Extract }[] = [
  { key: 'coverage', label: 'Покрытие требований', get: (c) => c.coverageScore },
  { key: 'category', label: 'Категория из теста', get: (c) => c.boosts.category },
  { key: 'fsp', label: 'Достижения ФСП', get: (c) => c.boosts.fsp },
  { key: 'stack', label: 'Стек', get: (c) => c.boosts.stack },
  { key: 'project', label: 'Проект под потребность', get: (c) => c.boosts.project },
  { key: 'calls', label: 'Темы созвона', get: (c) => c.boosts.calls },
  { key: 'semantic', label: 'Смежные навыки', get: (c) => c.boosts.semantic },
  { key: 'spec', label: 'Другая специализация', get: (c) => (c.boosts.specPenalty ? -c.boosts.specPenalty : 0) },
];

/** Остаток между баллом и суммой факторов: множитель проверки честности (ranking.ts integrityPenalty). */
function residual(c: CompareSide): number {
  const sum = FACTORS.reduce((s, f) => s + (f.get(c) ?? 0), 0);
  const r = c.score - sum;
  return Math.abs(r) > RESIDUAL_EPS ? r : 0;
}

/**
 * Разница баллов A и B по факторам формулы. Лидер - тот, у кого балл выше; «Преимущество» - до трёх факторов,
 * где лидер впереди сильнее всего. Равные баллы - без преимущества.
 */
export function compareCandidates(a: CompareSide, b: CompareSide): Comparison {
  const factors: CompareFactor[] = FACTORS.map((f) => ({ key: f.key, label: f.label, a: pts(f.get(a) ?? 0), b: pts(f.get(b) ?? 0), diff: 0 }));
  const ra = residual(a);
  const rb = residual(b);
  if (ra || rb) factors.push({ key: 'integrity', label: 'Поправка проверки честности', a: pts(ra), b: pts(rb), diff: 0 });
  // Фактор, нулевой у обоих, в таблице не нужен.
  const rows = factors.filter((f) => f.a !== 0 || f.b !== 0 || f.key === 'coverage');
  for (const f of rows) f.diff = Math.round((f.a - f.b) * 10) / 10;
  const diff = Math.round((pts(a.score) - pts(b.score)) * 10) / 10;
  const sign = diff >= 0 ? 1 : -1;
  const lead = diff === 0
    ? []
    : rows
        .filter((f) => f.diff * sign > 0)
        .sort((x, y) => y.diff * sign - x.diff * sign)
        .slice(0, 3);
  const advantage = lead.map((f) => f.key);
  const who = diff >= 0 ? 'A' : 'B';
  const headline = diff === 0
    ? 'Разница 0 п. Баллы равны.'
    : `Разница ${formatPoints(Math.abs(diff))} п. в пользу ${who}.${lead.length ? ` Преимущество: ${lead.map((f) => `${f.label[0]!.toLowerCase()}${f.label.slice(1)} ${formatPoints(Math.abs(f.diff))}`).join(', ')}.` : ''}`;
  return { aId: a.candidateId, bId: b.candidateId, aScore: pts(a.score), bScore: pts(b.score), diff, factors: rows, advantage, headline };
}
