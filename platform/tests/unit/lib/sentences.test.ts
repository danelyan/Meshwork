import { heardPrefix, isBackchannel, splitSentences } from '@/lib/sentences';

describe('разбиение реплики на предложения (общее для озвучки и перебивания)', () => {
  it('режет по концу предложения, короткие куски клеит к следующему', () => {
    expect(splitSentences('Привет! Начнём со знакомства. Расскажи про последний проект: за что отвечал лично ты?')).toEqual([
      'Привет! Начнём со знакомства.',
      'Расскажи про последний проект: за что отвечал лично ты?',
    ]);
    expect(splitSentences('Да. Нет. Это всё было давно и неправда.')).toEqual(['Да. Нет. Это всё было давно и неправда.']);
  });

  it('хвост короче минимума — к последнему предложению; длинный текст без точек режется по пробелу', () => {
    expect(splitSentences('Первое длинное предложение здесь. Ок.')).toEqual(['Первое длинное предложение здесь. Ок.']);
    const long = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ');
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 160)).toBe(true);
    expect(parts.join(' ')).toBe(long);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('услышанный префикс и хвост по числу предложений', () => {
    const text = 'Первое предложение длинное. Второе предложение длинное. Третье предложение длинное.';
    expect(heardPrefix(text, 1)).toEqual({ heard: 'Первое предложение длинное.', tail: 'Второе предложение длинное. Третье предложение длинное.', total: 3 });
    expect(heardPrefix(text, 0).heard).toBe('');
    expect(heardPrefix(text, 9)).toMatchObject({ tail: '', total: 3 });
  });

  it('поддакивание — не перебивание', () => {
    for (const t of ['угу', 'Да-да.', 'ага, понятно', 'Хорошо', 'Ясно!']) expect(isBackchannel(t), t).toBe(true);
    for (const t of ['да, но я бы сделал иначе', 'понятно, а что с индексами', '', 'ок давай']) expect(isBackchannel(t), t).toBe(false);
  });
});
