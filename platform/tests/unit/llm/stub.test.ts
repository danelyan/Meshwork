import { z } from 'zod';

import { clearStubResponses, createStubProvider, minimalFromSchema, registerStubResponse } from '@/server/llm/providers/stub';
import type { CompleteRequest, ToolSpec } from '@/server/llm/types';

const tools: ToolSpec[] = [
  { name: 'fetch_url', description: 'read url', parameters: { type: 'object', properties: { url: { type: 'string' } } } },
  { name: 'get_profile', description: 'profile', parameters: { type: 'object' } },
];

const base = (content: string, extra: Partial<CompleteRequest> = {}): CompleteRequest => ({
  purpose: 'consultant',
  system: 'sys',
  messages: [{ role: 'user', content }],
  ...extra,
});

afterEach(() => clearStubResponses());

describe('stub provider', () => {
  const llm = createStubProvider();

  it('маркеры [[tool:...]] → tool_calls с аргументами (включая вложенный JSON)', async () => {
    const res = await llm.complete(
      base('прочитай [[tool:fetch_url {"url":"https://e.x/a","opts":{"deep":true}}]] и [[tool:get_profile]]', { tools }),
    );
    expect(res.kind).toBe('tool_calls');
    expect(res.toolCalls).toEqual([
      { id: 'call_1_fetch_url', name: 'fetch_url', arguments: { url: 'https://e.x/a', opts: { deep: true } } },
      { id: 'call_2_get_profile', name: 'get_profile', arguments: {} },
    ]);
  });

  it('после результатов инструментов не зацикливается – отвечает текстом', async () => {
    const res = await llm.complete({
      purpose: 'consultant',
      system: 's',
      tools,
      messages: [
        { role: 'user', content: '[[tool:get_profile]]' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_profile', arguments: {} }] },
        { role: 'tool', content: '{"claims":[]}', toolCallId: 'c1' },
      ],
    });
    expect(res.kind).toBe('text');
    expect(res.text).toContain('get_profile');
  });

  it('toolChoice none игнорирует маркер; toolChoice {name} вызывает инструмент', async () => {
    expect((await llm.complete(base('[[tool:get_profile]]', { tools, toolChoice: 'none' }))).kind).toBe('text');
    const forced = await llm.complete(base('просто текст', { tools, toolChoice: { name: 'get_profile' } }));
    expect(forced.toolCalls).toEqual([{ id: 'call_1_get_profile', name: 'get_profile', arguments: {} }]);
  });

  it('schema → минимально валидный JSON по z.toJSONSchema', async () => {
    const Schema = z.object({
      claims: z.array(z.object({ catalogId: z.string(), confidence: z.enum(['low', 'medium', 'high']) })),
      count: z.number().int().min(1),
      note: z.string().optional(),
    });
    const res = await llm.complete(base('извлеки', { purpose: 'extractor', schema: { name: 'x', jsonSchema: z.toJSONSchema(Schema) } }));
    expect(res.kind).toBe('json');
    expect(Schema.parse(res.json)).toEqual({ claims: [], count: 1 });
  });

  it('[[json {...}]] в сообщении → этот JSON', async () => {
    const res = await llm.complete(base('ответ [[json {"claims":[{"catalogId":"be.http"}]}]]', { schema: { name: 'x', jsonSchema: {} } }));
    expect(res.json).toEqual({ claims: [{ catalogId: 'be.http' }] });
  });

  it('registerStubResponse подменяет ответ для purpose и снимается', async () => {
    const off = registerStubResponse('extractor', () => ({ json: { fixed: true } }));
    const req = base('x', { purpose: 'extractor', schema: { name: 'x', jsonSchema: { type: 'object' } } });
    expect((await llm.complete(req)).json).toEqual({ fixed: true });
    expect((await llm.complete({ ...req, purpose: 'consultant' })).json).toEqual({});
    off();
    expect((await llm.complete(req)).json).toEqual({});
  });

  it('[[error 429]] → LlmError со статусом', async () => {
    await expect(llm.complete(base('[[error 429]]'))).rejects.toMatchObject({ name: 'LlmError', status: 429, code: 'rate_limited' });
    await expect(llm.complete(base('[[error 503 упал]]'))).rejects.toMatchObject({ status: 503, message: 'упал' });
  });

  it('текст детерминирован; [[reply ...]] задаёт ответ', async () => {
    const a = await llm.complete(base('привет'));
    const b = await llm.complete(base('привет'));
    expect(a.text).toBe(b.text);
    expect(a.usage.inputTokens).toBeGreaterThan(0);
    expect((await llm.complete(base('[[reply Готово.]]'))).text).toBe('Готово.');
  });

  it('[[delay N]] уважает AbortSignal', async () => {
    const ctrl = new AbortController();
    const p = llm.complete(base('[[delay 5000]]'), ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('minimalFromSchema', () => {
  it('$ref/$defs, anyOf, nullable, const', () => {
    const schema = {
      type: 'object',
      required: ['a', 'b', 'c', 'd'],
      properties: {
        a: { $ref: '#/$defs/Item' },
        b: { anyOf: [{ type: 'string', minLength: 2 }, { type: 'null' }] },
        c: { type: ['null', 'boolean'] },
        d: { const: 'reply' },
      },
      $defs: { Item: { type: 'object', required: ['n'], properties: { n: { type: 'integer', minimum: 3 } } } },
    };
    expect(minimalFromSchema(schema)).toEqual({ a: { n: 3 }, b: 'xx', c: false, d: 'reply' });
  });
});
