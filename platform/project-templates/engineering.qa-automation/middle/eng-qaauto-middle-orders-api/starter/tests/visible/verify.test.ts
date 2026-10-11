// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { verify } from '../../src/verify';

import { makeCreateApp } from './orders-impl';

async function outcome(createApp: Parameters<typeof verify>[0]): Promise<Error | null> {
  try {
    await verify(createApp);
    return null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

describe('проверка API заказов (visible)', () => {
  it('verify – функция, не бросающая на эталонном сервисе', async () => {
    expect(typeof verify).toBe('function');
    expect((await outcome(makeCreateApp()))?.message).toBeUndefined();
  });

  it('мутант «qty = 0 принимается» пойман', async () => {
    expect((await outcome(makeCreateApp()))?.message).toBeUndefined();
    expect(await outcome(makeCreateApp('qty-zero-ok'))).toBeInstanceOf(Error);
  });

  it('мутант «повторная отмена возвращает 200» пойман', async () => {
    expect((await outcome(makeCreateApp()))?.message).toBeUndefined();
    expect(await outcome(makeCreateApp('cancel-twice-ok'))).toBeInstanceOf(Error);
  });
});
