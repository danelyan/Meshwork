// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { describe, expect, it } from 'vitest';

import type { CreateApp } from '../src/types';
import { verify } from '../src/verify';

import { altCreateApp, makeCreateApp, type Defect } from './helpers/impl';

async function outcome(createApp: CreateApp): Promise<Error | null> {
  try {
    await verify(createApp);
    return null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** verify пригоден к оценке, только если не бросает на правильном сервисе. */
async function assertUsable() {
  expect(typeof verify).toBe('function');
  expect((await outcome(makeCreateApp()))?.message).toBeUndefined();
}

async function expectKilled(defect: Defect) {
  await assertUsable();
  expect(await outcome(makeCreateApp(defect)), `мутант ${defect} выжил`).toBeInstanceOf(Error);
}

describe('корректность', () => {
  it('verify проходит на эталонном сервисе', async () => {
    await assertUsable();
  });

  it('verify проходит на независимо написанном сервисе и повторяется (без общего состояния между запусками)', async () => {
    await assertUsable();
    expect((await outcome(altCreateApp))?.message).toBeUndefined();
    expect((await outcome(makeCreateApp()))?.message).toBeUndefined();
  });
});

describe('мутанты: валидация и коды', () => {
  it('qty = 0 принимается', () => expectKilled('qty-zero-ok'));
  it('qty = 10 отклоняется', () => expectKilled('qty-max-strict'));
  it('дробное qty принимается', () => expectKilled('qty-float-ok'));
  it('пустой sku принимается', () => expectKilled('sku-empty-ok'));
  it('создание отвечает 200 вместо 201', () => expectKilled('create-200'));
  it('битый JSON приводит к 500', () => expectKilled('bad-json-500'));
});

describe('мутанты: идемпотентность и переходы', () => {
  it('Idempotency-Key игнорируется', () => expectKilled('idem-ignored'));
  it('тот же ключ с другим телом возвращает старый заказ', () => expectKilled('idem-conflict-ignored'));
  it('повторная отмена возвращает 200', () => expectKilled('cancel-twice-ok'));
  it('оплата отменённого заказа разрешена', () => expectKilled('pay-cancelled-ok'));
});

describe('мутанты: список и изоляция', () => {
  it('limit больше 50 принимается', () => expectKilled('list-limit-no-cap'));
  it('total равен длине страницы', () => expectKilled('list-total-page'));
  it('фильтр status игнорируется', () => expectKilled('list-status-ignored'));
  it('состояние общее для разных createApp()', () => expectKilled('state-shared'));
});
