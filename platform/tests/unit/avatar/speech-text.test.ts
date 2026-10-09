import { cleanForSpeech, speechText, truncateForSpeech } from '@/lib/speech-text';

describe('cleanForSpeech: markdown вслух не читается', () => {
  it('выделение, заголовки, списки, цитаты', () => {
    const md = '## План\n- **Go** и *Kafka*\n- `docker` _compose_\n> цитата\n1. Шаг первый';
    expect(cleanForSpeech(md)).toBe('План. Go и Kafka. docker compose. цитата. Шаг первый');
  });

  it('ссылки: текст ссылки, голый URL — «ссылка»; картинки — подпись; код выпадает', () => {
    expect(cleanForSpeech('Открой [профиль](/profile) или https://fsp.ru/x?a=1.')).toBe('Открой профиль или ссылка');
    expect(cleanForSpeech('Пример:\n```ts\nconst a = 1;\n```\nГотово!')).toBe('Пример: Готово!');
    expect(cleanForSpeech('![схема](a.png) ок')).toBe('схема ок');
  });

  it('таблицы, html и эмодзи', () => {
    expect(cleanForSpeech('| Навык | Уровень |\n|---|---|\n| Go | middle |')).toBe('Навык, Уровень. Go, middle');
    expect(cleanForSpeech('<b>Жирно</b> 🚀 готово')).toBe('Жирно готово');
  });

  it('незнаки внутри слов не трогает: snake_case и 2*3', () => {
    expect(cleanForSpeech('Поле user_id и 2*3=6')).toBe('Поле user_id и 2*3=6');
  });
});

describe('truncateForSpeech', () => {
  it('короткий текст — как есть', () => expect(truncateForSpeech('Привет.', 100)).toBe('Привет.'));
  it('режет по концу предложения', () => {
    const t = 'Первое предложение тут. Второе предложение длиннее и не влезает целиком.';
    expect(truncateForSpeech(t, 40)).toBe('Первое предложение тут.');
  });
  it('без конца предложения — по слову с многоточием, не длиннее лимита', () => {
    const t = 'слово '.repeat(50);
    const r = truncateForSpeech(t, 30);
    expect(r.endsWith('…')).toBe(true);
    expect(r.length).toBeLessThanOrEqual(30);
  });
  it('speechText = чистка + обрезка до 1000', () => {
    expect(speechText(`**${'а'.repeat(2000)}**`).length).toBeLessThanOrEqual(1000);
  });
});
