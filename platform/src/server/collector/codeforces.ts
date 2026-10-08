import { AppError } from '../errors';
import { buildDoc, type RawLine } from './doc';
import { getJson } from './http-json';
import type { ExtractedDoc } from './types';

/**
 * Codeforces API: `user.info`, `user.rating`. Правило API — не чаще 1 запроса в 2 с:
 * общий на процесс троттлинг (очередь промисов).
 */
export const CF_API = 'https://codeforces.com/api';
export const CF_MIN_INTERVAL_MS = 2_000;
export const CF_HANDLE = /^[A-Za-z0-9_.-]{3,24}$/;
const RECENT_CONTESTS = 10;

let chain: Promise<void> = Promise.resolve();
let lastAt = Number.NEGATIVE_INFINITY;

/** Дождаться своей очереди к Codeforces. Экспорт для тестов. */
export function cfThrottle(now: () => number = Date.now, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
  const turn = chain.then(async () => {
    const wait = lastAt + CF_MIN_INTERVAL_MS - now();
    if (wait > 0) await sleep(wait);
    lastAt = now();
  });
  chain = turn.catch(() => undefined);
  return turn;
}

/** Только для тестов. */
export function resetCfThrottle() {
  chain = Promise.resolve();
  lastAt = Number.NEGATIVE_INFINITY;
}

interface CfResp<T> {
  status: 'OK' | 'FAILED';
  comment?: string;
  result?: T;
}
interface CfUser {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  maxRank?: string;
  registrationTimeSeconds: number;
}
interface CfRatingChange {
  contestName: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
}

async function cf<T>(method: string, query: string): Promise<T> {
  await cfThrottle();
  const { json } = await getJson<CfResp<T>>(`${CF_API}/${method}?${query}`, { source: 'Codeforces' });
  if (json.status !== 'OK' || json.result === undefined) {
    if (/not found/i.test(json.comment ?? '')) throw new AppError('not_found', 'Пользователь Codeforces не найден', 404);
    throw new AppError('fetch_failed', 'Codeforces вернул ошибку', 502);
  }
  return json.result;
}

const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

export async function fetchCodeforces(handle: string): Promise<ExtractedDoc> {
  if (!CF_HANDLE.test(handle)) throw new AppError('bad_request', 'Некорректный хэндл Codeforces', 400);
  const [user] = await cf<CfUser[]>('user.info', `handles=${encodeURIComponent(handle)}`);
  if (!user) throw new AppError('not_found', 'Пользователь Codeforces не найден', 404);
  const changes = await cf<CfRatingChange[]>('user.rating', `handle=${encodeURIComponent(user.handle)}`);

  const p = `codeforces:${user.handle}`;
  const lines: RawLine[] = [
    {
      ref: `${p}#info:l1`,
      text:
        user.rating !== undefined
          ? `Codeforces: ${user.handle}, рейтинг ${user.rating} (${user.rank ?? '—'}), максимум ${user.maxRating ?? user.rating} (${user.maxRank ?? '—'})`
          : `Codeforces: ${user.handle}, без рейтинга`,
    },
    { ref: `${p}#info:l2`, text: `Зарегистрирован ${day(user.registrationTimeSeconds)}` },
    { ref: `${p}#info:l3`, text: `Рейтинговых контестов: ${changes.length}` },
  ];
  changes
    .slice(-RECENT_CONTESTS)
    .reverse()
    .forEach((c, i) =>
      lines.push({
        ref: `${p}#rating:l${i + 1}`,
        text: `${day(c.ratingUpdateTimeSeconds)} ${c.contestName}: место ${c.rank}, рейтинг ${c.oldRating} → ${c.newRating}`,
      }),
    );
  return buildDoc({
    sourceKind: 'codeforces',
    title: `Codeforces ${user.handle}`,
    origin: p,
    lines,
    meta: {
      url: `https://codeforces.com/profile/${user.handle}`,
      rating: user.rating ?? null,
      maxRating: user.maxRating ?? null,
      contests: changes.length,
      ownershipVerified: false,
    },
  });
}
