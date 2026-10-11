import { describe, expect, it } from 'vitest';

import {
  BLIND_TTL_MS,
  BlindTokenError,
  blindTokenFor,
  scoreBlind,
  selectBlindCards,
  signBlindToken,
  verifyBlindToken,
  type BlindSource,
} from '@/server/validation/blind';

const SECRET = 'x'.repeat(40);

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

const pool = Array.from({ length: 20 }, (_, i) => `p${String(i).padStart(2, '0')}`);

describe('selectBlindCards', () => {
  it('без пересечения: 8 уникальных, 3+3+2, ключи c1…c8', () => {
    const picks = selectBlindCards(['p00', 'p01', 'p02', 'p03'], ['p10', 'p11', 'p12'], pool, seeded(3));
    expect(picks).toHaveLength(8);
    expect(new Set(picks.map((p) => p.candidateId)).size).toBe(8);
    expect(picks.map((p) => p.key)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
    const count = (m: string) => picks.filter((p) => p.sources.some((s) => s.method === m)).length;
    expect([count('ours'), count('bm25'), count('random')]).toEqual([3, 3, 2]);
    expect(picks.find((p) => p.candidateId === 'p03')?.sources.some((s) => s.method === 'ours') ?? false).toBe(false);
  });

  it('пересечение топов: одна карточка с двумя источниками, случайными добираем до 8', () => {
    const picks = selectBlindCards(['p00', 'p01', 'p02'], ['p01', 'p10', 'p11'], pool, seeded(5));
    expect(picks).toHaveLength(8);
    const shared = picks.find((p) => p.candidateId === 'p01')!;
    expect(shared.sources).toEqual([
      { method: 'ours', rank: 2 },
      { method: 'bm25', rank: 1 },
    ]);
    expect(picks.filter((p) => p.sources.some((s) => s.method === 'random'))).toHaveLength(3);
  });

  it('маленький пул – карточек сколько есть', () => {
    const picks = selectBlindCards(['a', 'b'], ['b', 'c'], ['a', 'b', 'c', 'd'], seeded(7));
    expect(picks.map((p) => p.candidateId).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(selectBlindCards([], [], [])).toEqual([]);
  });
});

describe('scoreBlind', () => {
  const cards: Record<string, BlindSource[]> = {
    c1: [{ method: 'ours', rank: 1 }],
    c2: [{ method: 'ours', rank: 2 }, { method: 'bm25', rank: 3 }],
    c3: [{ method: 'ours', rank: 3 }],
    c4: [{ method: 'bm25', rank: 1 }],
    c5: [{ method: 'bm25', rank: 2 }],
    c6: [{ method: 'random', rank: 1 }],
    c7: [{ method: 'random', rank: 2 }],
  };
  const ratings = { c1: 3, c2: 2, c3: 3, c4: 0, c5: 1, c6: 0, c7: 2 };

  it('meanRating, p3, ndcg3 на известных оценках; общая карточка засчитана обоим', () => {
    const r = scoreBlind(cards, ratings);
    expect(r.n).toBe(7);
    expect(r.methods.ours).toEqual({ meanRating: 2.667, p3: 1, ndcg3: expect.any(Number), cards: 3 });
    expect(r.methods.bm25.cards).toBe(3);
    expect(r.methods.bm25.meanRating).toBe(1);
    expect(r.methods.bm25.p3).toBe(0.333);
    expect(r.methods.random).toMatchObject({ meanRating: 1, p3: 0.5, cards: 2 });
    // Идеал – три лучшие оценки сессии 3,3,2: 7 + 7/log2(3) + 3/2.
    const ideal = 7 + 7 / Math.log2(3) + 3 / 2;
    expect(r.methods.ours.ndcg3).toBeCloseTo((7 + 3 / Math.log2(3) + 7 / 2) / ideal, 3);
    expect(r.methods.bm25.ndcg3).toBeCloseTo((0 + 1 / Math.log2(3) + 3 / 2) / ideal, 3);
    expect(r.methods.random.ndcg3).toBeCloseTo((0 + 3 / Math.log2(3)) / ideal, 3);
    expect(r.verdict).toBe('Ваши оценки: наш порядок 2,7 из 3, BM25 1,0, случайный 1,0');
  });

  it('идеальный порядок – ndcg3 = 1; все нули – 0', () => {
    expect(scoreBlind(cards, { c1: 3, c2: 3, c3: 2 }).methods.ours.ndcg3).toBe(1);
    expect(scoreBlind(cards, { c1: 0, c4: 0 }).methods.ours.ndcg3).toBe(0);
  });

  it('чужой ключ и оценка вне 0..3 – ошибка ввода', () => {
    expect(() => scoreBlind(cards, { c9: 1 })).toThrow(BlindTokenError);
    expect(() => scoreBlind(cards, { c1: 4 })).toThrow(BlindTokenError);
  });
});

describe('токен разметки', () => {
  const picks = selectBlindCards(['a', 'b', 'c'], ['d', 'e', 'f'], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], seeded(9));

  it('подпись проверяется и возвращает источники', () => {
    const now = 1_000_000;
    const p = verifyBlindToken(blindTokenFor('vac1', picks, SECRET, now), SECRET, now + 1000);
    expect(p.vacancyId).toBe('vac1');
    expect(Object.keys(p.cards)).toHaveLength(8);
    expect(p.exp).toBe(now + BLIND_TTL_MS);
  });

  it('просрочен – ошибка', () => {
    const t = blindTokenFor('vac1', picks, SECRET, 0);
    expect(() => verifyBlindToken(t, SECRET, BLIND_TTL_MS + 1)).toThrow(/истекла/);
  });

  it('подделка тела, чужой секрет и мусор – ошибка', () => {
    const t = signBlindToken({ vacancyId: 'v', cards: { c1: [{ method: 'random', rank: 1 }] }, exp: Date.now() + 1000 }, SECRET);
    const [, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ vacancyId: 'v', cards: { c1: [{ method: 'ours', rank: 1 }] }, exp: Date.now() + 1000 })).toString('base64url');
    expect(() => verifyBlindToken(`${forged}.${sig}`, SECRET)).toThrow(BlindTokenError);
    expect(() => verifyBlindToken(t, 'y'.repeat(40))).toThrow(BlindTokenError);
    expect(() => verifyBlindToken('garbage', SECRET)).toThrow(BlindTokenError);
    expect(verifyBlindToken(t, SECRET).cards.c1).toEqual([{ method: 'random', rank: 1 }]);
  });
});
