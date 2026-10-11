import { parseEnv } from '@/server/env';
import { clearStubResponses, createCallProvider, createFallbackProvider, createProvider } from '@/server/llm/providers';

const base = { DATABASE_URL: 'postgresql://x@127.0.0.1:1/db', SESSION_SECRET: 's'.repeat(32) };

afterEach(() => clearStubResponses());

describe('env интеграции и createProvider', () => {
  it('флаги провайдеров и сборщика: значения по умолчанию и разбор строк', () => {
    const d = parseEnv(base);
    expect(d).toMatchObject({ YANDEX_SUPPORTS_TOOLS: true, OPENAI_CHAT_SUPPORTS_TOOLS: true, OPENAI_CHAT_SUPPORTS_JSON_SCHEMA: true, COLLECTOR_FIXTURES: false, LLM_STUB_DEMO: false });
    expect(d.OPENAI_CHAT_NAME).toBeUndefined();
    const e = parseEnv({ ...base, YANDEX_SUPPORTS_TOOLS: 'false', OPENAI_CHAT_SUPPORTS_TOOLS: 'false', OPENAI_CHAT_SUPPORTS_JSON_SCHEMA: 'false', COLLECTOR_FIXTURES: 'true', OPENAI_CHAT_NAME: 'cloudru' });
    expect(e).toMatchObject({ YANDEX_SUPPORTS_TOOLS: false, OPENAI_CHAT_SUPPORTS_TOOLS: false, OPENAI_CHAT_SUPPORTS_JSON_SCHEMA: false, COLLECTOR_FIXTURES: true, OPENAI_CHAT_NAME: 'cloudru' });
  });

  it('openai-chat: имя и supportsTools из env', () => {
    const p = createProvider(parseEnv({ ...base, LLM_PROVIDER: 'openai-chat', OPENAI_CHAT_BASE_URL: 'https://llm.example.test/v1', OPENAI_CHAT_API_KEY: 'k', OPENAI_CHAT_MODEL: 'm', OPENAI_CHAT_NAME: 'vllm', OPENAI_CHAT_SUPPORTS_TOOLS: 'false' }));
    expect(p.name).toBe('vllm');
    expect(p.supportsTools).toBe(false);
    expect(p.model).toBe('m');
  });

  it('openai-chat на хосте Yandex: модель становится gpt://<каталог>/<модель>', () => {
    const p = createProvider(parseEnv({ ...base, LLM_PROVIDER: 'openai-chat', OPENAI_CHAT_BASE_URL: 'https://llm.api.cloud.yandex.net/v1', OPENAI_CHAT_API_KEY: 'k', OPENAI_CHAT_MODEL: 'deepseek-v4', YANDEX_FOLDER_ID: 'b1folder' }));
    expect(p.model).toBe('gpt://b1folder/deepseek-v4');
  });

  it('yandex: YANDEX_SUPPORTS_TOOLS=false → провайдер без инструментов (план В)', () => {
    const p = createProvider(parseEnv({ ...base, LLM_PROVIDER: 'yandex', YANDEX_API_KEY: 'k', YANDEX_FOLDER_ID: 'f', YANDEX_MODEL: 'm', YANDEX_SUPPORTS_TOOLS: 'false' }));
    expect(p.supportsTools).toBe(false);
  });

  it('запасная модель: нет тройки LLM_FALLBACK_* или stub – нет запасной; неполная тройка – ошибка env', () => {
    const openai = { ...base, LLM_PROVIDER: 'openai-chat', OPENAI_CHAT_BASE_URL: 'https://llm.example.test/v1', OPENAI_CHAT_API_KEY: 'k', OPENAI_CHAT_MODEL: 'm' };
    const spare = { LLM_FALLBACK_BASE_URL: 'https://llm.api.cloud.yandex.net/v1', LLM_FALLBACK_API_KEY: 'k2', LLM_FALLBACK_MODEL: 'qwen3.6-35b-a3b' };
    expect(createFallbackProvider(parseEnv(openai))).toBeUndefined();
    expect(createFallbackProvider(parseEnv({ ...base, ...spare }))).toBeUndefined();
    expect(() => parseEnv({ ...openai, LLM_FALLBACK_BASE_URL: spare.LLM_FALLBACK_BASE_URL })).toThrow(/LLM_FALLBACK_API_KEY/);
  });

  it('запасная модель на хосте Yandex: каталог из LLM_FALLBACK_FOLDER_ID, иначе YANDEX_FOLDER_ID', () => {
    const openai = { ...base, LLM_PROVIDER: 'openai-chat', OPENAI_CHAT_BASE_URL: 'https://llm.example.test/v1', OPENAI_CHAT_API_KEY: 'k', OPENAI_CHAT_MODEL: 'm', YANDEX_FOLDER_ID: 'b1voice' };
    const spare = { LLM_FALLBACK_BASE_URL: 'https://llm.api.cloud.yandex.net/v1', LLM_FALLBACK_API_KEY: 'k2', LLM_FALLBACK_MODEL: 'qwen3.6-35b-a3b' };
    const own = createFallbackProvider(parseEnv({ ...openai, ...spare, LLM_FALLBACK_FOLDER_ID: 'b1qwen', LLM_FALLBACK_NAME: 'qwen-yandex', LLM_FALLBACK_EXTRA_BODY: '{"reasoning_effort":"none"}' }));
    expect(own?.model).toBe('gpt://b1qwen/qwen3.6-35b-a3b');
    expect(own?.name).toBe('qwen-yandex');
    expect(createFallbackProvider(parseEnv({ ...openai, ...spare }))?.model).toBe('gpt://b1voice/qwen3.6-35b-a3b');
  });

  it('модель созвонов: не задана или stub – нет; неполная тройка – ошибка; Yandex – URI из LLM_CALL_FOLDER_ID, имя по умолчанию call', () => {
    const openai = { ...base, LLM_PROVIDER: 'openai-chat', OPENAI_CHAT_BASE_URL: 'https://llm.example.test/v1', OPENAI_CHAT_API_KEY: 'k', OPENAI_CHAT_MODEL: 'm', YANDEX_FOLDER_ID: 'b1voice' };
    const call = { LLM_CALL_BASE_URL: 'https://llm.api.cloud.yandex.net/v1', LLM_CALL_API_KEY: 'k3', LLM_CALL_MODEL: 'qwen3.6-35b-a3b' };
    expect(createCallProvider(parseEnv(openai))).toBeUndefined();
    expect(createCallProvider(parseEnv({ ...base, ...call }))).toBeUndefined();
    expect(() => parseEnv({ ...openai, LLM_CALL_BASE_URL: call.LLM_CALL_BASE_URL })).toThrow(/LLM_CALL_API_KEY/);
    expect(() => parseEnv({ ...openai, ...call, LLM_CALL_EXTRA_BODY: 'не json' })).toThrow(/LLM_CALL_EXTRA_BODY/);
    const own = createCallProvider(parseEnv({ ...openai, ...call, LLM_CALL_FOLDER_ID: 'b1call', LLM_CALL_NAME: 'qwen-call' }));
    expect(own?.model).toBe('gpt://b1call/qwen3.6-35b-a3b');
    expect(own?.name).toBe('qwen-call');
    const dflt = createCallProvider(parseEnv({ ...openai, ...call }));
    expect(dflt?.name).toBe('call');
    expect(dflt?.model).toBe('gpt://b1voice/qwen3.6-35b-a3b');
  });
});
