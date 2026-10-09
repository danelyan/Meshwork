import { checkAnswer, normalizeAnswer } from '@/server/test/answers';
import { estimateTheta, information, probAbove, probCorrect } from '@/server/test/irt';
import { CONFIRM_PROB, decide, GRADE_CUT, MAX_ITEMS, MIN_ITEMS, selectNext, shouldStop, type SelectableTemplate } from '@/server/test/policy';
import { createRng, deriveSeed } from '@/server/test/rng';

const item = (a: number, b: number) => ({ a, b });

describe('IRT 2PL', () => {
  it('P(θ = b) = 0,5; растёт с θ; информация максимальна при θ = b', () => {
    expect(probCorrect(0.5, item(1.2, 0.5))).toBeCloseTo(0.5, 9);
    expect(probCorrect(2, item(1.2, 0.5))).toBeGreaterThan(probCorrect(0, item(1.2, 0.5)));
    const it = item(1.5, 0.3);
    expect(information(0.3, it)).toBeGreaterThan(information(1.5, it));
    expect(information(0.3, it)).toBeGreaterThan(information(-1, it));
    expect(information(0.3, it)).toBeCloseTo(1.5 * 1.5 * 0.25, 9);
  });

  it('без ответов — априорное: θ = 0, SE ≈ 1', () => {
    const est = estimateTheta([]);
    expect(est.theta).toBeCloseTo(0, 6);
    expect(est.se).toBeGreaterThan(0.95);
    expect(est.se).toBeLessThan(1.05);
    expect(probAbove(est, 0)).toBeCloseTo(0.5, 1);
  });

  it('верные ответы поднимают θ и сужают SE; неверные опускают', () => {
    const good = estimateTheta(Array.from({ length: 6 }, () => ({ ...item(1.2, 0.3), correct: true })));
    const bad = estimateTheta(Array.from({ length: 6 }, () => ({ ...item(1.2, 0.3), correct: false })));
    expect(good.theta).toBeGreaterThan(1);
    expect(bad.theta).toBeLessThan(-0.5);
    expect(good.se).toBeLessThan(0.8);
    expect(probAbove(good, GRADE_CUT.middle)).toBeGreaterThan(0.8);
    expect(probAbove(bad, GRADE_CUT.middle)).toBeLessThan(0.2);
  });

  it('детерминизм: тот же набор ответов → та же оценка', () => {
    const r = [
      { ...item(1.1, -0.5), correct: true },
      { ...item(1.4, 0.6), correct: false },
      { ...item(1.0, 0.2), correct: true },
    ];
    expect(estimateTheta(r)).toEqual(estimateTheta([...r]));
  });
});

