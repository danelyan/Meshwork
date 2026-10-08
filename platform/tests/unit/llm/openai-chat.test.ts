import { createOpenAiChatProvider } from '@/server/llm/providers/openai-chat';
import { LlmError, type CompleteRequest } from '@/server/llm/types';
import { fakeFetch, fixture } from './fake-fetch';

const tools: CompleteRequest['tools'] = [
  { name: 'search_catalog', description: 'Найти навык в каталоге', parameters: { type: 'object', properties: { skill: { type: 'string' } }, required: ['skill'] } },
];
const base: CompleteRequest = { purpose: 'consultant', system: 'sys', messages: [{ role: 'user', content: 'Привет' }] };

function make(replies: Parameters<typeof fakeFetch>[0], over: Partial<Parameters<typeof createOpenAiChatProvider>[0]> = {}) {
  const ff = fakeFetch(replies);
  const provider = createOpenAiChatProvider({
    baseUrl: 'https://foundation-models.api.cloud.ru/v1',
    apiKey: 'cloudru-test-key',
    model: 'GigaChat-3.5-Ultra',
    name: 'cloudru',
    fetch: ff.fetch,
    ...over,
  });
  return { provider, calls: ff.calls };
}

describe('openai-chat: запрос', () => {
  it('Bearer, system первым, tools/tool_choice/response_format в формате Chat Completions', async () => {
    const { provider, calls } = make([{ body: fixture('chat-tool-calls') }]);
    await provider.complete({ ...base, tools, toolChoice: { name: 'search_catalog' }, maxTokens: 300, temperature: 0.3 });
    const c = calls[0];
    expect(c?.url).toBe('https://foundation-models.api.cloud.ru/v1/chat/completions');
    expect(c?.headers.get('authorization')).toBe('Bearer cloudru-test-key');
    expect(c?.body).toMatchObject({
      model: 'GigaChat-3.5-Ultra',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'Привет' },
      ],
      max_tokens: 300,
      temperature: 0.3,
      tool_choice: { type: 'function', function: { name: 'search_catalog' } },
      tools: [{ type: 'function', function: { name: 'search_catalog', description: 'Найти навык в каталоге', parameters: tools?.[0]?.parameters, strict: false } }],
    });
  });

  it('история: assistant.tool_calls и role tool с tool_call_id', async () => {
    const { provider, calls } = make([{ body: fixture('chat-text') }]);
    await provider.complete({
      ...base,
      tools,
      messages: [
        { role: 'user', content: 'что с Redis?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'search_catalog', arguments: { skill: 'Redis' } }] },
        { role: 'tool', toolCallId: 'c1', content: '[{"id":"be.cache"}]' },
      ],
    });
    expect((calls[0]?.body.messages as unknown[]).slice(1)).toEqual([
      { role: 'user', content: 'что с Redis?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_catalog', arguments: '{"skill":"Redis"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '[{"id":"be.cache"}]' },
    ]);
  });

  it('schema → response_format json_schema; без поддержки — в system', async () => {
    const schema = { name: 'grade', jsonSchema: { type: 'object', properties: { grade: { type: 'string' } } } };
    const a = make([{ body: fixture('chat-json-fenced') }]);
    await a.provider.complete({ ...base, schema });
    expect(a.calls[0]?.body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'grade', schema: schema.jsonSchema, strict: false } });

    const b = make([{ body: fixture('chat-json-fenced') }], { supportsJsonSchema: false });
    await b.provider.complete({ ...base, schema });
    expect(b.calls[0]?.body.response_format).toBeUndefined();
    expect((b.calls[0]?.body.messages as { content: string }[])[0]?.content).toContain('схеме «grade»');
  });
});

describe('openai-chat: ответ', () => {
  it('параллельные tool_calls; битые аргументы → { _raw }', async () => {
    const { provider } = make([{ body: fixture('chat-tool-calls') }]);
    const r = await provider.complete({ ...base, tools });
    expect(r.kind).toBe('tool_calls');
    expect(r.toolCalls).toEqual([
      { id: 'call_a', name: 'search_catalog', arguments: { skill: 'Redis' } },
      { id: 'call_b', name: 'search_catalog', arguments: { _raw: '{"skill":"Kafka"' } },
    ]);
    expect(r).toMatchObject({ usage: { inputTokens: 700, outputTokens: 30 }, provider: 'cloudru', model: 'GigaChat-3.5-Ultra' });
  });

  it('текст: рассуждения <think> вырезаются', async () => {
    const { provider } = make([{ body: fixture('chat-text') }]);
    const r = await provider.complete(base);
    expect(r).toMatchObject({ kind: 'text', text: 'Привет! Чем помочь?' });
  });

  it('json в ```json``` при схеме разбирается', async () => {
    const { provider } = make([{ body: fixture('chat-json-fenced') }]);
    const r = await provider.complete({ ...base, schema: { name: 'g', jsonSchema: { type: 'object' } } });
    expect(r).toMatchObject({ kind: 'json', json: { grade: 'middle', specialization: 'backend' } });
  });

  it('устаревший function_call тоже даёт tool_calls', async () => {
    const { provider } = make([
      { body: { choices: [{ message: { role: 'assistant', content: '', function_call: { name: 'search_catalog', arguments: '{"skill":"Go"}' } } }] } },
    ]);
    const r = await provider.complete({ ...base, tools });
    expect(r.toolCalls).toEqual([{ id: 'call_1', name: 'search_catalog', arguments: { skill: 'Go' } }]);
  });

  it('пустой choices → server_error', async () => {
    const { provider } = make([{ body: { choices: [] } }]);
    await expect(provider.complete(base)).rejects.toMatchObject({ code: 'server_error' });
  });
});

describe('openai-chat: ошибки', () => {
  it.each([
    [429, 'rate_limited'],
    [500, 'server_error'],
    [502, 'server_error'],
    [401, 'auth'],
    [422, 'bad_request'],
  ])('%i → %s', async (status, code) => {
    const { provider } = make([{ status, body: fixture('error-429') }]);
    const err = await provider.complete(base).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code, status });
  });
});

describe('createProvider по env', () => {
  it('yandex и openai-chat собираются из env без сети', async () => {
    const { parseEnv } = await import('@/server/env');
    const { createProvider } = await import('@/server/llm/providers');
    const common = { DATABASE_URL: 'postgresql://x@127.0.0.1:1/db', SESSION_SECRET: 's'.repeat(32) };
    const y = createProvider(parseEnv({ ...common, LLM_PROVIDER: 'yandex', YANDEX_API_KEY: 'k', YANDEX_FOLDER_ID: 'b1g', YANDEX_MODEL: 'aliceai-llm' }));
    expect(y).toMatchObject({ name: 'yandex', model: 'gpt://b1g/aliceai-llm', supportsTools: true });
    const o = createProvider(
      parseEnv({ ...common, LLM_PROVIDER: 'openai-chat', OPENAI_CHAT_BASE_URL: 'https://foundation-models.api.cloud.ru/v1', OPENAI_CHAT_API_KEY: 'k', OPENAI_CHAT_MODEL: 'GigaChat-3.5-Ultra' }),
    );
    expect(o).toMatchObject({ name: 'openai-chat', model: 'GigaChat-3.5-Ultra' });
  });
});
