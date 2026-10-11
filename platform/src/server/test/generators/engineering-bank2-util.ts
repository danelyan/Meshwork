// Общие помощники второго пакета семейств engineering (решение владельца 11.10: ~26 семейств на подкатегорию).
// Ответ – всегда результат кода генератора; параметры a, b – экспертные, как в engineering.ts.
import type { Rng } from '../rng';
import { createRng } from '../rng';
import type { AnswerFormat, TaskGenerator, TaskInstance } from '../types';

export interface FamOpts {
  /** Без префикса «eng.»: итоговый id = eng.<id>, taskId = task:<id>. */
  id: string;
  title: string;
  sub: 'data-eng' | 'devops' | 'qa-automation' | 'sre';
  grade: TaskGenerator['grade'];
  cat: string[];
  format: AnswerFormat;
  hint: string;
  a: number;
  b: number;
  /** Порядок мощности пространства экземпляров. */
  space: number;
  time: number;
}

export type Body = Omit<TaskInstance, 'answerHint'>;

export function fam(o: FamOpts, gen: (rng: Rng, seed: number) => Body): TaskGenerator {
  return {
    id: `eng.${o.id}`,
    taskId: `task:${o.id}`,
    title: o.title,
    specialization: 'engineering',
    subcategoryId: `engineering.${o.sub}`,
    grade: o.grade,
    catalogIds: o.cat,
    format: o.format,
    a: o.a,
    b: o.b,
    paramSpace: o.space,
    timeLimitSec: o.time,
    generate(seed) {
      const body = gen(createRng(seed), seed);
      return { ...body, answerHint: o.hint };
    },
  };
}

export function table(name: string, cols: string[], rows: (string | number)[][]): string {
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells: (string | number)[]) => cells.map((c, i) => String(c).padEnd(w[i]!)).join(' | ');
  return [name, line(cols), w.map((x) => '-'.repeat(x)).join('-+-'), ...rows.map(line)].join('\n');
}

export function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Номера через запятую по возрастанию (канонический вид list). */
export function listKey(nums: number[]): string {
  return [...nums].sort((x, y) => x - y).join(',');
}

/** Число с d знаками без хвоста нулей: «0.5», «12». */
export function num(x: number, d = 1): string {
  return String(Number(x.toFixed(d)));
}

export const SERVICES = ['billing', 'catalog', 'checkout', 'profile', 'search', 'delivery', 'notify', 'auth'];
export const NAMES = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дарья', 'Егор', 'Жанна', 'Захар', 'Инна', 'Кирилл', 'Лев', 'Мария'];

/**
 * Случайный DAG из n узлов: узел i зависит от 1–2 более ранних (индексы по возрастанию = топологический порядок).
 * parents[i] – индексы родителей.
 */
export function randomDag(rng: Rng, n: number, maxParents = 2): number[][] {
  const parents: number[][] = [[]];
  for (let i = 1; i < n; i++) {
    const k = rng.int(1, Math.min(maxParents, i));
    parents.push(rng.sample(Array.from({ length: i }, (_, j) => j), k).sort((x, y) => x - y));
  }
  return parents;
}