describe('правила теста', () => {
  const pool: SelectableTemplate[] = [
    { id: 'a', a: 1.2, b: -1.0, catalogIds: ['x'], grade: 'junior' },
    { id: 'b', a: 1.2, b: -0.3, catalogIds: ['y'], grade: 'junior' },
    { id: 'c', a: 1.3, b: 0.4, catalogIds: ['z'], grade: 'middle' },
    { id: 'd', a: 1.3, b: 0.9, catalogIds: ['w'], grade: 'middle' },
    { id: 'e', a: 1.0, b: 2.0, catalogIds: ['v'], grade: 'middle' },
  ];

  it('selectNext: не повторяет показанные, детерминирован по seed, берёт информативные около θ', () => {
    const first = selectNext(pool, { shown: [], theta: 0.5, seed: 42 });
    expect(first).not.toBeNull();
    expect(selectNext(pool, { shown: [], theta: 0.5, seed: 42 })).toEqual(first);
    // Около θ = 0,5 три лучших по информации — b, c, d; e (b = 2) и a (b = −1) не попадают в randomesque.
    const picks = new Set(Array.from({ length: 50 }, (_, s) => selectNext(pool, { shown: [], theta: 0.5, seed: s })!.id));
    expect(picks.has('e')).toBe(false);
    expect(picks.has('a')).toBe(false);
    const shown = [pool[1]!, pool[2]!, pool[3]!];
    const next = selectNext(pool, { shown, theta: 0.5, seed: 1 });
    expect(['a', 'e']).toContain(next!.id);
    expect(selectNext(pool, { shown: pool, theta: 0, seed: 1 })).toBeNull();
  });

  it('selectNext: доля одного утверждения ограничена', () => {
    const same: SelectableTemplate[] = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, a: 1.2, b: 0, catalogIds: ['k'], grade: 'junior' }));
    const other: SelectableTemplate = { id: 'o', a: 0.5, b: 3, catalogIds: ['q'], grade: 'junior' };
    const shown = same.slice(0, 4); // 4 из 10 = 40 % — лимит исчерпан
    expect(selectNext([...same, other], { shown, theta: 0, seed: 1 })!.id).toBe('o');
  });

  it('shouldStop: не раньше MIN, не позже MAX, между — по уверенности или SE', () => {
    const sure = estimateTheta(Array.from({ length: MIN_ITEMS }, () => ({ ...item(1.3, 0.4), correct: true })));
    expect(shouldStop(MIN_ITEMS - 1, sure, 'middle').stop).toBe(false);
    expect(shouldStop(MIN_ITEMS, sure, 'middle')).toEqual({ stop: true, reason: 'confident' });
    const mixed = estimateTheta([
      { ...item(1.2, 0.5), correct: true },
      { ...item(1.2, 0.5), correct: false },
      { ...item(1.2, 0.5), correct: true },
      { ...item(1.2, 0.5), correct: false },
      { ...item(1.2, 0.5), correct: true },
      { ...item(1.2, 0.5), correct: false },
      { ...item(1.2, 0.5), correct: true },
    ]);
    expect(shouldStop(MIN_ITEMS, mixed, 'middle').stop).toBe(false);
    expect(shouldStop(MAX_ITEMS, mixed, 'middle')).toEqual({ stop: true, reason: 'max_items' });
    expect(shouldStop(3, mixed, 'middle', true).stop).toBe(true);
  });

  it('decide: подтверждение при P ≥ 0,8; Junior предлагается при провале Middle с уверенным Junior', () => {
    const strong = Array.from({ length: 8 }, () => ({ ...item(1.3, 0.5), correct: true }));
    expect(decide(strong, 'middle').confirmed).toBe(true);
    expect(decide(strong, 'middle').pPass).toBeGreaterThanOrEqual(CONFIRM_PROB);
    const midJunior = [
      ...Array.from({ length: 5 }, () => ({ ...item(1.2, -0.8), correct: true })),
      ...Array.from({ length: 4 }, () => ({ ...item(1.3, 0.7), correct: false })),
    ];
    const d = decide(midJunior, 'middle');
    expect(d.confirmed).toBe(false);
    expect(d.juniorOffered).toBe(true);
    expect(decide(midJunior, 'junior').confirmed).toBe(true);
    expect(decide([], 'junior').confirmed).toBe(false);
    const weak = Array.from({ length: 7 }, () => ({ ...item(1.2, -0.8), correct: false }));
    expect(decide(weak, 'middle').juniorOffered).toBe(false);
  });
});

describe('rng', () => {
  it('seed детерминирован, deriveSeed различает индексы и неотрицателен', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect([a.next(), a.int(1, 10), a.pick([1, 2, 3])]).toEqual([b.next(), b.int(1, 10), b.pick([1, 2, 3])]);
    expect(deriveSeed(5, 0)).not.toBe(deriveSeed(5, 1));
    expect(deriveSeed(5, 0)).not.toBe(deriveSeed(6, 0));
    for (let i = 0; i < 100; i++) expect(deriveSeed(123, i)).toBeGreaterThanOrEqual(0);
    const s = createRng(3).sample([1, 2, 3, 4, 5], 3);
    expect(new Set(s).size).toBe(3);
  });
});

describe('проверка ответов кодом', () => {
  it('number: пробелы, запятая как разделитель, +; text: регистр и кавычки; list: порядок не важен; варианты ключа', () => {
    expect(checkAnswer('number', ' 12 ', '12')).toBe(true);
    expect(checkAnswer('number', '3,0', '3')).toBe(true);
    expect(checkAnswer('number', 'три', '3')).toBe(false);
    expect(checkAnswer('number', '400', '400|422')).toBe(true);
    expect(checkAnswer('number', '422', '400|422')).toBe(true);
    expect(checkAnswer('text', '"Red"', 'red')).toBe(true);
    expect(checkAnswer('text', 'done, 3, 3', 'done,3,3')).toBe(true);
    expect(checkAnswer('text', 'A B', 'a,b')).toBe(true);
    expect(checkAnswer('text', '3,3,done', 'done,3,3')).toBe(false);
    expect(checkAnswer('list', '3, 1', '1,3')).toBe(true);
    expect(checkAnswer('list', '3 1 1', '1,3')).toBe(true);
    expect(checkAnswer('list', '3', '1,3')).toBe(false);
    expect(checkAnswer('text', 'O(n log n)', 'n log n|o(n log n)')).toBe(true);
    expect(normalizeAnswer('line', '7')).toBe('7');
    expect(normalizeAnswer('number', '')).toBeNull();
  });
});
