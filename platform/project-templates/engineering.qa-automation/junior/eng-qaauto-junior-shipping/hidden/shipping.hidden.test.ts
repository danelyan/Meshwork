// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { describe, expect, it } from 'vitest';

import { cases } from '../src/cases';

import { makeShipping, shippingAlt, type Defect } from './helpers/impl';
import { formProblems, runCases } from './helpers/support';

const MIN_CASES = 12;

/** Таблица пригодна к оценке: корректной формы, достаточно кейсов и эталон проходит их все. */
function assertUsable() {
  expect(formProblems(cases)).toEqual([]);
  expect(cases.length).toBeGreaterThanOrEqual(MIN_CASES);
  expect(runCases(makeShipping(), cases)).toEqual([]);
}

function expectKilled(defect: Defect) {
  assertUsable();
  expect(runCases(makeShipping(defect), cases).length, `мутант ${defect} выжил`).toBeGreaterThan(0);
}

describe('таблица кейсов', () => {
  it('форма: уникальные имена, ровно одно из expected / throws, не меньше 12 кейсов', () => {
    expect(formProblems(cases)).toEqual([]);
    expect(cases.length).toBeGreaterThanOrEqual(MIN_CASES);
  });

  it('все ожидания верны: эталон проходит каждый кейс', () => {
    assertUsable();
  });

  it('таблица не привязана к устройству эталона: независимая реализация тоже проходит все кейсы', () => {
    assertUsable();
    expect(runCases(shippingAlt, cases)).toEqual([]);
  });

  it('кейсы разнообразны: есть и успешные расчёты, и ошибки, и не меньше трёх разных кодов ошибок', () => {
    assertUsable();
    expect(cases.some((c) => c.expected !== undefined)).toBe(true);
    const codes = new Set(cases.map((c) => c.throws).filter(Boolean));
    expect(codes.size).toBeGreaterThanOrEqual(3);
  });
});

describe('мутанты: границы весовых диапазонов', () => {
  it('ровно 1 кг отнесён к среднему тарифу', () => expectKilled('w1-strict'));
  it('ровно 20 кг считается слишком тяжёлым', () => expectKilled('max-strict'));
});

describe('мутанты: валидация входа', () => {
  it('нулевой вес принимается', () => expectKilled('zero-weight'));
  it('NaN и бесконечность принимаются как вес', () => expectKilled('nan-weight'));
  it('отрицательная сумма заказа принимается', () => expectKilled('negative-subtotal'));
  it('неизвестная зона считается городом', () => expectKilled('unknown-zone'));
  it('экспресс в страну разрешён', () => expectKilled('express-country'));
});

describe('мутанты: цена', () => {
  it('коэффициент региона 2 вместо 1.5', () => expectKilled('region-coef'));
  it('экспресс-надбавка 50% вместо 40%', () => expectKilled('express-50'));
  it('экспресс-надбавка считается от базы, а не от цены с зоной', () => expectKilled('express-on-base'));
  it('бесплатная доставка только при сумме строго больше 5000', () => expectKilled('free-strict'));
  it('экспресс тоже бесплатный при большой сумме', () => expectKilled('free-express'));
});
