// Политика adr-0002-v5: ротация семейств между попытками (seenBefore), правила остановки по версии (rulesFor),
// параметры остановки seStop / earlyStop.
import { describe, expect, it } from 'vitest';

import { poolFor } from '@/server/test/generators';
import { estimateTheta, type Response } from '@/server/test/irt';
import {
  EARLY_STOP_PROB,
  MAX_ITEMS,
  MIN_ITEMS,
  POLICY_VERSION,
  RULES_BY_VERSION,
  rulesFor,
  SEEN_BEFORE_WEIGHT,
  selectNext,
  shouldStop,
  type SelectableTemplate,
} from '@/server/test/policy';
import { deriveSeed } from '@/server/test/rng';
import type { Grade } from '@/server/types';

const tpl = (id: string, grade: Grade, a: number, b: number): SelectableTemplate => ({ id, grade, a, b, catalogIds: [id] });

describe('ротация семейств (seenBefore)', () => {
  // Пять одинаково информативных шаблонов около θ = 0: randomesque берёт из 3 лучших.
  const pool = ['a', 'b', 'c', 'd', 'e'].map((id) => tpl(id, 'middle', 1.3, 0));

  it('без seenBefore выбор прежний (детерминирован по seed)', () => {
    const s = { shown: [], theta: 0, seed: 42 };
    expect(selectNext(pool, s)?.id).toBe(selectNext(pool, { ...s, seenBefore: new Set<string>() })?.id);
  });

  it('виденные в прошлых попытках не выбираются, пока есть сопоставимые новые', () => {
    const seenBefore = new Set(['a', 'b']);
    for (let seed = 0; seed < 200; seed++) {
      const id = selectNext(pool, { shown: [], theta: 0, seed: deriveSeed(seed, 1000), seenBefore })!.id;
      expect(seenBefore.has(id)).toBe(false);
    }
  });

  it('виденный шаблон всё же выбирается, если новый намного менее информативен', () => {
    const p = [tpl('seen', 'middle', 1.3, 0), tpl('far1', 'senior', 1.0, 3), tpl('far2', 'senior', 1.0, 3.2), tpl('far3', 'senior', 1.0, 3.4)];
    // Информация seen × 0,5 ≈ 0,21 больше, чем у заданий с b = 3 при θ = 0 (≈ 0,05): попадает в тройку и сохраняет шанс.
    const picks = new Set(Array.from({ length: 60 }, (_, s) => selectNext(p, { shown: [], theta: 0, seed: s, seenBefore: new Set(['seen']) })!.id));
    expect(picks.has('seen')).toBe(true);
    expect(SEEN_BEFORE_WEIGHT).toBeGreaterThan(0);
    expect(SEEN_BEFORE_WEIGHT).toBeLessThan(1);
  });

  it('на настоящем пуле подкатегории пересдача повторяет меньше семейств', () => {
    const tp = poolFor('backend', 'backend.web-api')!;
    const p: SelectableTemplate[] = tp.generators.map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade }));
    const firstAttempt = (seed: number) => {
      const shown: SelectableTemplate[] = [];
      for (let i = 0; i < 8; i++) shown.push(selectNext(p, { shown, theta: 0, seed: deriveSeed(seed, 1000 + i) })!);
      return shown;
    };
    let withRot = 0;
    let without = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const prev = new Set(firstAttempt(seed).map((t) => t.id));
      const again = (rot: boolean) => {
        const shown: SelectableTemplate[] = [];
        for (let i = 0; i < 8; i++) shown.push(selectNext(p, { shown, theta: 0, seed: deriveSeed(seed + 999, 1000 + i), ...(rot ? { seenBefore: prev } : {}) })!);
        return shown.filter((t) => prev.has(t.id)).length;
      };
      withRot += again(true);
      without += again(false);
    }
    expect(withRot).toBeLessThan(without);
  });
});

describe('правила остановки по версии', () => {
  it('текущая версия — v6 (индекс честности), правила v5 и v6 совпадают с v4 (7–10)', () => {
    expect(POLICY_VERSION).toBe('adr-0002-v7');
    expect(RULES_BY_VERSION['adr-0002-v5']).toEqual({ min: MIN_ITEMS, max: MAX_ITEMS });
    expect(RULES_BY_VERSION['adr-0002-v6']).toEqual({ min: MIN_ITEMS, max: MAX_ITEMS });
    expect(rulesFor('adr-0002-v4')).toEqual({ min: MIN_ITEMS, max: MAX_ITEMS });
  });

  it('неизвестная (старая) версия доигрывается по правилам v4', () => {
    expect(rulesFor('adr-0002-v1')).toEqual(rulesFor('adr-0002-v4'));
  });

  // Ответы, после которых SE ≤ 0,4, а P(θ > порог Middle) неуверенная: чередование верно/неверно на заданиях у порога.
  const atCut: Response[] = Array.from({ length: 14 }, (_, i) => ({ a: 1.8, b: -0.1, correct: i % 2 === 0 }));

  it('seStop: null выключает остановку по точности, остаётся только уверенность', () => {
    const est = estimateTheta(atCut.slice(0, 12));
    expect(est.se).toBeLessThanOrEqual(0.4);
    expect(shouldStop(12, est, 'middle', false, { min: 7, max: 14 }).reason).toBe('precise');
    expect(shouldStop(12, est, 'middle', false, { min: 7, max: 14, seStop: null }).stop).toBe(false);
  });

  it('earlyStop меняет порог уверенности ранней остановки', () => {
    const sure: Response[] = Array.from({ length: 7 }, () => ({ a: 1.3, b: 0.3, correct: true }));
    const est = estimateTheta(sure);
    expect(shouldStop(7, est, 'middle').reason).toBe('confident');
    expect(shouldStop(7, est, 'middle', false, { min: 7, max: 10, earlyStop: 0.9999, seStop: null }).stop).toBe(false);
    expect(EARLY_STOP_PROB).toBe(0.9);
  });
});
