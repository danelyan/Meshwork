// Подтверждающий тест (ADR-0002, дополнение 11.10): пул, остановка, решение по объединённым ответам.
import {
  CONFIRM_MAX_ITEMS,
  CONFIRM_MIN_ITEMS,
  cleanResponses,
  confirmRemaining,
  confirmSelectionPool,
  confirmShouldStop,
  confirmTimeLimit,
  decideConfirm,
} from '@/server/test/confirm';
import type { Response } from '@/server/test/irt';
import { CONFIRM_PROB, type SelectableTemplate } from '@/server/test/policy';

const t = (id: string, b = 0): SelectableTemplate => ({ id, a: 1.2, b, catalogIds: [id], grade: 'middle' });
const r = (b: number, correct: boolean): Response => ({ a: 1.3, b, correct });

describe('пул подтверждающего теста', () => {
  const pool = [t('a'), t('b'), t('c'), t('d')];
  const source = new Set(['a', 'b']);

  it('сначала шаблоны, которых не было в исходной попытке', () => {
    expect(confirmSelectionPool(pool, source, new Set()).map((x) => x.id)).toEqual(['c', 'd']);
    expect(confirmSelectionPool(pool, source, new Set(['c'])).map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('новые кончились — шаблоны исходной попытки (новые числа генератора)', () => {
    expect(confirmSelectionPool(pool, source, new Set(['c', 'd'])).map((x) => x.id)).toEqual(['a', 'b']);
    expect(confirmRemaining(pool, new Set(['c', 'd']))).toBe(2);
  });

  it('лимит времени ×0,7, не меньше 10 с', () => {
    expect(confirmTimeLimit(180)).toBe(126);
    expect(confirmTimeLimit(5)).toBe(10);
  });
});

describe('остановка подтверждающего теста', () => {
  const strong = Array.from({ length: 10 }, () => r(0.5, true));
  const unsure = [r(-0.1, true), r(-0.1, false), r(0, true), r(0, false), r(-0.2, true), r(0.1, false)];

  it(`до ${CONFIRM_MIN_ITEMS} ответов не останавливается, даже при уверенном решении`, () => {
    expect(confirmShouldStop(CONFIRM_MIN_ITEMS - 1, strong, 'middle', 5)).toBe(false);
  });

  it(`с ${CONFIRM_MIN_ITEMS} — стоп при уверенном решении; неуверенное — до ${CONFIRM_MAX_ITEMS}`, () => {
    expect(confirmShouldStop(CONFIRM_MIN_ITEMS, strong, 'middle', 5)).toBe(true);
    expect(confirmShouldStop(CONFIRM_MIN_ITEMS, unsure, 'middle', 5)).toBe(false);
    expect(confirmShouldStop(CONFIRM_MAX_ITEMS, unsure, 'middle', 5)).toBe(true);
  });

  it('пул исчерпан — стоп', () => {
    expect(confirmShouldStop(3, unsure, 'middle', 0)).toBe(true);
  });
});

describe('решение подтверждающего теста', () => {
  it('ответы исходной попытки с флагами времени или ловушки исключаются', () => {
    const items = [{ index: 0 }, { index: 1 }, { index: 2 }];
    expect(cleanResponses(items, [1]).map((i) => i.index)).toEqual([0, 2]);
  });

  it('сильные ответы обеих попыток → подтверждён при риске не high', () => {
    const src = [r(0, true), r(0.3, true), r(-0.5, true), r(0.6, true)];
    const own = [r(0.2, true), r(0.5, true), r(0.4, true), r(-0.2, true), r(0.7, true), r(0.1, true)];
    const d = decideConfirm(src, own, 'middle', 'medium');
    expect(d.pPass).toBeGreaterThanOrEqual(CONFIRM_PROB);
    expect(d.confirmed).toBe(true);
    expect(d.blockedByRisk).toBe(false);
  });

  it('порог пройден, но риск подтверждающей high → не подтверждён, blockedByRisk', () => {
    const own = Array.from({ length: 6 }, () => r(0.3, true));
    const d = decideConfirm([], own, 'middle', 'high');
    expect(d.confirmed).toBe(false);
    expect(d.blockedByRisk).toBe(true);
  });

  it('исходные ответы сильные, подтверждающие — провал → не подтверждён', () => {
    const src = Array.from({ length: 5 }, () => r(0.3, true));
    const own = Array.from({ length: 6 }, () => r(-0.3, false));
    const d = decideConfirm(src, own, 'middle', 'low');
    expect(d.confirmed).toBe(false);
    expect(d.blockedByRisk).toBe(false);
  });

  it('без ответов подтверждающей — не подтверждён (одних исходных мало)', () => {
    const src = Array.from({ length: 10 }, () => r(0.5, true));
    expect(decideConfirm(src, [], 'middle', 'low').confirmed).toBe(false);
  });
});
