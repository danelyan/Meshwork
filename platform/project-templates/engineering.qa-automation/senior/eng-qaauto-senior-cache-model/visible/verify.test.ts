// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { verify } from '../../src/verify';

import { makeFactory } from './cache-impl';

function outcome(factory: Parameters<typeof verify>[0]): Error | null {
  try {
    verify(factory);
    return null;
  } catch (e) {
    return e as Error;
  }
}

describe('проверка кэша (visible)', () => {
  it('verify — функция, не бросающая на эталонной реализации', () => {
    expect(typeof verify).toBe('function');
    expect(outcome(makeFactory())?.message).toBeUndefined();
  });

  it('на эталонной реализации verify ничего не бросает', () => {
    expect(outcome(makeFactory())).toBeNull();
  });

  it('мутант «запись живёт и в момент t+ttl» пойман', () => {
    expect(outcome(makeFactory())).toBeNull();
    expect(outcome(makeFactory('ttl-boundary'))).toBeInstanceOf(Error);
  });

  it('мутант «get не обновляет порядок использования» пойман', () => {
    expect(outcome(makeFactory())).toBeNull();
    expect(outcome(makeFactory('get-no-touch'))).toBeInstanceOf(Error);
  });
});
