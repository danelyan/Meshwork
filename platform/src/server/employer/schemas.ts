import { z } from 'zod';

import { getSubcategory, SPECIALIZATIONS } from '@/lib/directions';
import type { MatchFilters } from './ranking';
import { normalizeStack } from './ranking';
import { DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT } from './weights';
import { GRADES } from '@/lib/grades';

export const SpecializationSchema = z.enum(SPECIALIZATIONS);
/** Значение spec для представления «Fullstack» (не специализация каталога). */
export const FULLSTACK = 'fullstack';
export const GradeSchema = z.enum(GRADES);

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
    /** R-D-01: вилка обязательна и ненулевая — принятый отклик копирует её в приглашение без ввода работодателя. */
    salaryFrom: z.number().int().min(1, 'Укажи зарплату «от»').max(10_000_000),
    salaryTo: z.number().int().min(1, 'Укажи зарплату «до»').max(10_000_000),
    teamDescription: optText(2000),
    description: optText(2000),
    stack: z.array(z.string().max(40)).max(15).default([]).transform(normalizeStack),
    /**
     * lane directions: подкатегория из справочника, обязательна (подборка ищет по ней; ADR 0003, дополнение
     * 10.10 15:50) и должна принадлежать направлению.
     */
    subcategoryId: z.string({ error: 'Выбери подкатегорию' }).min(1, 'Выбери подкатегорию').max(64),
    needs: z
      .array(z.object({ catalogId: z.string().min(1).max(64), weight: z.number().int().min(1).max(3) }))
      .min(1, 'Выбери хотя бы одно требование')
      .max(25),
  })
  .refine((v) => v.salaryTo >= v.salaryFrom, { error: 'Верхняя граница вилки меньше нижней', path: ['salaryTo'] })
  .refine((v) => getSubcategory(v.subcategoryId)?.specialization === v.specialization, {
    error: 'Подкатегория не из справочника этого направления',
    path: ['subcategoryId'],
  });
export type VacancyInput = z.infer<typeof VacancyInput>;

export const VacancyPatch = z.object({ archived: z.boolean() });

/**
 * Приглашение (R-E-05, ТЗ 2.2): описание и вилка «от–до» в ₽ обязательны, потребность – нет.
 * Способ связи компании берётся из Company.contact, в теле не передаётся.
 */
/** lane admin (E-08, фаза 5): откуда работодатель отправил приглашение – для метрики «доля принятых из топ-N». */
export const MATCH_SOURCES = ['matching', 'search', 'favorites', 'assistant', 'other'] as const;
export type MatchSource = (typeof MATCH_SOURCES)[number];

export const InvitationInput = z
  .object({
    candidateId: z.string().min(1).max(64),
    vacancyId: z.string().min(1).max(64).nullish(),
    message: z.string().trim().min(10, 'Опиши задачу хотя бы в 10 символах').max(2000),
    salaryFrom: z.number().int().min(1, 'Укажи зарплату «от»').max(10_000_000),
    salaryTo: z.number().int().min(1, 'Укажи зарплату «до»').max(10_000_000),
    /** Позиция кандидата в подборке/поиске на момент отправки (1 = первый). Подсказка клиента: только для метрики, решений по ней нет. */
    matchRank: z.number().int().min(1).max(1000).nullish(),
    matchSource: z.enum(MATCH_SOURCES).nullish(),
  })
  .refine((v) => v.salaryTo >= v.salaryFrom, { error: 'Зарплата «до» меньше «от»', path: ['salaryTo'] });

/** lane invite-cancel: отзыв приглашения работодателем – причина обязательна, до 300 знаков (видна кандидату). */
export const WithdrawInvitationInput = z.object({ reason: z.string().trim().min(3, 'Напиши причину отзыва').max(300, 'Причина - до 300 знаков') });

/**
 * Ответ на приглашение. accept – только с `disclosureVersion`: кандидат отдельно подтверждает раскрытие имени и
 * контактов этому работодателю (Г5, ADR 0005; версия – CONSENT_TEXTS.identity_disclosure.version).
 */
export const InvitationAction = z.object({ action: z.enum(['accept', 'decline']), disclosureVersion: z.string().min(1).max(64).optional() });

/** lane complaints: жалоба кандидата на полученное приглашение (R-X-01). */
export const COMPLAINT_REASONS = ['spam', 'salary_mismatch', 'offensive', 'fake_company', 'other'] as const;
export const ComplaintInput = z.object({ reason: z.enum(COMPLAINT_REASONS), comment: optText(1000) });

