import { z } from 'zod';

import { parseItemLimits } from '@/lib/test-limits';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

/** Необязательный JSON-объект из строки (доп. поля тела запроса к модели). */
const jsonObject = (name: string) =>
  optionalString.pipe(
    z
      .string()
      .optional()
      .transform((s, ctx) => {
        if (!s) return undefined;
        try {
          const v: unknown = JSON.parse(s);
          if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch {
          /* ниже – ошибка конфигурации */
        }
        ctx.addIssue({ code: 'custom', message: `${name} должен быть JSON-объектом` });
        return z.NEVER;
      }),
  );

const intFrom = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

/** Разбор выключателя DEVTOOLS: false / 0 / off (в любом регистре) выключают, не задан или иное – нет. */
export const devtoolsEnabled = (v: string | undefined): boolean => !['false', '0', 'off'].includes((v ?? '').trim().toLowerCase());

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL обязателен')
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL должен быть postgresql://'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET – не короче 32 символов'),
    /** Страница /demo и /api/demo/login со списком демо-аккаунтов. Для стенда жюри true, на проде выключить. */
    DEMO_LOGIN: z.stringbool().default(false),
    /**
     * Выключатель дебаг-инструментов (панель и /api/dev/*, server/devtools/guard.ts): false / 0 / off (в любом
     * регистре) – выключены и на localhost. Не задан или любое другое значение – включены; в production их нет
     * при любом значении. Нестрогий разбор вместо stringbool: опечатка в значении не должна ронять запуск.
     */
    DEVTOOLS: z.string().optional().transform(devtoolsEnabled),
    APP_URL: z.url().default('http://localhost:3000'),
    /** Пароль на публичный адрес (без логина, src/server/site-access.ts). Пусто – стенд открыт; localhost не закрывается. */
    SITE_PASSWORD: optionalString,
    /** То же, но SHA-256 пароля (64 hex): его можно держать в docker-compose.prod.yml. Важнее SITE_PASSWORD. */
    SITE_PASSWORD_SHA256: optionalString.pipe(z.string().regex(/^[0-9a-fA-F]{64}$/, 'SITE_PASSWORD_SHA256 – 64 hex-символа').optional()),

    LLM_PROVIDER: z.enum(['stub', 'yandex', 'openai-chat']).default('stub'),
    /** Только для stub: извлекатель размечает документ словарём каталога – демо С1 без ключей. */
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
    /** JSON-объект доп. полей тела запроса, напр. {"chat_template_kwargs":{"enable_thinking":false}} – выключить рассуждения Qwen3 на vLLM. */
    OPENAI_CHAT_EXTRA_BODY: jsonObject('OPENAI_CHAT_EXTRA_BODY'),

    /**
     * Запасная модель, если основная (LLM_PROVIDER) не ответила: OpenAI-совместимый Chat Completions. Задаётся тройкой
     * BASE_URL + API_KEY + MODEL; для Yandex AI Studio каталог модели – LLM_FALLBACK_FOLDER_ID (иначе YANDEX_FOLDER_ID).
     * EXTRA_BODY – как OPENAI_CHAT_EXTRA_BODY, напр. {"reasoning_effort":"none"} для Qwen3.6 в Yandex.
     */
    LLM_FALLBACK_BASE_URL: optionalString.pipe(z.url().optional()),
    LLM_FALLBACK_API_KEY: optionalString,
    LLM_FALLBACK_MODEL: optionalString,
    LLM_FALLBACK_FOLDER_ID: optionalString,
    LLM_FALLBACK_NAME: optionalString,
    LLM_FALLBACK_EXTRA_BODY: jsonObject('LLM_FALLBACK_EXTRA_BODY'),

    /**
     * Отдельная модель для созвонов (getLlm({ purpose: 'call' })): те же правила, что у LLM_FALLBACK_* (тройка BASE_URL +
     * API_KEY + MODEL, FOLDER_ID для Yandex AI Studio). Не задана – созвоны идут на основной модели; при её сбое запрос
     * уходит на основную (LLM_PROVIDER).
     */
    LLM_CALL_BASE_URL: optionalString.pipe(z.url().optional()),
    LLM_CALL_API_KEY: optionalString,
    LLM_CALL_MODEL: optionalString,
    LLM_CALL_FOLDER_ID: optionalString,
    LLM_CALL_NAME: optionalString,
    LLM_CALL_EXTRA_BODY: jsonObject('LLM_CALL_EXTRA_BODY'),

    /** Распознавание голоса в композере: yandex (SpeechKit, нужны YANDEX_API_KEY + YANDEX_FOLDER_ID), browser (Web Speech API), off; auto – yandex при ключах, иначе browser. */
    STT_PROVIDER: z.enum(['auto', 'yandex', 'openai', 'browser', 'off']).default('auto'),
    /** STT_PROVIDER=openai: OpenAI-совместимый /audio/transcriptions (vLLM whisper в Selectel). Базовый URL с /v1, ключ сервиса – Bearer. */
    STT_OPENAI_BASE_URL: optionalString,
    STT_OPENAI_API_KEY: optionalString,
    STT_OPENAI_MODEL: z.string().min(1).default('whisper-large-v3'),
    /** Озвучка ответов компаньона (аватар): yandex (SpeechKit v1, нужны YANDEX_API_KEY + YANDEX_FOLDER_ID), off; auto – yandex при ключах, иначе off. */
    TTS_PROVIDER: z.enum(['auto', 'yandex', 'elevenlabs', 'off']).default('auto'),
    /** TTS_PROVIDER=elevenlabs: только синтез, REST с сервера. `auto` его не выбирает. Текст реплик ИИ уходит за рубеж. */
    ELEVENLABS_API_KEY: optionalString,
    /** voice_id ElevenLabs (не имя; `GET /v1/voices`). Не проходит в TTS_VOICE: там имена SpeechKit. */
    ELEVENLABS_VOICE: optionalString,
    /** Голос работодателя в защите проекта; без значения – ELEVENLABS_VOICE. */
    ELEVENLABS_VOICE_EMPLOYER: optionalString,
    ELEVENLABS_MODEL: z.string().min(1).default('eleven_multilingual_v2'),
    /** Модель для созвонов (запрос с realtime: true): быстрее, напр. eleven_flash_v2_5; без значения – ELEVENLABS_MODEL. */
    ELEVENLABS_MODEL_CALL: optionalString,
    /** HTTP(S)-прокси только для запросов к ElevenLabs (http://user:pass@host:port): со стенда в РФ сервис отвечает 302 гео-блокировки. */
    ELEVENLABS_PROXY_URL: optionalString.pipe(z.url().optional()),
    /** Со стенда в РФ api.elevenlabs.io отвечает 302 на страницу гео-блокировки – сюда ставится реверс-прокси вне РФ. */
    ELEVENLABS_BASE_URL: z.string().url().default('https://api.elevenlabs.io'),
    /** Голос SpeechKit v1 (marina, jane, omazh, ermil, zahar, filipp, madi_ru) и амплуа (neutral, friendly, good …). */
    TTS_VOICE: z.string().regex(/^[a-z_]{2,32}$/).default('marina'),
    /** Второй голос – реплики работодателя в защите проекта (ADR 0003), чтобы кандидат отличал его от ИИ. */
    TTS_VOICE_EMPLOYER: z.string().regex(/^[a-z_]{2,32}$/).default('filipp'),
    TTS_EMOTION: z.string().regex(/^[a-z_]{0,32}$/).default('neutral'),
    TTS_SPEED: z.coerce.number().min(0.5).max(2).default(1.1),
    /** mp3 декодирует любой браузер; oggopus меньше, но Safari до 17 его не декодирует. */
    TTS_FORMAT: z.enum(['mp3', 'oggopus']).default('mp3'),
    /** lane call: папка данных созвонов; аудио кандидата – <CALL_DATA_DIR>/calls/<sessionId>/*.wav. Относительный путь – от cwd. */
    CALL_DATA_DIR: z.string().min(1).default('./data'),
    /** Оригиналы файлов кандидата (POST /api/uploads): <UPLOAD_DIR>/<candidateId>/<sha256>. Относительный путь – от cwd; в Docker – том app-data. */
    UPLOAD_DIR: z.string().min(1).default('./data/uploads'),
    /** lane call: лимит квалификационных созвонов кандидата за 24 часа; 0 – без лимита (так на стенде). */
    CALL_DAILY_LIMIT: z.coerce.number().int().min(0).default(5),
    /**
     * lane call-speed: вопрос интервьюера созвона стримится и уходит клиенту по предложениям (SSE utterance_delta),
     * озвучка первого предложения стартует до конца генерации. Только openai-chat со стримом; yandex/stub – как раньше.
     */
    CALL_STREAMING: z.stringbool().default(true),
    /** lane consent (ADR 0005): сколько дней хранится аудио созвона; потом файлы и audioPath удаляются (транскрипт и оценки остаются). */
    CALL_RECORDING_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
    /** Веб-поиск агента (инструмент web_search, Yandex Search API v2): auto – при YANDEX_API_KEY + YANDEX_FOLDER_ID, off – выключен. */
    WEB_SEARCH: z.enum(['auto', 'off']).default('auto'),
    /**
     * OCR картинок и сканов PDF (Yandex Vision OCR, server/collector/ocr.ts). Не задан – yandex при OCR_API_KEY
     * (ключ со scope yc.ai.vision.execute; YANDEX_API_KEY без него получает 403) и каталоге (OCR_FOLDER_ID, иначе
     * YANDEX_FOLDER_ID), иначе off.
     */
    OCR_PROVIDER: optionalString.pipe(z.enum(['yandex', 'off']).optional()),
    OCR_API_KEY: optionalString,
    OCR_FOLDER_ID: optionalString,
    OCR_URL: z.url().default('https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText'),

    /** Вход через Яндекс ID (oauth.yandex.ru). Не заданы → кнопка входа неактивна, работает демо-вход. */
    YANDEX_CLIENT_ID: optionalString,
    YANDEX_CLIENT_SECRET: optionalString,

    /**
     * ФСП ID (OIDC, Keycloak). Внешний провайдер включается, только когда заданы и FSP_OIDC_ISSUER, и
     * FSP_OIDC_CLIENT_SECRET; иначе работает встроенный мок (fsp-id/client.ts: fspOidcConfig, fspProviderMode).
     * Сейчас issuer – симулятор ФСП ID команды; в проде – реалм Keycloak ФСП.
     */
    FSP_OIDC_ISSUER: optionalString.pipe(z.url().optional()),
    /** client_id нашего приложения у провайдера; по умолчанию fsp-career. */
    FSP_OIDC_CLIENT_ID: optionalString,
    /**
     * Секрет конфиденциального клиента (client_secret_post). Пусто – внешний провайдер не используется даже при
     * заданном FSP_OIDC_ISSUER: вход идёт через встроенный мок (fsp-id/client.ts, fspOidcConfig).
     */
    FSP_OIDC_CLIENT_SECRET: optionalString,
    /** Базовый URL API реестра достижений (…/api/v1); достижения – GET /me/achievements по токену пользователя. */
    FSP_API_URL: optionalString.pipe(z.url().optional()),
    /**
     * Подсказка у входа через ФСП ID, когда провайдер внешний: чем войти в симулятор (логины вымышленных
     * спортсменов и их общий демо-пароль). Пусто – подсказки нет. Со встроенным моком не показывается.
     */
    FSP_OIDC_DEMO_HINT: optionalString.pipe(z.string().max(200).optional()),

    GITHUB_TOKEN: optionalString,
    /** true → сборщик не ходит в сеть за профилями, только фикстуры (демо-стенд, тесты). */
    COLLECTOR_FIXTURES: z.stringbool().default(false),
    /** lane test: интервалы теста на грейд в минутах вместо дней (стенд жюри, ADR-0002). */
    TEST_DEMO_INTERVALS: z.stringbool().default(false),
    /**
     * lane integrity: индекс честности теста блокирует выдачу категории при high (needs_confirmation → подтверждающий тест).
     * false – индекс считается и пишется в попытку, но категорию не задерживает (ADR-0002, дополнение 11.10).
     */
    TEST_INTEGRITY: z.stringbool().default(true),
    /**
     * lane test-length: лимиты длины основной фазы теста на грейд «min,max» (например «9,12»), 5…20. Пусто – дефолт
     * policy.ts (MIN_ITEMS…MAX_ITEMS, 7–10). Действует на попытки текущей версии политики, в том числе уже начатые:
     * менять между прогонами, а не во время (почему дефолт не поднят – docs/validation-results.md, «Длина теста и надёжность»).
     */
    TEST_ITEM_LIMITS: optionalString.transform((v, ctx) => {
      try {
        return parseItemLimits(v);
      } catch (e) {
        ctx.issues.push({ code: 'custom', message: (e as Error).message, input: v });
        return z.NEVER;
      }
    }),
    /**
     * lane jury: что делает high при включённом TEST_INTEGRITY. silent (по умолчанию, решение владельца 11.10) -
     * индекс считается и виден работодателю, кандидату ничего не раскрывается и категория не задерживается;
     * confirm - high задерживает категорию до подтверждающего теста (ADR-0002).
     */
    TEST_INTEGRITY_ACTION: z.enum(['silent', 'confirm']).default('silent'),
    /**
     * lane jury: слой «только для жюри» - живые счётчики сигналов, сдвиг ловушки и разбор индекса на итоге.
     * Как DEMO_LOGIN: на стенде true, на проде false. Проверяется на сервере, данные без флага не отдаются.
     */
    JURY_INSIGHTS: z.stringbool().default(false),
    /** true – в подборке и банке при high (без подтверждения тестом или созвоном) категория из теста не учитывается (вариант 2a, 11.10). */
    TEST_INTEGRITY_RANKING: z.stringbool().default(true),
    /** lane runner: адрес сервиса автопроверки проектов (compose: http://runner:8090). Не задан – проверка проектов недоступна. */
    RUNNER_URL: optionalString.pipe(z.url().optional()),
    /**
     * lane runner: общий секрет app ↔ runner (Bearer), тот же в окружении runner. Длину (≥ 32) проверяет
     * клиент при вызове, а не здесь: кривой токен не должен ронять всё приложение.
     */
    RUNNER_TOKEN: optionalString,
    /** R-X-02 (концепт ATS): куда слать подписанный вебхук о смене статуса приглашения. Нет url или секрета – отправки нет. */
    ATS_WEBHOOK_URL: optionalString.pipe(z.url().optional()),
    /** Секрет HMAC-SHA256 подписи вебхука (заголовок X-FSP-Signature). */
    ATS_WEBHOOK_SECRET: optionalString,
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: intFrom(1025, 1, 65535),
    /** lane email-auth: smtp – письма через SMTP (Mailpit на стенде); log – только в лог сервера и журнал в памяти (тесты, локально без Mailpit). */
    MAIL_PROVIDER: z.enum(['smtp', 'log']).default('smtp'),
    /** Отправитель писем: `Имя <адрес>` или просто адрес. */
    MAIL_FROM: z.string().min(3).default('MESHWORK <no-reply@meshwork.local>'),
    /** true – TLS с первого байта (порт 465). Mailpit – false. STARTTLS не поддерживается. */
    SMTP_SECURE: z.stringbool().default(false),
    /** Логин SMTP (AUTH PLAIN); пусто – без авторизации, как у Mailpit. */
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
    if (env.STT_PROVIDER === 'openai') {
      for (const key of ['STT_OPENAI_BASE_URL', 'STT_OPENAI_API_KEY'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} обязателен при STT_PROVIDER=openai` });
      }
    }
    if (env.TTS_PROVIDER === 'elevenlabs') {
      for (const key of ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} обязателен при TTS_PROVIDER=elevenlabs` });
      }
    }
    const fallbackKeys = ['LLM_FALLBACK_BASE_URL', 'LLM_FALLBACK_API_KEY', 'LLM_FALLBACK_MODEL'] as const;
    if (fallbackKeys.some((k) => env[k])) {
      for (const key of fallbackKeys) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} обязателен, если задана запасная модель (LLM_FALLBACK_*)` });
      }
    }
    const callKeys = ['LLM_CALL_BASE_URL', 'LLM_CALL_API_KEY', 'LLM_CALL_MODEL'] as const;
    if (callKeys.some((k) => env[k])) {
      for (const key of callKeys) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} обязателен, если задана модель созвонов (LLM_CALL_*)` });
      }
    }
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
 * при `next build` без секретов; падение – при первом обращении.
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Только для тестов. */
export function resetEnvCache(): void {
  cached = undefined;
}
