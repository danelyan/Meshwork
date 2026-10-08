import { countOf, FORMS, plural, stripLimitsPrefix } from '@/lib/plural';

describe('plural', () => {
  it.each([
    [0, 'строк'], [1, 'строка'], [2, 'строки'], [4, 'строки'], [5, 'строк'], [11, 'строк'], [12, 'строк'],
    [14, 'строк'], [21, 'строка'], [29, 'строк'], [101, 'строка'], [111, 'строк'], [112, 'строк'],
  ])('%i → %s', (n, word) => expect(plural(n, FORMS.line)).toBe(word));

  it('countOf', () => {
    expect(countOf(4, FORMS.line)).toBe('4 строки');
    expect(countOf(1, FORMS.line)).toBe('1 строка');
    expect(countOf(3, FORMS.repeat)).toBe('3 повтора');
    expect(countOf(5, FORMS.claim)).toBe('5 утверждений');
  });

  it('stripLimitsPrefix: один префикс при старых и новых данных', () => {
    expect(stripLimitsPrefix('Не доказывает: прикладную разработку')).toBe('прикладную разработку');
    expect(stripLimitsPrefix('прикладную разработку')).toBe('прикладную разработку');
    expect(stripLimitsPrefix('не доказывает : x')).toBe('x');
  });
});
