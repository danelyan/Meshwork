import { notFound } from 'next/navigation';

import { AppError } from '@/server/errors';

/** Параметры адреса страницы → объект для Zod-схемы списка (повторяющиеся ключи — первое значение). */
export function flatParams(sp: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

/** Значения фильтров для ссылок «Назад/Дальше»: без page. */
export function withoutPage(p: Record<string, string | undefined>): Record<string, string | undefined> {
  const { page: _page, ...rest } = p;
  void _page;
  return rest;
}

/** Карточка по id из адреса: 404 сервиса → страница «не найдено», остальные ошибки пробрасываются. */
export async function orNotFound<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
}
