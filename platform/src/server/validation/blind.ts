// Слепая разметка жюри на /evaluate («Разметить самому», R-M-*, критерий 1): 8 анонимных карточек под демо-вакансию —
// 3 из верха нашего ранжирования, 3 из верха BM25 по тексту профиля, остальные случайные; перемешаны. Жюри ставит 0–3,
// сервер считает, чей порядок лучше. Ничего не сохраняется: источник каждой карточки — в подписанном токене (HMAC-SHA256).
// Чистые функции, без БД; загрузка — в route.ts.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const BLIND_METHODS = ['ours', 'bm25', 'random'] as const;
export type BlindMethod = (typeof BLIND_METHODS)[number];
export const BLIND_TOP = 3;
export const BLIND_RANDOM = 2;
export const BLIND_CARDS = 8;
export const BLIND_TTL_MS = 60 * 60 * 1000;
export const MAX_RATING = 3;

export interface BlindSource {
  method: BlindMethod;
  /** Позиция в выдаче метода, с 1. */
  rank: number;
}

export interface BlindPick {
  key: string;
  candidateId: string;
  sources: BlindSource[];
}

export interface BlindTokenPayload {
  vacancyId: string;
  cards: Record<string, BlindSource[]>;
  /** Срок, мс epoch. */
  exp: number;
}

export type Rng = () => number;

function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Выбор карточек: топ-3 нашего порядка, топ-3 BM25, случайные из остального пула (не меньше 2, добор до 8, если
 * топы пересеклись). Карточка в обоих топах — одна, с двумя источниками. Пул меньше — карточек меньше.
 * Ключи c1…cN выдаются после перемешивания.
 */
export function selectBlindCards(ours: string[], bm25: string[], pool: string[], rng: Rng = Math.random): BlindPick[] {
  const byId = new Map<string, BlindSource[]>();
  const add = (id: string, s: BlindSource) => {
    const list = byId.get(id) ?? [];
    list.push(s);
    byId.set(id, list);
  };
  [...new Set(ours)].slice(0, BLIND_TOP).forEach((id, i) => add(id, { method: 'ours', rank: i + 1 }));
  [...new Set(bm25)].slice(0, BLIND_TOP).forEach((id, i) => add(id, { method: 'bm25', rank: i + 1 }));
  const rest = shuffle([...new Set(pool)].filter((id) => !byId.has(id)), rng);
  const randomCount = Math.max(BLIND_RANDOM, BLIND_CARDS - byId.size);
  rest.slice(0, randomCount).forEach((id, i) => add(id, { method: 'random', rank: i + 1 }));
  return shuffle([...byId.entries()], rng).map(([candidateId, sources], i) => ({ key: `c${i + 1}`, candidateId, sources }));
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const mac = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');

export function signBlindToken(payload: BlindTokenPayload, secret: string): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${mac(body, secret)}`;
}

export class BlindTokenError extends Error {}

/** Проверка подписи и срока. Подделка, мусор или просрочка — BlindTokenError (route отвечает 400). */
export function verifyBlindToken(token: string, secret: string, now = Date.now()): BlindTokenPayload {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) throw new BlindTokenError('Токен разметки повреждён');
  const want = Buffer.from(mac(body, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new BlindTokenError('Токен разметки не прошёл проверку подписи');
  let p: BlindTokenPayload;
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as BlindTokenPayload;
  } catch {
    throw new BlindTokenError('Токен разметки повреждён');
  }
  if (typeof p?.exp !== 'number' || typeof p.vacancyId !== 'string' || !p.cards || typeof p.cards !== 'object') throw new BlindTokenError('Токен разметки повреждён');
  if (p.exp < now) throw new BlindTokenError('Сессия разметки истекла (1 час). Начните заново.');
  return p;
}

export function blindTokenFor(vacancyId: string, picks: BlindPick[], secret: string, now = Date.now()): string {
  return signBlindToken({ vacancyId, cards: Object.fromEntries(picks.map((p) => [p.key, p.sources])), exp: now + BLIND_TTL_MS }, secret);
}

export interface MethodScore {
  meanRating: number;
  /** Доля карточек метода с оценкой ≥ 2. */
  p3: number;
  /** nDCG@3 по оценкам 0–3 в порядке выдачи метода; идеал — 3 лучшие оценки среди всех карточек сессии. */
  ndcg3: number;
  cards: number;
}

export interface BlindScore {
  n: number;
  methods: Record<BlindMethod, MethodScore>;
  verdict: string;
}

const gain = (r: number) => 2 ** r - 1;
const dcg = (rels: number[]) => rels.reduce((s, r, i) => s + gain(r) / Math.log2(i + 2), 0);
const round = (x: number) => Math.round(x * 1000) / 1000;
const ru = (x: number) => x.toFixed(1).replace('.', ',');

/**
 * Оценки жюри против источников из токена. Учитываются только карточки с оценкой; карточка в двух топах
 * засчитывается обоим методам. Оценки вне 0..3 или ключи не из токена — ошибка ввода (BlindTokenError → 400).
 */
export function scoreBlind(cards: Record<string, BlindSource[]>, ratings: Record<string, number>): BlindScore {
  for (const [k, v] of Object.entries(ratings)) {
    if (!(k in cards)) throw new BlindTokenError(`Карточки ${k} нет в этой разметке`);
    if (!Number.isInteger(v) || v < 0 || v > MAX_RATING) throw new BlindTokenError(`Оценка ${k} должна быть целым от 0 до ${MAX_RATING}`);
  }
  const rated = Object.keys(ratings);
  const ideal = dcg(rated.map((k) => ratings[k]!).sort((a, b) => b - a).slice(0, BLIND_TOP));
  const methods = {} as Record<BlindMethod, MethodScore>;
  for (const m of BLIND_METHODS) {
    const mine = rated
      .flatMap((k) => cards[k]!.filter((s) => s.method === m).map((s) => ({ rank: s.rank, r: ratings[k]! })))
      .sort((a, b) => a.rank - b.rank);
    const n = mine.length;
    methods[m] = {
      meanRating: n ? round(mine.reduce((s, x) => s + x.r, 0) / n) : 0,
      p3: n ? round(mine.filter((x) => x.r >= 2).length / n) : 0,
      ndcg3: ideal > 0 ? round(dcg(mine.slice(0, BLIND_TOP).map((x) => x.r)) / ideal) : 0,
      cards: n,
    };
  }
  const verdict =
    rated.length === 0
      ? 'Оценок нет — поставьте 0–3 хотя бы нескольким карточкам.'
      : `Ваши оценки: наш порядок ${ru(methods.ours.meanRating)} из 3, BM25 ${ru(methods.bm25.meanRating)}, случайный ${ru(methods.random.meanRating)}`;
  return { n: rated.length, methods, verdict };
}

/** Текст профиля для BM25: формулировки утверждений, стек, категория словами. */
export function profileText(p: { statements: string[]; stack: string[]; category: string | null; specialization: string | null }): string {
  return [...p.statements, ...p.stack, p.category ?? '', p.specialization ?? ''].join(' \n');
}

/** Текст вакансии (запрос BM25): формулировки требований, стек, название. */
export function vacancyText(v: { title: string; needs: string[]; stack: string[] }): string {
  return [v.title, ...v.needs, ...v.stack].join(' \n');
}
