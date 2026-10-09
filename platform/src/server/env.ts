import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const intFrom = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL обязателен')
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL должен быть postgresql://'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET — не короче 32 символов'),
    DEMO_LOGIN_ENABLED: z.stringbool().default(true),
    APP_URL: z.url().default('http://localhost:3000'),

    LLM_PROVIDER: z.enum(['stub', 'yandex', 'openai-chat']).default('stub'),
    /** Только для stub: извлекатель размечает документ словарём каталога — демо С1 без ключей. */
    LLM_STUB_DEMO: z.stringbool().default(false),
    LLM_MAX_CONCURRENCY: intFrom(8, 1, 64),
    LLM_TIMEOUT_MS: intFrom(40_000, 1_000, 300_000),
    LLM_MAX_RETRIES: intFrom(2, 0, 5),
    LLM_DAILY_TOKEN_BUDGET: intFrom(200_000, 0, 100_000_000),

    YANDEX_API_KEY: optionalString,
    YANDEX_FOLDER_ID: optionalString,
    YANDEX_MODEL: optionalString,
    YANDEX_BASE_URL: z.url().default('https://ai.api.cloud.yandex.net/v1'),
    /** false → client включает план В (вызовы инструментов через JSON в тексте). */
    YANDEX_SUPPORTS_TOOLS: z.stringbool().default(true),

    OPENAI_CHAT_BASE_URL: optionalString.pipe(z.url().optional()),
    OPENAI_CHAT_API_KEY: optionalString,
    OPENAI_CHAT_MODEL: optionalString,
    /** Имя в журнале AgentRun: cloudru, yandex-openai, vllm. */
    OPENAI_CHAT_NAME: optionalString,
    OPENAI_CHAT_SUPPORTS_TOOLS: z.stringbool().default(true),
    OPENAI_CHAT_SUPPORTS_JSON_SCHEMA: z.stringbool().default(true),

    /** Вход через Яндекс ID (oauth.yandex.ru). Не заданы → кнопка входа неактивна, работает демо-вход. */
    YANDEX_CLIENT_ID: optionalString,
    YANDEX_CLIENT_SECRET: optionalString,

    GITHUB_TOKEN: optionalString,
    /** true → сборщик не ходит в сеть за профилями, только фикстуры (демо-стенд, тесты). */
    COLLECTOR_FIXTURES: z.stringbool().default(false),
    /** lane test: интервалы теста на грейд в минутах вместо дней (стенд жюри, ADR-0002). */
    TEST_DEMO_INTERVALS: z.stringbool().default(false),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: intFrom(1025, 1, 65535),
  })
  .superRefine((env, ctx) => {
    const need = (keys: (keyof typeof env)[], provider: string) => {
      for (const key of keys) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: `${key} обязателен при LLM_PROVIDER=${provider}` });
        }
      }
    };
    if (env.LLM_PROVIDER === 'yandex') need(['YANDEX_API_KEY', 'YANDEX_FOLDER_ID', 'YANDEX_MODEL'], 'yandex');
    if (env.LLM_PROVIDER === 'openai-chat') {
      need(['OPENAI_CHAT_BASE_URL', 'OPENAI_CHAT_API_KEY', 'OPENAI_CHAT_MODEL'], 'openai-chat');
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(`Невалидное окружение:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Чистая проверка (для тестов и скриптов). Бросает EnvError со списком проблем. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })));
  }
  return result.data;
}

let cached: Env | undefined;

/**
 * Окружение процесса, проверенное один раз. Ленивое: модуль можно импортировать
 * при `next build` без секретов; падение — при первом обращении.
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Только для тестов. */
export function resetEnvCache(): void {
  cached = undefined;
}
