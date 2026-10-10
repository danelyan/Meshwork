import { describe, expect, it } from 'vitest';

import { phraseAt, splitPhrases } from '@/components/avatar/phrases';

describe('splitPhrases', () => {
  it('режет по предложениям и снимает markdown', () => {
    expect(splitPhrases('**Привет!** Как дела? Расскажи про опыт.')).toEqual(['Привет!', 'Как дела?', 'Расскажи про опыт.']);
  });
  it('пустой текст — нет фраз', () => expect(splitPhrases('')).toEqual([]));
  it('без точки в конце остаётся одной фразой', () => expect(splitPhrases('Просто текст')).toEqual(['Просто текст']));
});

describe('phraseAt', () => {
  const ph = ['aaaa', 'bbbbbbbb', 'cccc']; // 4 + 8 + 4 символов
  it('прогресс → фраза по доле символов', () => {
    expect(phraseAt(ph, 0)).toBe(0);
    expect(phraseAt(ph, 0.3)).toBe(1);
    expect(phraseAt(ph, 0.9)).toBe(2);
    expect(phraseAt(ph, 1)).toBe(2);
  });
  it('нет фраз — -1', () => expect(phraseAt([], 0.5)).toBe(-1));
});
