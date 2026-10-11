import { EnvError, parseEnv } from '@/server/env';

const valid = {
  DATABASE_URL: 'postgresql://postgres@127.0.0.1:54329/fsp_x',
  SESSION_SECRET: 's'.repeat(32),
};

describe('env', () => {
  it('минимальный валидный набор + значения по умолчанию', () => {
    const env = parseEnv(valid);
    expect(env).toMatchObject({
      LLM_PROVIDER: 'stub',
      LLM_MAX_CONCURRENCY: 8,
      LLM_MAX_RETRIES: 2,
      DEMO_LOGIN: false,
      JURY_INSIGHTS: false,
      TEST_INTEGRITY_ACTION: 'silent',
      YANDEX_BASE_URL: 'https://ai.api.cloud.yandex.net/v1',
    });
  });

  it('слой жюри и режим индекса честности: флаги из строк, неизвестный режим - ошибка', () => {
    expect(parseEnv({ ...valid, JURY_INSIGHTS: 'true', TEST_INTEGRITY_ACTION: 'confirm' })).toMatchObject({ JURY_INSIGHTS: true, TEST_INTEGRITY_ACTION: 'confirm' });
    expect(() => parseEnv({ ...valid, TEST_INTEGRITY_ACTION: 'loud' })).toThrow(EnvError);
  });

  it('строки приводятся к числам и булевым, пустые строки — undefined', () => {
    const env = parseEnv({ ...valid, LLM_MAX_CONCURRENCY: '3', DEMO_LOGIN: 'false', GITHUB_TOKEN: '' });
    expect(env.LLM_MAX_CONCURRENCY).toBe(3);
    expect(env.DEMO_LOGIN).toBe(false);
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it('нет DATABASE_URL → EnvError с путём', () => {
    expect(() => parseEnv({ SESSION_SECRET: valid.SESSION_SECRET })).toThrow(EnvError);
    try {
      parseEnv({ SESSION_SECRET: valid.SESSION_SECRET });
    } catch (err) {
      expect((err as EnvError).issues.map((i) => i.path)).toContain('DATABASE_URL');
    }
  });

  it('короткий секрет, не-postgres URL, неизвестный провайдер, нечисло → ошибка', () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...valid, LLM_PROVIDER: 'gpt' })).toThrow(/LLM_PROVIDER/);
    expect(() => parseEnv({ ...valid, LLM_MAX_CONCURRENCY: 'много' })).toThrow(/LLM_MAX_CONCURRENCY/);
    expect(() => parseEnv({ ...valid, LLM_MAX_CONCURRENCY: '0' })).toThrow(/LLM_MAX_CONCURRENCY/);
  });

  it('yandex без ключей → ошибка по каждому ключу; с ключами — ок', () => {
    try {
      parseEnv({ ...valid, LLM_PROVIDER: 'yandex' });
      expect.unreachable();
    } catch (err) {
      expect((err as EnvError).issues.map((i) => i.path).sort()).toEqual(['YANDEX_API_KEY', 'YANDEX_FOLDER_ID', 'YANDEX_MODEL']);
    }
    expect(
      parseEnv({ ...valid, LLM_PROVIDER: 'yandex', YANDEX_API_KEY: 'k', YANDEX_FOLDER_ID: 'f', YANDEX_MODEL: 'm' }).LLM_PROVIDER,
    ).toBe('yandex');
  });

  it('openai-chat требует base url, ключ и модель; url валидируется', () => {
    expect(() => parseEnv({ ...valid, LLM_PROVIDER: 'openai-chat' })).toThrow(/OPENAI_CHAT_BASE_URL/);
    expect(() =>
      parseEnv({ ...valid, LLM_PROVIDER: 'openai-chat', OPENAI_CHAT_BASE_URL: 'not a url', OPENAI_CHAT_API_KEY: 'k', OPENAI_CHAT_MODEL: 'm' }),
    ).toThrow(EnvError);
  });
});
