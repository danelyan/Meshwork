import { z } from 'zod';

import type { MatchFilters } from './ranking';
import { normalizeStack } from './ranking';
import { DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT } from './weights';

export const SpecializationSchema = z.enum(['backend', 'frontend']);
export const GradeSchema = z.enum(['junior', 'middle']);

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** Потребность (R-E-02). Поля Vacancy онбординга не меняются, только добавлены teamDescription и stack. */
export const VacancyInput = z
  .object({
    title: z.string().trim().min(3, 'Не короче 3 символов').max(120),
    specialization: SpecializationSchema,
    grade: GradeSchema,
    salaryFrom: z.number().int().min(0).max(10_000_000),
    salaryTo: z.number().int().min(0).max(10_000_000),
    teamDescription: optText(2000),
    description: optText(2000),
    stack: z.array(z.string().max(40)).max(15).default([]).transform(normalizeStack),
    needs: z
      .array(z.object({ catalogId: z.string().min(1).max(64), weight: z.number().int().min(1).max(3) }))
      .min(1, 'Выбери хотя бы одно требование')
      .max(25),
  })
  .refine((v) => v.salaryTo >= v.salaryFrom, { error: 'Верхняя граница вилки меньше нижней', path: ['salaryTo'] });
export type VacancyInput = z.infer<typeof VacancyInput>;

export const VacancyPatch = z.object({ archived: z.boolean() });

/**
 * Приглашение (R-E-05, ТЗ 2.2): описание и вилка «от–до» в ₽ обязательны, потребность — нет.
 * Способ связи компании берётся из Company.contact, в теле не передаётся.
 */
export const InvitationInput = z
  .object({
    candidateId: z.string().min(1).max(64),
    vacancyId: z.string().min(1).max(64).nullish(),
    message: z.string().trim().min(10, 'Опиши задачу хотя бы в 10 символах').max(2000),
    salaryFrom: z.number().int().min(1, 'Укажи зарплату «от»').max(10_000_000),
    salaryTo: z.number().int().min(1, 'Укажи зарплату «до»').max(10_000_000),
  })
  .refine((v) => v.salaryTo >= v.salaryFrom, { error: 'Зарплата «до» меньше «от»', path: ['salaryTo'] });

export const InvitationAction = z.object({ action: z.enum(['accept', 'decline']) });

export const PrivacyInput = z.object({ hiddenFromEmployers: z.boolean() });

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Фильтры выдачи из query-параметров (R-M-04: уточнение = новый URL, прежняя выдача
 * остаётся в истории). Неизвестное значение отбрасывается, а не ломает страницу.
 */
export function parseFilters(raw: Raw): { filters: MatchFilters; limit: number } {
  const spec = SpecializationSchema.safeParse(first(raw.spec));
  const grade = GradeSchema.safeParse(first(raw.grade));
  const stackRaw = first(raw.stack) ?? '';
  const stack = normalizeStack(stackRaw.split(',')).slice(0, 10);
  const limitN = Number(first(raw.limit));
  const filters: MatchFilters = {};
  if (spec.success) filters.specialization = spec.data;
  if (grade.success) filters.grade = grade.data;
  if (stack.length) filters.stack = stack;
  if (first(raw.fsp) === '1') filters.fsp = true;
  if (first(raw.category) === '1') filters.categoryOnly = true;
  const limit = Number.isInteger(limitN) && limitN > 0 ? Math.min(limitN, MAX_RESULT_LIMIT) : DEFAULT_RESULT_LIMIT;
  return { filters, limit };
}

export function searchParamsRecord(url: URL): Raw {
  const out: Raw = {};
  for (const [k, v] of url.searchParams) out[k] = v;
  return out;
}

/** Обратно в query-строку (для ссылок «уточнить» и истории). */
export function filtersToQuery(f: MatchFilters): string {
  const p = new URLSearchParams();
  if (f.specialization) p.set('spec', f.specialization);
  if (f.grade) p.set('grade', f.grade);
  if (f.stack?.length) p.set('stack', f.stack.join(','));
  if (f.fsp) p.set('fsp', '1');
  if (f.categoryOnly) p.set('category', '1');
  return p.toString();
}
