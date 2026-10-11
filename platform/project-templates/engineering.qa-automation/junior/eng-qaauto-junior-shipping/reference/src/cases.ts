import type { Case, Order } from './types';

const o = (weightKg: number, zone: Order['zone'] = 'city', express = false, subtotal = 100): Order => ({ weightKg, zone, express, subtotal });

export const cases: Case[] = [
  { name: 'лёгкая посылка 0.5 кг по городу', input: o(0.5), expected: 300 },
  { name: 'ровно 1 кг — нижний тариф', input: o(1), expected: 300 },
  { name: '1.01 кг — средний тариф', input: o(1.01), expected: 500 },
  { name: 'ровно 5 кг — средний тариф', input: o(5), expected: 500 },
  { name: '5.01 кг — верхний тариф', input: o(5.01), expected: 900 },
  { name: 'ровно 20 кг — ещё допустимо', input: o(20), expected: 900 },
  { name: '20.01 кг — слишком тяжёлая', input: o(20.01), throws: 'too_heavy' },
  { name: 'вес 0', input: o(0), throws: 'invalid_weight' },
  { name: 'отрицательный вес', input: o(-1), throws: 'invalid_weight' },
  { name: 'вес NaN', input: o(NaN), throws: 'invalid_weight' },
  { name: 'вес Infinity', input: o(Infinity), throws: 'invalid_weight' },
  { name: 'регион 1 кг: коэффициент 1.5', input: o(1, 'region'), expected: 450 },
  { name: 'регион 6 кг', input: o(6, 'region'), expected: 1350 },
  { name: 'страна 1 кг: коэффициент 2.5', input: o(1, 'country'), expected: 750 },
  { name: 'экспресс по городу: +40%', input: o(1, 'city', true), expected: 420 },
  { name: 'экспресс по региону: +40% к цене с зоной', input: o(1, 'region', true), expected: 630 },
  { name: 'экспресс в страну недоступен', input: o(1, 'country', true), throws: 'express_unavailable' },
  { name: 'сумма ровно 5000 — доставка бесплатна', input: o(1, 'city', false, 5000), expected: 0 },
  { name: 'сумма 4999.99 — доставка платная', input: o(1, 'city', false, 4999.99), expected: 300 },
  { name: 'бесплатная доставка в регион при большой сумме', input: o(6, 'region', false, 6000), expected: 0 },
  { name: 'экспресс не бывает бесплатным', input: o(1, 'city', true, 6000), expected: 420 },
  { name: 'отрицательная сумма заказа', input: o(1, 'city', false, -1), throws: 'invalid_subtotal' },
  { name: 'нулевая сумма заказа допустима', input: o(1, 'city', false, 0), expected: 300 },
  { name: 'неизвестная зона', input: { ...o(1), zone: 'moon' as Order['zone'] }, throws: 'invalid_zone' },
  { name: 'слишком тяжёлая посылка в страну', input: o(21, 'country'), throws: 'too_heavy' },
];
