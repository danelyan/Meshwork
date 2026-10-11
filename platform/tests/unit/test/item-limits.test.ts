// Лимиты длины теста на грейд: TEST_ITEM_LIMITS (env), limitsFor по версии политики, разбор блока «Длина теста и надёжность».
import { describe, expect, it } from 'vitest';

import { DEFAULT_ITEM_LIMITS, formatItemRange, parseItemLimits } from '@/lib/test-limits';
import { EnvError, parseEnv } from '@/server/env';
import { limitsFor, MAX_ITEMS, MIN_ITEMS, nextStep, POLICY_VERSION, rulesFor, type SelectableTemplate } from '@/server/test/policy';
import { parseLengthBlock, parseLengthSweepRun, pickDefaultLimits, type BankWidth, type LengthSweep } from '@/server/validation/length-sweep';

import raw from '../../../eval/test/results.json';

const valid = { DATABASE_URL: 'postgresql://postgres@127.0.0.1:54329/fsp_x', SESSION_SECRET: 's'.repeat(32) };

describe('TEST_ITEM_LIMITS', () => {
  it('дефолт policy — из lib/test-limits (его же показывает страница теста)', () => {
    expect({ min: MIN_ITEMS, max: MAX_ITEMS }).toEqual(DEFAULT_ITEM_LIMITS);
    expect(formatItemRange(DEFAULT_ITEM_LIMITS)).toBe(`${MIN_ITEMS}–${MAX_ITEMS}`);
    expect(formatItemRange({ min: 10, max: 10 })).toBe('10');
  });
  it('разбор «min,max»: пусто — null, пробелы допустимы, ошибки формата и границ — исключение', () => {
    expect(parseItemLimits(undefined)).toBeNull();
    expect(parseItemLimits('  ')).toBeNull();
    expect(parseItemLimits('9,12')).toEqual({ min: 9, max: 12 });
    expect(parseItemLimits(' 10 , 14 ')).toEqual({ min: 10, max: 14 });
    expect(() => parseItemLimits('12')).toThrow(/min,max/);
    expect(() => parseItemLimits('12,9')).toThrow(/больше/);
    expect(() => parseItemLimits('3,9')).toThrow(/5…20/);
    expect(() => parseItemLimits('9,25')).toThrow(/5…20/);
  });
  it('getEnv: не задано — undefined/null; задано — объект; мусор — EnvError при старте', () => {
    expect(parseEnv(valid).TEST_ITEM_LIMITS ?? null).toBeNull();
    expect(parseEnv({ ...valid, TEST_ITEM_LIMITS: '9,12' }).TEST_ITEM_LIMITS).toEqual({ min: 9, max: 12 });
    expect(() => parseEnv({ ...valid, TEST_ITEM_LIMITS: 'nine,12' })).toThrow(EnvError);
    expect(() => parseEnv({ ...valid, TEST_ITEM_LIMITS: '14,9' })).toThrow(EnvError);
  });
  it('limitsFor: override только для текущей версии, старые доигрываются по своим правилам', () => {
    expect(limitsFor(POLICY_VERSION, null)).toEqual(rulesFor(POLICY_VERSION));
    expect(limitsFor(POLICY_VERSION, { min: 9, max: 12 })).toMatchObject({ min: 9, max: 12 });
    expect(limitsFor('adr-0002-v4', { min: 9, max: 12 })).toEqual(rulesFor('adr-0002-v4'));
  });
  it('nextStep с лимитами 9–12: неуверенная попытка идёт до 12, а не до 10', () => {
    const pool: SelectableTemplate[] = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, a: 1.2, b: -0.1, catalogIds: [`c${i}`], grade: 'middle' }));
    const shown = pool.slice(0, 10);
    const responses = shown.map((t, i) => ({ a: t.a, b: t.b, correct: i % 2 === 0 }));
    const limits = limitsFor(POLICY_VERSION, { min: 9, max: 12 });
    expect(nextStep({ pool, shown, responses, grade: 'middle', probe: false }, limits)).toMatchObject({ stop: false, maxItems: 12 });
    const s12 = pool.slice(0, 12);
    const r12 = s12.map((t, i) => ({ a: t.a, b: t.b, correct: i % 2 === 0 }));
    expect(nextStep({ pool, shown: s12, responses: r12, grade: 'middle', probe: false }, limits)).toMatchObject({ stop: true, reason: 'max_items' });
  });
});

