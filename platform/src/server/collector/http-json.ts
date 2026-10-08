import { AppError } from '../errors';

/**
 * GET к фиксированным публичным API (GitHub, Codeforces, Stack Exchange): хост задан
 * кодом, не пользователем, поэтому SSRF-фильтр не нужен; таймаут и лимит размера — да.
 */
export interface GetOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  /** Что сказать при 404. */
  notFound?: string;
  source: string;
}

export async function getText(url: string, opts: GetOptions): Promise<{ status: number; text: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': 'FSP-Career-Collector/1.0', ...opts.headers },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      redirect: 'follow',
    });
  } catch {
    throw new AppError('fetch_failed', `${opts.source} не ответил`, 502);
  }
  if (res.status === 404) throw new AppError('not_found', opts.notFound ?? `${opts.source}: не найдено`, 404);
  if (res.status === 403 || res.status === 429) {
    throw new AppError('rate_limited', `${opts.source} временно ограничил запросы, попробуйте позже`, 503);
  }
  if (res.status >= 400) {
    // Codeforces отвечает 400 с JSON {status:'FAILED'} — отдаём тело наверх
    if (res.status !== 400) throw new AppError('fetch_failed', `${opts.source} ответил ${res.status}`, 502);
  }
  const max = opts.maxBytes ?? 1024 * 1024;
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new AppError('fetch_failed', `${opts.source}: слишком большой ответ`, 502);
  const text = await res.text();
  return { status: res.status, text: text.length > max ? text.slice(0, max) : text };
}

export async function getJson<T>(url: string, opts: GetOptions): Promise<{ status: number; json: T }> {
  const { status, text } = await getText(url, opts);
  try {
    return { status, json: JSON.parse(text) as T };
  } catch {
    throw new AppError('fetch_failed', `${opts.source}: некорректный ответ`, 502);
  }
}
