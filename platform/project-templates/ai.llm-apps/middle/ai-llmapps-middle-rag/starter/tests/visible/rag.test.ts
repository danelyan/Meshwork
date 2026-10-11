// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { answer, buildIndex, chunkText, retrieve } from '../../src/rag';

const DOCS = [
  { id: 'vacation.md', text: 'Ежегодный оплачиваемый отпуск составляет 28 календарных дней.' },
  { id: 'remote.md', text: 'Удалённо можно работать до трёх дней в неделю.' },
];

describe('rag (visible)', () => {
  it('chunkText: окна с перекрытием', () => {
    expect(chunkText('abcdefghij', { size: 4, overlap: 1 })).toEqual(['abcd', 'defg', 'ghij']);
  });

  it('retrieve: нужный документ первым', () => {
    const hits = retrieve(buildIndex(DOCS), 'сколько дней отпуск');
    expect(hits[0]!.docId).toBe('vacation.md');
  });

  it('answer: цитаты из контекста', async () => {
    const llm = { complete: async () => 'Отпуск – 28 дней [vacation.md#0].' };
    const res = await answer('Сколько дней отпуск?', { index: buildIndex(DOCS), llm });
    expect(res).toMatchObject({ refused: false, citations: ['vacation.md#0'] });
  });
});
