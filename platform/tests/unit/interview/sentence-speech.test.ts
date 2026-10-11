import { splitSentences } from '@/lib/sentences';
import { MAX_TTS_PARTS, keyOf, parseKey, sentencesHeard, ttsParts } from '@/components/interview/useSentenceSpeech';

describe('озвучка по предложениям: части TTS ↔ предложения сервера', () => {
  const six = 'Первое предложение реплики. Второе предложение реплики! Третье предложение реплики? Четвёртое предложение реплики. Пятое предложение реплики. Шестое предложение реплики.';

  it('до четырёх предложений – часть на предложение, счёт совпадает с сервером', () => {
    const text = 'Привет! Начнём со знакомства. Расскажи про последний проект: за что отвечал лично ты?';
    const parts = ttsParts(text);
    expect(parts.map((p) => p.sentences)).toEqual(splitSentences(text).map(() => 1));
    expect(sentencesHeard(parts, 1)).toBe(1);
    expect(sentencesHeard(parts, 9)).toBe(splitSentences(text).length);
  });

  it('больше четырёх предложений – соседние склеиваются, но услышанные предложения считаются по группам', () => {
    expect(splitSentences(six)).toHaveLength(6);
    const parts = ttsParts(six);
    expect(parts.length).toBeLessThanOrEqual(MAX_TTS_PARTS);
    expect(parts.reduce((s, p) => s + p.sentences, 0)).toBe(6);
    expect(sentencesHeard(parts, 2)).toBe(4);
    expect(sentencesHeard(parts, 0)).toBe(0);
  });

  it('чистка markdown идёт по предложению и не меняет счёт', () => {
    const text = 'Смотри **важно**: `код` здесь. Второе предложение со [ссылкой](http://x). Третье.';
    const parts = ttsParts(text);
    expect(parts.reduce((s, p) => s + p.sentences, 0)).toBe(splitSentences(text).length);
    expect(parts.every((p) => !/[*`\[]/.test(p.text))).toBe(true);
  });

  it('ключи озвучки разбираются обратно', () => {
    expect(parseKey(keyOf(7, 2))).toEqual({ index: 7, part: 2 });
    expect(parseKey('x')).toBeNull();
    expect(parseKey(null)).toBeNull();
  });
});
