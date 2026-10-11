// Общие помощники семейств backend (банк-2, решение владельца 11.10: ~26 семейств на подкатегорию).
// Ответ всегда считает код генератора; a, b – ПРЕДЛОЖЕНИЕ (экспертные), не калибровка по людям.
import type { TaskGenerator } from '../types';

type Meta = Pick<TaskGenerator, 'grade' | 'catalogIds' | 'format' | 'a' | 'b' | 'paramSpace' | 'timeLimitSec'> & {
  slug: string;
  title: string;
  sub: 'web-api' | 'integrations' | 'highload' | 'data-model';
};

export function fam(m: Meta, generate: TaskGenerator['generate']): TaskGenerator {
  return {
    id: `be.${m.slug}`,
    taskId: `task:${m.slug}`,
    title: m.title,
    specialization: 'backend',
    subcategoryId: `backend.${m.sub}`,
    grade: m.grade,
    catalogIds: m.catalogIds,
    format: m.format,
    a: m.a,
    b: m.b,
    paramSpace: m.paramSpace,
    timeLimitSec: m.timeLimitSec,
    generate,
  };
}

/** Повторять розыгрыш, пока результат допустим (например, нет округления «ровно .5»). Детерминированно: rng сдвигается. */
export function until<T>(draw: () => T, ok: (v: T) => boolean, max = 40): T {
  let v = draw();
  for (let i = 0; i < max && !ok(v); i++) v = draw();
  return v;
}

/** Не на границе округления до целого. */
export const notHalf = (x: number): boolean => Math.abs((x % 1) - 0.5) > 0.03;

export function mono(rows: string[]): string {
  return rows.join('\n');
}
