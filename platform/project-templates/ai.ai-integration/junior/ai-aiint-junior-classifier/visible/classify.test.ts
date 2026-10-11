// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { classify, ClassifyError, parseReply } from '../../src/classify';
import type { Llm } from '../../src/llm';

const labels = ['billing', 'bug', 'other'];

function scripted(replies: string[]): Llm & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async complete(prompt) {
      prompts.push(prompt);
      return replies.shift() ?? '';
    },
  };
}

describe('классификатор (visible)', () => {
  it('разбирает JSON в ограде', () => {
    expect(parseReply('```json\n{"label":"bug","confidence":0.8}\n```', labels)).toEqual({ label: 'bug', confidence: 0.8 });
  });

  it('возвращает метку и число попыток', async () => {
    const llm = scripted(['{"label":"billing","confidence":0.9}']);
    expect(await classify(llm, { text: 'Списали дважды', labels })).toEqual({ label: 'billing', confidence: 0.9, attempts: 1 });
  });

  it('повторяет запрос при невалидном ответе', async () => {
    const llm = scripted(['не знаю', '{"label":"bug","confidence":0.7}']);
    const r = await classify(llm, { text: 'Кнопка не нажимается', labels });
    expect(r.attempts).toBe(2);
    expect(llm.prompts[1]).toContain('не знаю');
  });

  it('пустой текст – bad_request', async () => {
    await expect(classify(scripted([]), { text: '  ', labels })).rejects.toBeInstanceOf(ClassifyError);
  });
});
