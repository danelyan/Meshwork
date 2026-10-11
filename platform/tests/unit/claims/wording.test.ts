import { WORDING_MAX, wordingFor, wordingFromQuote } from '@/server/claims/wording';

const QUOTE = 'Получала данные с API через fetch, показывала состояния загрузки и ошибки.';

describe('wordingFor: формулировка в границах цитаты', () => {
  it('принимает формулировку модели без новых технологий и чисел', () => {
    expect(wordingFor('получала данные с API через fetch: состояния загрузки и ошибки', QUOTE)).toBe(
      'Получала данные с API через fetch: состояния загрузки и ошибки',
    );
  });

  it('технология, которой нет в цитате, – откат к цитате', () => {
    expect(wordingFor('Получала данные через axios и React Query', QUOTE)).toBe(wordingFromQuote(QUOTE));
  });

  it('число, которого нет в цитате, – откат', () => {
    expect(wordingFor('Добавила 12 эндпоинтов', 'добавила 9 эндпоинтов с валидацией')).toBe('Добавила 9 эндпоинтов с валидацией');
  });

  it('сильно длиннее цитаты – откат', () => {
    const long = 'Получала данные с сервера, обрабатывала состояния загрузки и ошибки, отменяла запросы, разбирала гонки ответов и кэшировала результаты';
    expect(wordingFor(long, 'Получала данные, показывала ошибки.')).toBe('Получала данные, показывала ошибки');
  });

  it('пусто или нет – формулировка из цитаты', () => {
    expect(wordingFor(undefined, QUOTE)).toBe('Получала данные с API через fetch, показывала состояния загрузки и ошибки');
    expect(wordingFor('  ', QUOTE)).toBe(wordingFromQuote(QUOTE));
  });
});

describe('wordingFromQuote', () => {
  it('снимает маркер списка и точку, первая буква заглавная', () => {
    expect(wordingFromQuote('- писал миграции на Alembic.')).toBe('Писал миграции на Alembic');
  });
  it('длинная цитата обрезается по слову', () => {
    const w = wordingFromQuote('слово '.repeat(60));
    expect(w.length).toBeLessThanOrEqual(WORDING_MAX);
    expect(w.endsWith('…')).toBe(true);
  });
});