export const PrivacyInput = z.object({ hiddenFromEmployers: z.boolean() });

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Фильтры выдачи из query-параметров (R-M-04: уточнение = новый URL, прежняя выдача
 * остаётся в истории). Неизвестное значение отбрасывается, а не ломает страницу.
 */
export function parseFilters(raw: Raw, maxLimit: number = MAX_RESULT_LIMIT): { filters: MatchFilters; limit: number } {
  // ПРЕДЛОЖЕНИЕ агента: spec=fullstack - представление «backend + frontend» (fullstack.ts), не новое направление.
  const fullstack = first(raw.spec) === FULLSTACK;
  const spec = SpecializationSchema.safeParse(first(raw.spec));
  const grade = GradeSchema.safeParse(first(raw.grade));
  const stackRaw = first(raw.stack) ?? '';
  const stack = normalizeStack(stackRaw.split(',')).slice(0, 10);
  const limitN = Number(first(raw.limit));
  const filters: MatchFilters = {};
  if (fullstack) filters.fullstack = true;
  else if (spec.success) filters.specialization = spec.data;
  if (grade.success) filters.grade = grade.data;
  if (stack.length) filters.stack = stack;
  if (first(raw.fsp) === '1') filters.fsp = true;
  // pool=all – явное расширение пула кандидатами без категории (M05). Прежний category=1 («только с категорией»)
  // совпадает с режимом по умолчанию и принимается как no-op, чтобы старые ссылки не ломались.
  if (first(raw.pool) === 'all' || first(raw.untested) === '1') filters.expandPool = true; // untested=1 – синоним из main 11.10
  // Подкатегория – только из справочника и только вместе со своим направлением (иначе отбрасывается).
  const sub = getSubcategory(first(raw.sub));
  if (sub && !fullstack && (!filters.specialization || filters.specialization === sub.specialization)) {
    filters.specialization = sub.specialization;
    filters.subcategory = sub.id;
  }
  const limit = Number.isInteger(limitN) && limitN > 0 ? Math.min(limitN, maxLimit) : DEFAULT_RESULT_LIMIT;
  return { filters, limit };
}

export function searchParamsRecord(url: URL): Raw {
  const out: Raw = {};
  for (const [k, v] of url.searchParams) out[k] = v;
  return out;
}

/**
 * Потолок выдачи на странице «Поиск по базе». Страница догружает кандидатов ростом `limit` в адресе («Показать ещё»),
 * поэтому её потолок выше, чем у API (MAX_RESULT_LIMIT): иначе кандидаты за первой страницей недоступны.
 */
export const SEARCH_PAGE_MAX_LIMIT = 300;

export interface LoadMoreLinks {
  /** Следующая порция: `add` - сколько кандидатов добавится. */
  next: { href: string; add: number } | null;
  /** Вся доступная выдача сразу: `count` - сколько станет показано (меньше total, если упёрлись в потолок). */
  all: { href: string; count: number } | null;
}

/** Ссылки дозагрузки выдачи: те же фильтры, больший `limit`. Оба null - показано всё, что страница может показать. */
export function loadMoreLinks(basePath: string, filters: MatchFilters, shown: number, total: number, max: number = SEARCH_PAGE_MAX_LIMIT, step: number = DEFAULT_RESULT_LIMIT): LoadMoreLinks {
  const reachable = Math.min(total, max);
  if (shown >= reachable) return { next: null, all: null };
  const query = filtersToQuery(filters);
  const href = (limit: number) => `${basePath}?${query ? `${query}&` : ''}limit=${limit}`;
  const nextLimit = Math.min(shown + step, reachable);
  return {
    next: { href: href(nextLimit), add: nextLimit - shown },
    all: reachable > nextLimit ? { href: href(reachable), count: reachable } : null,
  };
}

/** Обратно в query-строку (для ссылок «уточнить» и истории). */
export function filtersToQuery(f: MatchFilters): string {
  const p = new URLSearchParams();
  if (f.fullstack) p.set('spec', FULLSTACK);
  else if (f.specialization) p.set('spec', f.specialization);
  if (f.grade) p.set('grade', f.grade);
  if (f.stack?.length) p.set('stack', f.stack.join(','));
  if (f.fsp) p.set('fsp', '1');
  if (f.expandPool) p.set('pool', 'all');
  if (f.subcategory && !f.fullstack) p.set('sub', f.subcategory); // parseFilters читает `sub`; с fullstack не сочетается
  return p.toString();
}
