// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { describe, expect, it } from 'vitest';

import { buildPrompt, classify, ClassifyError, ReplyError, parseReply } from '../src/classify';
import type { Llm } from '../src/llm';

const labels = ['billing', 'bug', 'other'];
const input = { text: '  Списали деньги дважды  ', labels };

function scripted(replies: Array<string | Error>): Llm & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async complete(prompt) {
      prompts.push(prompt);
      const r = replies.shift();
      if (r === undefined) throw new Error('ответов больше нет');
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

async function fail(p: Promise<unknown>): Promise<ClassifyError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ClassifyError);
    return e as ClassifyError;
  }
  throw new Error('ожидалась ClassifyError');
}

describe('buildPrompt', () => {
  it('содержит текст без внешних пробелов, все метки и слова про JSON', () => {
    const p = buildPrompt(input);
    expect(p).toContain('Списали деньги дважды');
    expect(p).not.toContain('  Списали');
    for (const l of labels) expect(p).toContain(l);
    expect(p).toContain('JSON');
    expect(p).toContain('confidence');
  });
});

describe('parseReply', () => {
  it('голый JSON', () => {
    expect(parseReply('{"label":"other","confidence":0}', labels)).toEqual({ label: 'other', confidence: 0 });
  });

  it('текст вокруг и лишние ключи', () => {
    expect(parseReply('Конечно! {"label":"bug","confidence":1,"why":"x"} Надеюсь, помогло.', labels)).toEqual({ label: 'bug', confidence: 1 });
  });

  it('нет объекта и битый JSON – ReplyError', () => {
    for (const raw of ['', 'bug', '["bug", 1]', '{"label":"bug",', '{}']) {
      expect(() => parseReply(raw, labels), raw).toThrow(ReplyError);
    }
  });

  it('метка должна совпадать точно', () => {
    for (const label of ['Bug', ' bug', 'refund', 3, null]) {
      expect(() => parseReply(JSON.stringify({ label, confidence: 0.5 }), labels)).toThrow(ReplyError);
    }
  });

  it('confidence – число от 0 до 1', () => {
    for (const c of ['0.9', -0.1, 1.01, null]) {
      expect(() => parseReply(JSON.stringify({ label: 'bug', confidence: c }), labels)).toThrow(ReplyError);
    }
    expect(() => parseReply('{"label":"bug"}', labels)).toThrow(ReplyError);
  });

  it('сообщение называет поле', () => {
    expect(() => parseReply('{"label":"zzz","confidence":0.5}', labels)).toThrow(/label/);
    expect(() => parseReply('{"label":"bug","confidence":7}', labels)).toThrow(/confidence/);
  });
});

describe('classify', () => {
  it('первый prompt равен buildPrompt', async () => {
    const llm = scripted(['{"label":"billing","confidence":0.95}']);
    const r = await classify(llm, input);
    expect(r).toEqual({ label: 'billing', confidence: 0.95, attempts: 1 });
    expect(llm.prompts).toEqual([buildPrompt(input)]);
  });

  it('повтор: prompt начинается с базового и содержит прошлый ответ и причину', async () => {
    const llm = scripted(['{"label":"refund","confidence":0.5}', '{"label":"billing","confidence":0.6}']);
    const r = await classify(llm, input);
    expect(r.attempts).toBe(2);
    expect(llm.prompts[1].startsWith(buildPrompt(input) + '\n\n')).toBe(true);
    expect(llm.prompts[1]).toContain('{"label":"refund","confidence":0.5}');
    expect(llm.prompts[1]).toContain('label');
  });

  it('третья попытка успешна', async () => {
    const llm = scripted(['x', 'y', '{"label":"other","confidence":0.1}']);
    expect((await classify(llm, input)).attempts).toBe(3);
  });

  it('исчерпание попыток – invalid_output с числом попыток', async () => {
    const llm = scripted(['a', 'b', 'c', 'd']);
    const e = await fail(classify(llm, input));
    expect(e.code).toBe('invalid_output');
    expect(e.attempts).toBe(3);
    expect(llm.prompts).toHaveLength(3);
  });

  it('maxAttempts учитывается', async () => {
    const llm = scripted(['a', 'b']);
    const e = await fail(classify(llm, input, { maxAttempts: 1 }));
    expect(e.code).toBe('invalid_output');
    expect(llm.prompts).toHaveLength(1);
    const llm2 = scripted(['a', 'b', 'c', 'd', '{"label":"bug","confidence":0.4}']);
    expect((await classify(llm2, input, { maxAttempts: 5 })).attempts).toBe(5);
  });

  it('ошибка модели – llm_failed без повтора, причина в cause', async () => {
    const boom = new Error('timeout');
    const llm = scripted(['мусор', boom]);
    const e = await fail(classify(llm, input));
    expect(e.code).toBe('llm_failed');
    expect(e.attempts).toBe(2);
    expect(e.cause).toBe(boom);
    expect(llm.prompts).toHaveLength(2);
  });

  it('некорректный вход – bad_request, модель не вызывается', async () => {
    const bad = [
      { text: '   ', labels },
      { text: 'x', labels: ['one'] },
      { text: 'x', labels: ['a', 'a'] },
      { text: 'x', labels: ['a', ' '] },
      { text: 'x', labels: ['a', 5 as unknown as string] },
    ];
    for (const b of bad) {
      const llm = scripted(['{"label":"a","confidence":1}']);
      expect((await fail(classify(llm, b))).code).toBe('bad_request');
      expect(llm.prompts).toHaveLength(0);
    }
    for (const maxAttempts of [0, 1.5, -2]) {
      const llm = scripted([]);
      expect((await fail(classify(llm, input, { maxAttempts }))).code).toBe('bad_request');
    }
  });

  it('пустой ответ модели считается невалидным и даёт повтор', async () => {
    const llm = scripted(['', '{"label":"bug","confidence":0.3}']);
    expect((await classify(llm, input)).attempts).toBe(2);
  });
});
