import { describe, expect, it } from 'vitest';

import { classifyAck } from '@/lib/ack-rules';

const cases: [string, 'think' | 'listen' | null, number?][] = [
  ['', null],
  ['Алло, вы меня слышите?', null],
  ['Ты тут?', null],
  ['Меня слышно', null],
  ['До свидания', null],
  ['Ну всё, спасибо, всего доброго', null],
  ['Спасибо большое', null],
  ['Здравствуйте', null],
  ['Добрый день', null],
  ['Стоп', null],
  ['Подожди, не надо', null],
  ['Угу', null],
  ['Понятно', null],
  ['Как вы оцениваете мой уровень?', 'think', 0.8],
  ['Почему именно этот грейд', 'think', 0.8],
  ['Можно я подумаю', 'think', 0.8],
  ['А если задача будет сложнее?', 'think', 0.8],
  ['Я работал над сервисом оплаты на Go, там были очереди и ретраи', 'listen', 0.6],
  ['Делал бэкенд на питоне', 'listen', 0.35],
  ['Спасибо, а сколько это займёт?', 'think', 0.8],
];

describe('classifyAck', () => {
  it.each(cases)('%s', (text, kind, p) => {
    const r = classifyAck(text);
    expect(r.kind).toBe(kind);
    if (p !== undefined) expect(r.p).toBe(p);
    expect(r.why).toBeTruthy();
  });
});
