/** Обезличенный CSV (E-08, фаза 5): только агрегаты, ни имён, ни почт, ни телефонов, ни id людей. */

/** Ячейка: кавычки и защита от формул Excel (=, +, -, @ в начале). */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** k-анонимность: группы меньше порога не раскрываем (мало людей – можно узнать по категории). */
export const MIN_GROUP = 5;
export const maskSmall = (n: number): string | number => (n < MIN_GROUP ? `<${MIN_GROUP}` : n);

export const round = (x: number | null, d = 3): number | null => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
