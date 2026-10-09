import type { RangeSpec } from '@/server/onboarding/types';

export interface SalaryRange {
  from: number;
  to: number;
}

/** Типовые вилки (тыс ₽/мес) — чипами под репликой; отбираются те, что влезают в шкалу шага. */
const PRESETS: SalaryRange[] = [
  { from: 60, to: 100 },
  { from: 100, to: 150 },
  { from: 150, to: 200 },
  { from: 200, to: 300 },
  { from: 300, to: 450 },
];

export function salaryChips(spec: RangeSpec): SalaryRange[] {
  return PRESETS.filter((r) => r.from >= spec.min && r.to <= spec.max);
}

/** «150–200 тыс ₽ / мес». */
export function salaryText(r: SalaryRange, spec: RangeSpec): string {
  return r.from === r.to ? `${r.from} ${spec.unit}` : `${r.from}–${r.to} ${spec.unit}`;
}

/**
 * Свободный ввод зарплаты в композере: «150–200», «от 150 до 220 тыс», «180к», «200 000 ₽».
 * Числа от 1000 считаются рублями и переводятся в тысячи. Одно число — «ожидаю ровно столько».
 * Возвращает диапазон на шкале шага или текст ошибки (сервер проверяет то же самое).
 */
export function parseSalary(text: string, spec: RangeSpec): SalaryRange | { error: string } {
  const nums = [...text.replace(/(\d)[\s ](?=\d{3}\b)/g, '$1').matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
  if (nums.length === 0) return { error: `Напиши сумму числом, например «${spec.defaults.from}–${spec.defaults.to}» (тыс ₽ в месяц).` };
  const k = nums.map((n) => Math.round(n >= 1000 ? n / 1000 : n));
  const from = Math.min(...k.slice(0, 2));
  const to = Math.max(...k.slice(0, 2));
  if (from < spec.min || to > spec.max) return { error: `Диапазон — от ${spec.min} до ${spec.max} тыс ₽ в месяц. Поправь сумму.` };
  return { from, to };
}
