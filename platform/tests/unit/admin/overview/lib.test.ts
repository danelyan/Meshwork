import { describe, expect, it } from 'vitest';

import { ListBase, PAGE_SIZE, maskEmail, maskName, oneOf, paged, parsePseudonym, skipOf } from '@/server/admin/overview/lib';
import { pseudonym } from '@/server/employer/privacy';

describe('маски ПДн в списках', () => {
  it('почта: от неё остаются первая буква и домен-контур, но не весь адрес', () => {
    expect(maskEmail('ivan.petrov@yandex.ru')).toBe('i***@y***.ru');
    expect(maskEmail('a@b')).toBe('a***@b***');
    expect(maskEmail('no-at')).toBe('***');
    expect(maskEmail(null)).toBeNull();
  });

  it('имя: инициал и первая буква фамилии', () => {
    expect(maskName('Иван Петров')).toBe('И. П***');
    expect(maskName('Иван')).toBe('И***');
    expect(maskName('  ')).toBeNull();
  });
});

describe('псевдоним в запросе поиска', () => {
  it('понимает «Кандидат #AB12CD», «#ab12cd» и голые шесть символов', () => {
    expect(parsePseudonym('Кандидат #ab12cd')).toBe('AB12CD');
    expect(parsePseudonym('#AB12CD')).toBe('AB12CD');
    expect(parsePseudonym('ab12cd')).toBe('AB12CD');
    expect(parsePseudonym('ivan')).toBeNull();
    expect(parsePseudonym('ab12cde')).toBeNull();
  });

  it('совпадает с тем, что выдаёт pseudonym()', () => {
    const p = pseudonym('cand-1');
    expect(parsePseudonym(p)).toBe(p.slice(-6));
  });
});

describe('разбор параметров списка', () => {
  it('мусорная страница → 1, пустой поиск → undefined, строка режется по trim', () => {
    expect(ListBase.parse({ page: 'abc', q: '  ' })).toEqual({ page: 1, q: undefined });
    expect(ListBase.parse({ page: '3', q: ' x ' })).toEqual({ page: 3, q: 'x' });
    expect(ListBase.parse({})).toEqual({ page: 1, q: undefined });
  });

  it('значение фильтра вне перечня отбрасывается', () => {
    const f = oneOf(['a', 'b'] as const);
    expect(f.parse('a')).toBe('a');
    expect(f.parse('zzz')).toBeUndefined();
    expect(f.parse('')).toBeUndefined();
    expect(f.parse(undefined)).toBeUndefined();
  });

  it('страницы: смещение и число страниц', () => {
    expect(skipOf(1)).toBe(0);
    expect(skipOf(3)).toBe(2 * PAGE_SIZE);
    expect(paged([], 0, 1).pages).toBe(1);
    expect(paged([], PAGE_SIZE + 1, 1).pages).toBe(2);
  });
});