describe('«Длина теста и надёжность»: разбор результатов', () => {
  const summary = (k: number, len: number) => ({
    'strict.retest.kappaBinary': { mean: k, min: k - 0.05, max: k + 0.05 },
    'strict.retest.decisionAgreement': { mean: 0.7, min: 0.6, max: 0.8 },
    'strict.length.mean': { mean: len, min: len, max: len },
    'strict.earlyStopShare': { mean: 0.3, min: 0.2, max: 0.4 },
    'strict.falsePass': { mean: 0.29, min: 0.2, max: 0.3 },
    'competitor.retest.kappaBinary': { mean: k - 0.02, min: 0, max: 1 },
    'competitor.length.mean': { mean: len + 0.5, min: 0, max: 99 },
  });
  it('parseLengthSweepRun: берёт summary.instance, нет метрики — null; без instance — исключение', () => {
    const v = parseLengthSweepRun({ summary: { instance: summary(0.42, 8.5) } }, { min: 7, max: 10, current: true });
    expect(v).toMatchObject({ min: 7, max: 10, current: true, strict: { kappa: 0.42, kappaMin: 0.37, lengthMean: 8.5, earlyStopShare: 0.3 } });
    expect(v.competitor.earlyStopShare).toBeNull();
    expect(v.strict.minutesMean).toBeNull();
    expect(() => parseLengthSweepRun({ summary: { family: {} } }, { min: 7, max: 10, current: true })).toThrow(/instance/);
  });
  const sweepOf = (rows: [number, number, number, number][]): LengthSweep => ({
    generatedAt: '',
    command: '',
    config: { n: 1, seed: 1, errorModel: 'instance' },
    variants: rows.map(([min, max, k, len]) => parseLengthSweepRun({ summary: { instance: summary(k, len) } }, { min, max, current: min === 7 })),
  });
  const bankOf = (shortAt16: number): BankWidth => ({
    generatedAt: '',
    command: '',
    maxes: [10, 12, 14, 16],
    probe: 3,
    rows: [{ subcategoryId: 'x', title: 'X', own: { junior: 9, middle: 9, senior: 8 }, common: 15, reachable: 37, shortBy: { '10': 0, '12': 0, '14': 0, '16': shortAt16 }, shortByRetest: {} }],
  });
  it('pickDefaultLimits: κ ≥ 0,47 при длине ≤ 12 и банке без нехватки; самый короткий из подходящих', () => {
    const sweep = sweepOf([[7, 10, 0.42, 8.5], [10, 14, 0.47, 11.5], [12, 16, 0.5, 12.9]]);
    expect(pickDefaultLimits(sweep, bankOf(0))).toMatchObject({ min: 10, max: 14 });
    expect(pickDefaultLimits(sweepOf([[7, 10, 0.42, 8.5], [12, 16, 0.5, 12.9]]), bankOf(0))).toBeNull();
    expect(pickDefaultLimits(sweepOf([[12, 16, 0.5, 11.9]]), bankOf(2))).toBeNull();
    expect(pickDefaultLimits(sweep, null)).toBeNull();
  });
  it('parseLengthBlock: ключей нет — null; не той формы — исключение', () => {
    expect(parseLengthBlock({})).toEqual({ sweep: null, bank: null });
    expect(() => parseLengthBlock({ lengthSweep: { variants: [{ min: 7 }] } })).toThrow(/lengthSweep/);
    expect(() => parseLengthBlock({ bankWidth: { rows: [{}], maxes: [] } })).toThrow(/bankWidth/);
  });
  it('закоммиченный results.json разбирается, текущие лимиты есть в переборе', () => {
    const { sweep, bank } = parseLengthBlock(raw);
    expect(sweep?.variants.some((v) => v.current && v.min === MIN_ITEMS && v.max === MAX_ITEMS)).toBe(true);
    expect(bank?.rows.length).toBeGreaterThan(0);
  });
});
