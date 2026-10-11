import { z } from 'zod';

/**
 * Общие куски обзорных списков админки (E-08, фаза 1, только чтение): страницы, маски ПДн, разбор запроса.
 * Без `server-only`: чистые функции, их проверяют юнит-тесты.
 */

export const PAGE_SIZE = 25;

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export function paged<T>(items: T[], total: number, page: number): Paged<T> {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export function skipOf(page: number): number {
  return (page - 1) * PAGE_SIZE;
}

/** Параметры, общие для всех списков: строка поиска и номер страницы. Лишнее из строки запроса отбрасывается. */
const Q = z.string().trim().max(80).optional().catch(undefined);
export const ListBase = z.object({
  q: Q.transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

/** Значение фильтра из перечня; всё остальное (в том числе пустая строка «любое») — undefined. */
export function oneOf<const T extends readonly string[]>(values: T) {
  return z
    .string()
    .optional()
    .transform((v): T[number] | undefined => (v && (values as readonly string[]).includes(v) ? (v as T[number]) : undefined));
}

/** a***@d***.ru: достаточно, чтобы различить строки в списке, мало, чтобы узнать человека. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}***@${host[0] ?? ''}***${tld}`;
}

/** «Иван Петров» → «И. П***»: инициал и первая буква фамилии. */
export function maskName(name: string | null | undefined): string | null {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return `${parts[0]![0]}***`;
  return `${parts[0]![0]}. ${parts[1]![0]}***`;
}

/** Псевдоним из запроса: «Кандидат #AB12CD», «#ab12cd» или просто шесть hex-символов. */
export function parsePseudonym(q: string): string | null {
  const m = /^(?:кандидат\s*)?#?\s*([0-9a-f]{6})$/i.exec(q.trim());
  return m ? m[1]!.toUpperCase() : null;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
