// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { cases } from '../../src/cases';

import { makeShipping } from './shipping-impl';
import { formProblems, runCases } from './support';

describe('проверки доставки (visible)', () => {
  it('таблица cases: не меньше 5 кейсов корректной формы', () => {
    expect(formProblems(cases)).toEqual([]);
    expect(cases.length).toBeGreaterThanOrEqual(5);
  });

  it('эталонная реализация проходит все ваши кейсы', () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(runCases(makeShipping(), cases)).toEqual([]);
  });

  it('мутант «ровно 20 кг считается слишком тяжёлым» пойман', () => {
    expect(runCases(makeShipping(), cases)).toEqual([]);
    expect(runCases(makeShipping('max-strict'), cases).length).toBeGreaterThan(0);
  });

  it('мутант «бесплатно только при сумме строго больше 5000» пойман', () => {
    expect(runCases(makeShipping(), cases)).toEqual([]);
    expect(runCases(makeShipping('free-strict'), cases).length).toBeGreaterThan(0);
  });
});
