import { createYandexResponsesProvider, yandexAuthHeader, yandexModelUri } from '@/server/llm/providers/yandex-responses';
import { LlmError, type CompleteRequest } from '@/server/llm/types';
import { fakeFetch, fixture } from './fake-fetch';

const tools: CompleteRequest['tools'] = [
  { name: 'read_document', description: 'Прочитать загруженный документ', parameters: { type: 'object', properties: { uploadId: { type: 'string' } }, required: ['uploadId'] } },
  { name: 'fetch_url', description: 'Скачать страницу', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
];

function make(replies: Parameters<typeof fakeFetch>[0], over: Partial<Parameters<typeof createYandexResponsesProvider>[0]> = {}) {
  const ff = fakeFetch(replies);
  const provider = createYandexResponsesProvider({
    apiKey: 'AQVN-test-key',
    folderId: 'b1gtestfolder',
    model: 'aliceai-llm',
    baseUrl: 'https://ai.api.cloud.yandex.net/v1',
    fetch: ff.fetch,
    ...over,
  });
  return { provider, calls: ff.calls };
}

const base: CompleteRequest = { purpose: 'consultant', system: 'Ты консультант.', messages: [{ role: 'user', content: 'Вот резюме и ссылка' }] };

describe('yandex-responses: запрос', () => {
  it('URI модели, Api-Key, project, tools и tool_choice в формате Responses API', async () => {
    const { provider, calls } = make([{ body: fixture('yandex-tool-calls') }]);
    await provider.complete({ ...base, tools, toolChoice: { name: 'read_document' }, temperature: 0.2, maxTokens: 500 });
    const [c] = calls;
    expect(c?.url).toBe('https://ai.api.cloud.yandex.net/v1/responses');
    expect(c?.headers.get('authorization')).toBe('Api-Key AQVN-test-key');
    expect(c?.headers.get('openai-project')).toBe('b1gtestfolder');
    expect(c?.body).toMatchObject({
      model: 'gpt://b1gtestfolder/aliceai-llm',
      instructions: 'Ты консультант.',
      input: [{ role: 'user', content: 'Вот резюме и ссылка' }],
      store: false,
      temperature: 0.2,
      max_output_tokens: 500,
      tool_choice: { type: 'function', name: 'read_document' },
    });
    expect(c?.body.tools).toEqual([
      { type: 'function', name: 'read_document', description: 'Прочитать загруженный документ', parameters: tools?.[0]?.parameters, strict: false },
      { type: 'function', name: 'fetch_url', description: 'Скачать страницу', parameters: tools?.[1]?.parameters, strict: false },
    ]);
  });

  it('история вызовов: function_call и function_call_output с call_id', async () => {
    const { provider, calls } = make([{ body: fixture('yandex-text') }]);
    await provider.complete({
      ...base,
      tools,
      messages: [
        { role: 'user', content: 'резюме' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'read_document', arguments: { uploadId: 'up_1' } }] },
        { role: 'tool', toolCallId: 'call_1', content: '{"text":"Java, Spring"}' },
      ],
    });
    expect(calls[0]?.body.input).toEqual([
      { role: 'user', content: 'резюме' },
      { type: 'function_call', call_id: 'call_1', name: 'read_document', arguments: '{"uploadId":"up_1"}' },
      { type: 'function_call_output', call_id: 'call_1', output: '{"text":"Java, Spring"}' },
    ]);
    expect(calls[0]?.body.tool_choice).toBe('auto');
  });

  it('schema → text.format json_schema; без нативной схемы – инструкция в instructions', async () => {
    const schema = { name: 'claims', jsonSchema: { type: 'object', properties: { claims: { type: 'array' } }, required: ['claims'] } };
    const a = make([{ body: fixture('yandex-json') }]);
    await a.provider.complete({ ...base, purpose: 'extractor', schema });
    expect(a.calls[0]?.body.text).toEqual({ format: { type: 'json_schema', name: 'claims', schema: schema.jsonSchema, strict: false } });

    const b = make([{ body: fixture('yandex-json') }], { supportsJsonSchema: false, strict: true });
    await b.provider.complete({ ...base, purpose: 'extractor', schema });
    expect(b.calls[0]?.body.text).toBeUndefined();
    expect(String(b.calls[0]?.body.instructions)).toContain('"claims"');
  });

  it('IAM-токен уходит как Bearer; готовый gpt:// не переписывается', () => {
    expect(yandexAuthHeader('t1.9euelZqabc')).toBe('Bearer t1.9euelZqabc');
    expect(yandexAuthHeader('AQVNabc')).toBe('Api-Key AQVNabc');
    expect(yandexModelUri('f', 'gpt://other/aliceai-llm/latest')).toBe('gpt://other/aliceai-llm/latest');
  });
});

