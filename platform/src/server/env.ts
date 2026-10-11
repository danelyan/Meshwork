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
    /** Страница /demo и /api/demo/login со списком демо-аккаунтов. Для стенда жюри true, на проде выключить. */
    DEMO_LOGIN: z.stringbool().default(false),
    APP_URL: z.url().default('http://localhost:3000'),
    /** Пароль на публичный адрес (без логина, src/server/site-access.ts). Пусто — стенд открыт; localhost не закрывается. */
    SITE_PASSWORD: optionalString,
    /** То же, но SHA-256 пароля (64 hex): его можно держать в docker-compose.prod.yml. Важнее SITE_PASSWORD. */
    SITE_PASSWORD_SHA256: optionalString.pipe(z.string().regex(/^[0-9a-fA-F]{64}$/, 'SITE_PASSWORD_SHA256 — 64 hex-символа').optional()),

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
    /** Стримить ответы чата (`stream: true`): реплики консультанта и помощника появляются по мере генерации. */
    OPENAI_CHAT_STREAM: z.stringbool().default(true),

    /** Распознавание голоса в композере: yandex (SpeechKit, нужны YANDEX_API_KEY + YANDEX_FOLDER_ID), browser (Web Speech API), off; auto — yandex при ключах, иначе browser. */
    STT_PROVIDER: z.enum(['auto', 'yandex', 'browser', 'off']).default('auto'),
    /** Озвучка ответов компаньона (аватар): yandex (SpeechKit v1, нужны YANDEX_API_KEY + YANDEX_FOLDER_ID), off; auto — yandex при ключах, иначе off. */
    TTS_PROVIDER: z.enum(['auto', 'yandex', 'off']).default('auto'),
    /** Голос SpeechKit v1 (marina, jane, omazh, ermil, zahar, filipp, madi_ru) и амплуа (neutral, friendly, good …). */
    TTS_VOICE: z.string().regex(/^[a-z_]{2,32}$/).default('marina'),
    /** Второй голос — реплики работодателя в защите проекта (ADR 0003), чтобы кандидат отличал его от ИИ. */
    TTS_VOICE_EMPLOYER: z.string().regex(/^[a-z_]{2,32}$/).default('filipp'),
    TTS_EMOTION: z.string().regex(/^[a-z_]{0,32}$/).default('neutral'),
    TTS_SPEED: z.coerce.number().min(0.5).max(2).default(1.1),
    /** mp3 декодирует любой браузер; oggopus меньше, но Safari до 17 его не декодирует. */
    TTS_FORMAT: z.enum(['mp3', 'oggopus']).default('mp3'),
    /** lane call: папка данных созвонов; аудио кандидата — <CALL_DATA_DIR>/calls/<sessionId>/*.wav. Относительный путь — от cwd. */
    CALL_DATA_DIR: z.string().min(1).default('./data'),
    /** Оригиналы файлов кандидата (POST /api/uploads): <UPLOAD_DIR>/<candidateId>/<sha256>. Относительный путь — от cwd; в Docker — том app-data. */
    UPLOAD_DIR: z.string().min(1).default('./data/uploads'),
    /** lane call: лимит квалификационных созвонов кандидата за 24 часа; 0 — без лимита (так на стенде). */
    CALL_DAILY_LIMIT: z.coerce.number().int().min(0).default(5),
    /** lane consent (ADR 0005): сколько дней хранится аудио созвона; потом файлы и audioPath удаляются (транскрипт и оценки остаются). */
    CALL_RECORDING_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
    /** Веб-поиск агента (инструмент web_search, Yandex Search API v2): auto — при YANDEX_API_KEY + YANDEX_FOLDER_ID, off — выключен. */
    WEB_SEARCH: z.enum(['auto', 'off']).default('auto'),

    /** Вход через Яндекс ID (oauth.yandex.ru). Не заданы → кнопка входа неактивна, работает демо-вход. */
    YANDEX_CLIENT_ID: optionalString,
    YANDEX_CLIENT_SECRET: optionalString,

    /**
     * Привязка ФСП ID (OIDC, Keycloak). Не задан FSP_OIDC_ISSUER → кнопка привязки скрыта, ФСП — демо-источник
     * (server/collector/fsp-demo.ts). Сейчас issuer — симулятор ФСП ID команды; в проде — реалм Keycloak ФСП.
     */
    FSP_OIDC_ISSUER: optionalString.pipe(z.url().optional()),
    /** client_id нашего приложения у провайдера; по умолчанию fsp-career. */
    FSP_OIDC_CLIENT_ID: optionalString,
    /** Секрет конфиденциального клиента (client_secret_post). Пусто — публичный клиент, только PKCE. */
    FSP_OIDC_CLIENT_SECRET: optionalString,
    /** Базовый URL API реестра достижений (…/api/v1); достижения — GET /me/achievements по токену пользователя. */
    FSP_API_URL: optionalString.pipe(z.url().optional()),

    GITHUB_TOKEN: optionalString,
    /** true → сборщик не ходит в сеть за профилями, только фикстуры (демо-стенд, тесты). */
    COLLECTOR_FIXTURES: z.stringbool().default(false),
    /** lane test: интервалы теста на грейд в минутах вместо дней (стенд жюри, ADR-0002). */
    TEST_DEMO_INTERVALS: z.stringbool().default(false),
    /**
     * lane integrity: индекс честности теста блокирует выдачу категории при high (needs_confirmation → подтверждающий тест).
     * false — индекс считается и пишется в попытку, но категорию не задерживает (ADR-0002, дополнение 11.10).
     */
    TEST_INTEGRITY: z.stringbool().default(true),
    /** true — в подборке и банке при high (без подтверждения тестом или созвоном) категория из теста не учитывается (вариант 2a, 11.10). */
    TEST_INTEGRITY_RANKING: z.stringbool().default(true),
    /** lane runner: адрес сервиса автопроверки проектов (compose: http://runner:8090). Не задан — проверка проектов недоступна. */
    RUNNER_URL: optionalString.pipe(z.url().optional()),
    /**
     * lane runner: общий секрет app ↔ runner (Bearer), тот же в окружении runner. Длину (≥ 32) проверяет
     * клиент при вызове, а не здесь: кривой токен не должен ронять всё приложение.
     */
    RUNNER_TOKEN: optionalString,
    /** R-X-02 (концепт ATS): куда слать подписанный вебхук о смене статуса приглашения. Нет url или секрета — отправки нет. */
    ATS_WEBHOOK_URL: optionalString.pipe(z.url().optional()),
    /** Секрет HMAC-SHA256 подписи вебхука (заголовок X-FSP-Signature). */
    ATS_WEBHOOK_SECRET: optionalString,
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: intFrom(1025, 1, 65535),
    /** lane email-auth: smtp — письма через SMTP (Mailpit на стенде); log — только в лог сервера и журнал в памяти (тесты, локально без Mailpit). */
    MAIL_PROVIDER: z.enum(['smtp', 'log']).default('smtp'),
    /** Отправитель писем: `Имя <адрес>` или просто адрес. */
    MAIL_FROM: z.string().min(3).default('ФСП Карьера <no-reply@fsp-career.local>'),
    /** true — TLS с первого байта (порт 465). Mailpit — false. STARTTLS не поддерживается. */
    SMTP_SECURE: z.stringbool().default(false),
    /** Логин SMTP (AUTH PLAIN); пусто — без авторизации, как у Mailpit. */
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
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
