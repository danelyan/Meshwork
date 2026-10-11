// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CacheFactory } from '../src/types';
import { verify } from '../src/verify';

import { altFactory, makeFactory, type Defect } from './helpers/impl';

function outcome(factory: CacheFactory): Error | null {
  try {
    verify(factory);
    return null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** verify пригоден к оценке, только если не бросает на правильной реализации. */
function assertUsable() {
  expect(typeof verify).toBe('function');
  expect(outcome(makeFactory())?.message).toBeUndefined();
}

function expectKilled(defect: Defect) {
  assertUsable();
  expect(outcome(makeFactory(defect)), `мутант ${defect} выжил`).toBeInstanceOf(Error);
}

afterEach(() => vi.restoreAllMocks());

describe('корректность и детерминизм', () => {
  it('verify проходит на эталоне и на независимой правильной реализации', () => {
    assertUsable();
    expect(outcome(altFactory)?.message).toBeUndefined();
  });

  it('verify детерминирован: без Math.random и Date.now, повтор даёт тот же результат', () => {
    assertUsable();
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random запрещён');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now запрещён');
    });
    expect(outcome(makeFactory())?.message).toBeUndefined();
    const first = outcome(makeFactory('evict-mru'));
    const second = outcome(makeFactory('evict-mru'));
    expect(first).toBeInstanceOf(Error);
    expect(first?.message).toBe(second?.message);
    expect(first?.message).not.toMatch(/запрещён/);
  });
});

describe('мутанты: срок жизни', () => {
  it('запись жива и в момент t+ttl', () => expectKilled('ttl-boundary'));
  it('get продлевает срок жизни', () => expectKilled('get-extends-ttl'));
  it('перезапись не продлевает срок жизни', () => expectKilled('overwrite-keeps-ttl'));
  it('size считает просроченные записи', () => expectKilled('size-counts-expired'));
  it('delete просроченной записи возвращает true', () => expectKilled('delete-expired-true'));
});

describe('мутанты: порядок вытеснения', () => {
  it('get не обновляет порядок использования', () => expectKilled('get-no-touch'));
  it('has обновляет порядок использования', () => expectKilled('has-touches'));
  it('перезапись не обновляет порядок использования', () => expectKilled('overwrite-no-touch'));
  it('вытесняется самая свежая запись', () => expectKilled('evict-mru'));
  it('перезапись существующего ключа при полном кэше вытесняет лишнюю запись', () => expectKilled('overwrite-evicts'));
  it('просроченные не вычищаются перед вытеснением: гибнет живая запись', () => expectKilled('no-purge-before-evict'));
});

describe('мутанты: ёмкость, значения, валидация, долгая работа', () => {
  it('кэш держит capacity+1 записей', () => expectKilled('capacity-plus-one'));
  it('falsy-значения считаются отсутствующими', () => expectKilled('falsy-value'));
  it('capacity 0 принимается', () => expectKilled('capacity-zero-ok'));
  it('после многих операций вытесняется самая свежая запись', () => expectKilled('late-evict-mru'));
});

describe('DESIGN.md', () => {
  it('разделы «Решения», «Компромиссы», «Границы применимости» не короче 200 символов', () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../DESIGN.md');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    for (const h of ['Решения', 'Компромиссы', 'Границы применимости']) {
      const m = new RegExp(`^## ${h}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text);
      expect(m, h).not.toBeNull();
      expect(m![1]!.trim().length, h).toBeGreaterThanOrEqual(200);
    }
  });
});