describe('yandex-responses: ответ', () => {
  it('параллельные function_call → tool_calls с разобранными аргументами и usage', async () => {
    const { provider } = make([{ body: fixture('yandex-tool-calls') }]);
    const r = await provider.complete({ ...base, tools });
    expect(r.kind).toBe('tool_calls');
    expect(r.toolCalls).toEqual([
      { id: 'call_read_1', name: 'read_document', arguments: { uploadId: 'up_1' } },
      { id: 'call_fetch_2', name: 'fetch_url', arguments: { url: 'https://github.com/example-dev' } },
    ]);
    expect(r.usage).toEqual({ inputTokens: 812, outputTokens: 41 });
    expect(r).toMatchObject({ provider: 'yandex', model: 'gpt://b1gtestfolder/aliceai-llm' });
  });

  it('текст из message/output_text', async () => {
    const { provider } = make([{ body: fixture('yandex-text') }]);
    const r = await provider.complete(base);
    expect(r).toMatchObject({ kind: 'text', text: 'Привет! Пришли резюме – соберу профиль.', usage: { inputTokens: 120, outputTokens: 14 } });
  });

  it('json по схеме → kind json', async () => {
    const { provider } = make([{ body: fixture('yandex-json') }]);
    const r = await provider.complete({ ...base, schema: { name: 'claims', jsonSchema: { type: 'object' } } });
    expect(r.kind).toBe('json');
    expect(r.json).toEqual({ claims: [{ catalogId: 'be.cache', quote: 'Добавил кэширование справочников в Redis' }] });
  });

  it('невалидный JSON при схеме → kind text с сырым текстом (ремонт – у вызывающего)', async () => {
    const body = fixture('yandex-text');
    const { provider } = make([{ body }]);
    const r = await provider.complete({ ...base, schema: { name: 'x', jsonSchema: { type: 'object' } } });
    expect(r.kind).toBe('text');
    expect(r.json).toBeUndefined();
  });

  it('status failed → LlmError server_error', async () => {
    const { provider } = make([{ body: fixture('yandex-failed') }]);
    await expect(provider.complete(base)).rejects.toMatchObject({ name: 'LlmError', code: 'server_error' });
  });
});

describe('yandex-responses: ошибки HTTP → LlmError', () => {
  it.each([
    [429, 'error-429', 'rate_limited'],
    [503, 'error-503', 'server_error'],
    [401, 'error-401', 'auth'],
    [403, 'error-401', 'auth'],
    [400, 'error-400', 'bad_request'],
  ])('%i → %s', async (status, fx, code) => {
    const { provider, calls } = make([{ status, body: fixture(fx) }]);
    const err = await provider.complete(base).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code, status });
    expect(String((err as Error).message)).not.toContain('AQVN-test-key');
    expect(calls).toHaveLength(1); // SDK сам не ретраит (maxRetries: 0)
  });

  it('отмена сигналом с причиной-таймаутом → LlmError timeout', async () => {
    const { provider } = make([
      (signal) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    ]);
    const ctrl = new AbortController();
    const p = provider.complete(base, ctrl.signal);
    ctrl.abort(new LlmError('timeout', 'LLM не ответила за 10 мс'));
    await expect(p).rejects.toMatchObject({ code: 'timeout' });
  });

  it('сетевой сбой → server_error без статуса (client ретраит)', async () => {
    const provider = createYandexResponsesProvider({
      apiKey: 'k',
      folderId: 'f',
      model: 'm',
      baseUrl: 'https://ai.api.cloud.yandex.net/v1',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(provider.complete(base)).rejects.toMatchObject({ code: 'server_error', status: undefined });
  });
});
