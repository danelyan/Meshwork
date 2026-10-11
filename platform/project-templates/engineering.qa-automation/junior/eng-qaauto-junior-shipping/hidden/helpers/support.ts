// PLATFORM-OWNED: хелперы скрытых тестов платформы; кандидату не выдаются
import type { Case, Order } from '../../src/types';

export type ShippingFn = (order: Order) => number;

/** Имена кейсов, на которых реализация не совпала с ожиданием (пустой массив — все прошли). */
export function runCases(impl: ShippingFn, cases: Case[]): string[] {
  const failed: string[] = [];
  for (const c of cases) {
    try {
      const got = impl(c.input);
      if (c.throws !== undefined || got !== c.expected) failed.push(c.name);
    } catch (e) {
      if (c.throws === undefined || (e as Error).message !== c.throws) failed.push(c.name);
    }
  }
  return failed;
}

/** Описания нарушений формы таблицы (пустой массив — форма корректна). */
export function formProblems(cases: unknown): string[] {
  if (!Array.isArray(cases)) return ['cases не массив'];
  const problems: string[] = [];
  const names = new Set<string>();
  cases.forEach((c, i) => {
    const where = `кейс #${i}`;
    if (!c || typeof c !== 'object') return void problems.push(`${where}: не объект`);
    if (typeof c.name !== 'string' || !c.name.trim()) problems.push(`${where}: нет name`);
    else if (names.has(c.name)) problems.push(`${where}: повтор name «${c.name}»`);
    else names.add(c.name);
    if (!c.input || typeof c.input !== 'object') problems.push(`${where}: нет input`);
    const hasExpected = c.expected !== undefined;
    const hasThrows = c.throws !== undefined;
    if (hasExpected === hasThrows) problems.push(`${where}: нужно ровно одно из expected / throws`);
    if (hasExpected && typeof c.expected !== 'number') problems.push(`${where}: expected не число`);
    if (hasThrows && typeof c.throws !== 'string') problems.push(`${where}: throws не строка`);
  });
  return problems;
}
