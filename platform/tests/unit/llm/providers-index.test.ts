import { parseEnv } from '@/server/env';
import { clearStubResponses, createProvider } from '@/server/llm/providers';

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
});
