import { z } from 'zod';
import { completeJson, parseJsonLoose, schemaSpec, toolSpec, zodToJsonSchema } from '@/server/llm';
import { LlmError, type CompleteRequest, type CompleteResult, type LlmProvider } from '@/server/llm/types';

describe('Zod → JSON Schema', () => {
  const args = z.object({
    url: z.string().describe('Адрес страницы'),
    depth: z.number().int().min(1).max(3).default(1),
    kind: z.enum(['github', 'url']).optional(),
  });

  it('input-режим: default и optional не обязательны, без $schema и additionalProperties', () => {
    const s = zodToJsonSchema(args);
    expect(s.$schema).toBeUndefined();
    expect(s).toMatchObject({
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Адрес страницы' },
        depth: { type: 'integer', minimum: 1, maximum: 3, default: 1 },
        kind: { type: 'string', enum: ['github', 'url'] },
      },
      required: ['url'],
    });
    expect(s.additionalProperties).toBeUndefined();
  });

  it('toolSpec и schemaSpec; имя схемы чистится под [A-Za-z0-9_-]', () => {
    expect(toolSpec('fetch_url', 'Скачать', args)).toMatchObject({ name: 'fetch_url', description: 'Скачать', parameters: { type: 'object' } });
    expect(schemaSpec('claims v1.0', z.object({ a: z.string() })).name).toBe('claims_v1_0');
  });

  it('непредставимый тип (date) – ошибка, а не молча пустая схема', () => {
    expect(() => zodToJsonSchema(z.object({ at: z.date() }))).toThrow();
  });
});

describe('parseJsonLoose', () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['Вот:\n```json\n{"a":2}\n```', { a: 2 }],
    ['<think>{"x":0}</think>{"a":3}', { a: 3 }],
    ['Ответ: {"a":"}{"} и всё', { a: '}{' }],
    ['[1,2]', [1, 2]],
  ])('%s', (text, value) => {
    expect(parseJsonLoose(text)).toEqual({ ok: true, value });
  });

  it('ошибки: пусто, нет JSON, обрезан', () => {
    expect(parseJsonLoose('  ')).toMatchObject({ ok: false });
    expect(parseJsonLoose('просто текст')).toEqual({ ok: false, error: 'в ответе нет JSON' });
    expect(parseJsonLoose('{"a":')).toMatchObject({ ok: false, error: expect.stringMatching(/обрезан/) });
  });
});

describe('completeJson: один ремонт', () => {
  const schema = z.object({ grade: z.enum(['junior', 'middle']) });
  const req: CompleteRequest = { purpose: 'extractor', system: 's', messages: [{ role: 'user', content: 'резюме' }], schema: schemaSpec('grade', schema) };
  const r = (over: Partial<CompleteResult>): CompleteResult => ({ kind: 'text', usage: { inputTokens: 5, outputTokens: 2 }, latencyMs: 1, provider: 'p', model: 'm', ...over });
  const provider = (...outs: CompleteResult[]) => {
    const complete = vi.fn<LlmProvider['complete']>();
    for (const o of outs) complete.mockResolvedValueOnce(o);
    return { llm: { name: 'p', model: 'm', supportsTools: true, supportsJsonSchema: true, complete } satisfies LlmProvider, complete };
  };

  it('валидно сразу', async () => {
    const { llm, complete } = provider(r({ kind: 'json', json: { grade: 'middle' } }));
    await expect(completeJson(llm, req, schema)).resolves.toMatchObject({ value: { grade: 'middle' }, repaired: false });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('не по схеме → ремонт с ошибкой Zod → валидно', async () => {
    const { llm, complete } = provider(r({ kind: 'json', json: { grade: 'senior' } }), r({ text: '{"grade":"junior"}' }));
    const out = await completeJson(llm, req, schema);
    expect(out).toMatchObject({ value: { grade: 'junior' }, repaired: true, usage: { inputTokens: 10, outputTokens: 4 } });
    expect(complete.mock.calls[1]?.[0].messages.at(-1)?.content).toMatch(/не по схеме: grade/);
  });

  it('дважды невалидно → invalid_output', async () => {
    const { llm } = provider(r({ text: 'не json' }), r({ text: '{"grade":1}' }));
    const err = await completeJson(llm, req, schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: 'invalid_output' });
  });
});
