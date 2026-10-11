// Описания, которых нет в коде маршрутов: формы ответов, пояснения к ошибкам, события SSE.
// Метод, путь, JSDoc, роль доступа, Zod-схемы тела и query генератор берёт из самих route.ts;
// здесь — только то, что выводить неоткуда. Новый маршрут без записи здесь попадает в спецификацию
// с автоматическим описанием (ответ — «объект»), запись добавляют, когда нужна форма ответа.

export type JsonSchema = Record<string, unknown>;

export interface OpOverride {
  operationId?: string;
  tag?: string;
  summary?: string;
  description?: string;
  pathParams?: Record<string, JsonSchema>;
  /** Роль доступа, если вывод из исходника неточен. */
  role?: 'public' | 'candidate' | 'employer' | 'user' | 'session';
  /** Вход необязателен: без куки ответ другой, но не 401. */
  optionalAuth?: boolean;
  query?: { name: string; description?: string; required?: boolean; schema?: JsonSchema }[];
  body?: { description?: string; contentType?: string; schema: JsonSchema };
  success?: {
    status?: number;
    description?: string;
    contentType?: string;
    schema?: JsonSchema;
    extra?: { status: number; description: string; contentType?: string; schema?: JsonSchema }[];
  };
  /** Пояснения к кодам ошибок конкретной операции: статус → что именно и какой `code`. */
  errors?: Record<number, string>;
}

// --- конструкторы схем ---
const str = (description?: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', ...(description ? { description } : {}), ...extra });
const int = (description?: string): JsonSchema => ({ type: 'integer', ...(description ? { description } : {}) });
const bool = (description?: string): JsonSchema => ({ type: 'boolean', ...(description ? { description } : {}) });
const nullable = (s: JsonSchema): JsonSchema => ({ oneOf: [s, { type: 'null' }] });
const en = (...v: string[]): JsonSchema => ({ type: 'string', enum: v });
const arr = (items: JsonSchema, description?: string): JsonSchema => ({ type: 'array', items, ...(description ? { description } : {}) });
const obj = (props: Record<string, JsonSchema>, required: string[] = Object.keys(props), description?: string): JsonSchema => ({
  type: 'object',
  properties: props,
  required,
  ...(description ? { description } : {}),
});
/** Форма известна только по описанию: ключи названы словами, схема — произвольный объект. */
const free = (description: string): JsonSchema => ({ type: 'object', additionalProperties: true, description });
const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });

const DT = (d?: string) => str(d, { format: 'date-time' });

export const ERROR_RESPONSES: Record<number, { name: string; description: string }> = {
  400: { name: 'BadRequest', description: 'Некорректный запрос: тело или query не прошли проверку (`validation_failed`, `details` — список полей) либо иная ошибка запроса (`bad_request`)' },
  401: { name: 'Unauthorized', description: 'Нет входа (`unauthorized`) или кука подписана верно, а аккаунта в БД нет (`session_stale`, клиент ведёт на /auth)' },
  403: { name: 'Forbidden', description: 'Нет доступа: другая роль (`forbidden`) или чужой Origin у изменяющего запроса' },
  404: { name: 'NotFound', description: 'Объект не найден; для чужих объектов тоже 404, чтобы не раскрывать их существование (`not_found`)' },
  409: { name: 'Conflict', description: 'Конфликт состояния: повторное действие, занятый ресурс, устаревшая версия (`conflict` и специальные коды операции)' },
  413: { name: 'PayloadTooLarge', description: 'Слишком большой запрос (`payload_too_large`)' },
  415: { name: 'UnsupportedMediaType', description: 'Неподдерживаемый тип содержимого (`unsupported_media_type`)' },
  429: { name: 'TooManyRequests', description: 'Превышен лимит запросов или суточный лимит (`rate_limited`)' },
  500: { name: 'InternalError', description: 'Внутренняя ошибка (`internal`); текст исключения наружу не отдаётся' },
  503: { name: 'ServiceUnavailable', description: 'Внешняя служба недоступна, например SMTP (`mail_unavailable`); повторить позже' },
};

export const TAG_DESCRIPTIONS: Record<string, string> = {
  auth: 'Вход, сессия, согласие на обработку ПДн, роль',
  call: 'Созвон с ИИ-интервьюером (ADR 0003): квалифицирующий созвон, транскрипт, запись, карта глубины, SSE-события, сигналинг WebRTC',
  consents: 'Согласия (ADR 0005): список «Мои согласия», дать, отозвать; раскрытие — по приглашению',
  claims: 'Карточки утверждений кандидата: подтвердить, поправить, отклонить',
  consultant: 'Чат с консультантом (SSE) и история разговоров',
  defense: 'Защита утверждения: короткое интервью, повышающее уровень до «платформа»',
  'defense-room': 'Защита проекта (ADR 0003, ступень 3): вопросы по коду, ходы, SSE звонка, итог слепого оценщика',
  demo: 'Демо-вход и демо-резюме (только при DEMO_LOGIN)',
  'fsp-id': 'ФСП ID (R-FSP-01): привязка ФСП ID к профилю кандидата через OIDC-провайдер (Keycloak; сейчас — симулятор ФСП ID команды) и загрузка достижений',
  directions: 'Справочник направлений и подкатегорий (Subcategory, R-T-05)',
  employer: 'Кабинет работодателя: потребности, подборка, поиск, приглашения, помощник (SSE)',
  evaluate: 'Проверка подбора на своём наборе: P@k, nDCG@k, MRR против базовой линии, без записи в БД',
  health: 'Проверка живости',
  simulator: 'Симулятор адаптивного теста для жюри: виртуальный кандидат, шаги движка, без БД и LLM',
  invitations: 'Приглашения глазами кандидата',
  objections: 'Возражения против автоматической оценки (ст. 16 152-ФЗ): тест, созвон, защита',
  onboarding: 'Онбординг: шаги, ответы, итог',
  openapi: 'Спецификация API',
  profile: 'Профиль кандидата и приватность',
  recommendations: 'Рекомендации: тест, пробелы, задания, вакансии',
  sources: 'Подключённые ссылки кандидата (GitHub, Codeforces, страницы): удаление',
  stt: 'Голосовой ввод (Yandex SpeechKit)',
  test: 'Тест на грейд: попытки, ответы, итог',
  uploads: 'Загрузка резюме и документов: разбор, оригинал, скачивание, удаление',
};

export const SSE_EVENTS_DOC = [
  '### События SSE',
  'Звонок защиты проекта `GET /api/defense-room/{id}/events` — EventSource с именованными событиями лейна call: `snapshot`, `status`, `utterance`, `ai_state`, `participant`, `mute`, `question`, `verdict`, `signal`, `error` (кадр `event: <имя>` + `data: <json>`; первым приходит `snapshot`, реплики дедуплицируются по `entry.index`, сигналы WebRTC — только адресату).',
  'Эндпоинты `POST /api/consultant/messages` и `POST /api/employer/assistant/messages` отвечают потоком `text/event-stream`. Один кадр — `data: <json>` и пустая строка; тип события — поле `type`. Реплика приходит стримом: `delta* → message → done`; `message` — итог реплики, авторитетный. Схемы кадров — `ConsultantEvent` и `EmployerEvent`.',
  'Второй ход в том же разговоре, пока идёт первый, получает 409 с кодом `busy` до начала потока. Ошибка посреди хода приходит событием `error`, поток всё равно заканчивается `done`.',
].join('\n\n');

const ev = (type: string, props: Record<string, JsonSchema>, description: string, required: string[] = Object.keys(props)): JsonSchema =>
  obj({ type: { const: type }, ...props }, ['type', ...required], description);

const COMMON_EVENTS = [
  ev('conversation', { id: str() }, 'Первый кадр: id разговора (новый создаётся на первом ходе)'),
  ev('step', { text: str() }, 'Статус работы агента, например «читаю резюме…»'),
  ev('queue', { position: int() }, 'Место в очереди к модели'),
  ev('ask', { question: str(), options: arr(str()) }, 'Агент задаёт кандидату вопрос; ход на этом заканчивается', ['question']),
  ev('delta', { id: str(), text: str() }, 'Очередной кусок реплики `id` по мере генерации'),
  ev('discard', { id: str() }, 'Показанный текст реплики `id` не был ответом (модель ушла в инструменты): убрать'),
  ev('message', { text: str(), id: str() }, 'Итог реплики, авторитетный; заменяет накопленные дельты `id`', ['text']),
  ev('error', { code: str(), message: str() }, 'Ошибка хода; следом придёт `done`'),
  ev('done', {}, 'Последний кадр потока'),
];

export const COMPONENT_SCHEMAS: Record<string, JsonSchema> = {
  LiveDefense: obj(
    {
      id: str(),
      status: en('slots_proposed', 'scheduled', 'done', 'cancelled', 'no_show'),
      durationMin: int('30 или 45'),
      comment: nullable(str()),
      createdAt: DT(),
      slots: arr(obj({ id: str(), startsAt: DT('UTC; интерфейс показывает по МСК'), endsAt: DT(), available: bool('false — время занято другим кандидатом компании или прошло') })),
      noneFit: nullable(obj({ at: DT(), comment: str() })),
      scheduled: nullable(obj({ slotId: str(), startsAt: DT(), endsAt: DT(), roomOpensAt: DT('за 10 минут до начала'), roomOpen: bool(), callSessionId: nullable(str()), roomHref: nullable(str('/defense-room/:id кандидату, /employer/calls/:id работодателю')) })),
      cancelled: nullable(obj({ at: DT(), by: en('candidate', 'employer'), reason: str() })),
      noShow: arr(en('candidate', 'employer'), 'Опоздание больше 15 минут: кто не пришёл (вычисляется при чтении)'),
      canCancel: bool('Отменить можно сейчас (не позднее чем за 1 час)'),
    },
    undefined,
    'Живая защита по приглашению (ADR 0008): активное предложение слотов и подстатус',
  ),
  ErrorBody: obj(
    { error: obj({ code: str('Машинный код ошибки'), message: str('Текст для человека'), details: { description: 'Подробности, например список полей при `validation_failed`' } }, ['code', 'message']) },
    ['error'],
    'Единый формат ошибки API (server/errors.ts)',
  ),
  Claim: obj(
    {
      id: str(),
      catalogId: str('Запись каталога навыков'),
      statement: str('Формулировка утверждения из каталога (или правка кандидата) — то, что проверяется на созвоне'),
      wording: nullable(str('Формулировка для кандидата в границах цитаты; null — старая запись, показывать statement')),
      level: en('self_reported', 'artifact', 'third_party', 'platform'),
      quote: nullable(str('Цитата из источника')),
      sourceRef: nullable(str()),
      sourceKind: str(),
      status: str('proposed, confirmed, rejected'),
      confirmedAt: nullable(DT()),
    },
    undefined,
    'Утверждение кандидата с уровнем доказанности',
  ),
  ConsultantEvent: {
    description: 'Кадр SSE хода консультанта (`type` — различитель)',
    oneOf: [
      ...COMMON_EVENTS,
      ev('claims', { proposed: arr({ type: 'object' }), rejected: int(), rejectedByReason: { type: 'object', additionalProperties: int() }, hiddenText: int(), alreadyKnown: int() }, 'Карточки утверждений, извлечённые из вложений', ['proposed', 'rejected']),
      ev('recommendations', { items: arr({ type: 'object' }) }, 'Рекомендации для карточек в чате'),
      ev('call_offer', { reason: str('Зачем созвон, одной фразой') }, 'Агент предлагает созвон (suggest_call): кнопка «Созвониться» в ленте'),
    ],
    discriminator: { propertyName: 'type' },
  },
  EmployerEvent: {
    description: 'Кадр SSE хода помощника работодателя (`type` — различитель). Имя кандидата добавляется карточке только после принятия приглашения',
    oneOf: [
      ...COMMON_EVENTS,
      ev('candidates', { block: free('Подборка: vacancy (id, title, salaryFrom) | null, total, items — карточки с псевдонимом, рангом, категорией, покрытием и обоснованием') }, 'Блок карточек кандидатов'),
      ev('invitation_draft', { draft: free('Черновик приглашения: candidateId, alias, vacancyId, salaryFrom, salaryTo, message, limit {sent, limit, left}, blocked') }, 'Черновик приглашения; отправляет человек'),
      ev('need_draft', { draft: free('Черновик потребности: title, specialization, grade, stack, salaryFrom/To, needs, formHref') }, 'Черновик потребности; подтверждает человек'),
    ],
    discriminator: { propertyName: 'type' },
  },
  CallView: free(
    'Созвон глазами роли: id, kind (qualifying | defense), status (active | finished | cancelled), projectSubmissionId, startedAt, finishedAt, access (full | summary), ' +
      'transcript — реплики {index, role: ai | candidate | employer, text, at, tMs, audioRef?, meta?} или null при summary, verdict (карта глубины; при summary — без цитат), ' +
      'hasRecording, progress {answered, minQuestions, maxQuestions, canFinish, awaitingAnswer}, participants, policyVersion, disclaimer',
  ),
  CallEvent: {
    description:
      'Кадр SSE созвона: `event: <type>` + `data: <json>`; `type` — различитель. Enum типов — CALL_EVENT_TYPES (server/call/types.ts); participant / mute / question / signal шлёт lane defense-room. Работодатель без доступа к записи получает только status, participant и verdict (без цитат)',
    oneOf: [
      ev('snapshot', { call: ref('CallView') }, 'Первый кадр: состояние созвона для этой роли'),
      ev('status', { status: en('active', 'finished', 'cancelled') }, 'Сменился статус'),
      ev('utterance', { entry: free('Реплика транскрипта {index, role, text, at, tMs, audioRef?, meta?}') }, 'Новая реплика'),
      ev('ai_state', { state: en('thinking', 'idle') }, 'ИИ готовит реплику / закончил'),
      ev('participant', { userId: str(), role: en('employer'), action: en('joined', 'left') }, 'Участник вошёл или вышел'),
      ev('mute', { aiMuted: bool(), userId: str() }, 'Работодатель выключил/включил ИИ'),
      ev('question', { questionId: str(), status: en('queued', 'asked', 'answered') }, 'Вопрос работодателя'),
      ev('verdict', { verdict: free('Карта глубины: depthMap [{topic, catalogId, claimed, probed, maxLevel, confirmed, scores, total, quote}], summary, runs, validRuns, upgradedCatalogIds') }, 'Готов вердикт оценщика'),
      ev('signal', { from: str(), to: str(), payload: free('SDP или ICE-кандидат') }, 'Сигналинг WebRTC (defense-room)', ['from', 'payload']),
      ev('error', { code: str(), message: str() }, 'Ошибка на сервере'),
    ],
    discriminator: { propertyName: 'type' },
  },
  OnboardingView: free('Состояние онбординга: name, role, scenario, consent {version, docUrl}, progress {done, total}, history, current (шаг), summary, laterTarget, test {href, ready}, onboarded'),
};

const SESSION_USER = obj({
  id: str(),
  role: str('candidate, employer или pending'),
  name: str(),
  email: nullable(str()),
  isDemo: bool(),
  candidateId: nullable(str()),
  employerProfileId: nullable(str()),
  onboarded: bool(),
  consent: bool('Согласие текущей версии дано'),
  onboardingProgress: nullable(obj({ done: int(), total: int() }, ['done', 'total'], 'Закрыто шагов знакомства из скольки (пропуск считается закрытым); null — знакомство завершено или не посчитать')),
});

const FILTER_QUERY = [
  { name: 'spec', description: 'Специализация или fullstack (есть категории и в backend, и в frontend; грейд - меньший из двух)', schema: en('backend', 'frontend', 'ai', 'engineering', 'fullstack') },
  { name: 'grade', description: 'Грейд', schema: en('junior', 'middle') },
  { name: 'stack', description: 'Технологии через запятую, не больше 10', schema: str() },
  { name: 'fsp', description: '`1` — только с достижениями ФСП', schema: en('1') },
  { name: 'pool', description: '`all` — расширить пул: включить кандидатов без категории из теста (по умолчанию выдача только с категорией; такие кандидаты помечены в объяснении)', schema: en('all') },
  { name: 'category', description: 'Устарело: игнорируется — выдача и так только с категорией; расширение пула — `pool=all`', schema: en('1') },
  { name: 'limit', description: 'Размер выдачи; неверное значение заменяется значением по умолчанию', schema: int() },
];

const MATCHES = free('Ранжированные карточки с обоснованием (псевдоним, категория, покрытие, что закрыто и чего не хватает); контакты `null` до принятия приглашения');

const JSON_OK = (description: string, schema: JsonSchema) => ({ description, schema });
const SSE_ERRORS = { 409: 'Ход в этом разговоре уже идёт (`busy`) или не выполнено условие хода; до начала потока' };

export const OVERRIDES: Record<string, OpOverride> = {
  'GET /api/openapi': {
    role: 'public',
    summary: 'Спецификация OpenAPI',
    query: [{ name: 'format', description: '`json` — вернуть JSON (то же даёт `Accept: application/json`); иначе YAML', schema: en('json', 'yaml') }],
    success: {
      description: 'Документ OpenAPI 3.1: YAML (`application/yaml`) или JSON',
      contentType: 'application/yaml',
      schema: { type: 'string' },
      extra: [{ status: 200, description: 'При `format=json`', contentType: 'application/json', schema: { type: 'object' } }],
    },
    errors: {},
  },
  'POST /api/evaluate': {
    role: 'public',
    summary: 'Проверить подбор на своём наборе',
    description:
      'Наше ранжирование (то же, что подборка под потребность в кабинете) и базовая линия на наборе пользователя: P@k, nDCG@k, MRR по каждой вакансии и в среднем, топ-k с объяснениями. Считается в памяти, в БД ничего не пишется. Лимиты: тело ≤ 1 МБ, ≤ 50 вакансий, ≤ 1000 кандидатов, ≤ 60 требований и ≤ 200 утверждений на объект, k ≤ 20; id утверждений — из каталога. Лимит частоты — 30 прогонов за 10 минут с адреса.',
    body: {
      description: 'Набор: вакансии, кандидаты, разметка релевантности 0/1/2',
      schema: obj(
        {
          k: int('Глубина выдачи, 1–20 (по умолчанию 5)'),
          vacancies: arr(
            obj(
              {
                id: str(),
                title: str(),
                specialization: en('backend', 'frontend', 'ai', 'engineering'),
                grade: en('junior', 'middle', 'senior'),
                needs: arr(obj({ catalogId: str('id из каталога утверждений'), weight: int('1–3, по умолчанию 2') }, ['catalogId'])),
                stack: arr(str()),
              },
              ['id', 'specialization', 'grade', 'needs'],
            ),
          ),
          candidates: arr(
            obj(
              {
                id: str(),
                specialization: nullable(en('backend', 'frontend', 'ai', 'engineering')),
                fspState: en('not_linked', 'no_achievements', 'unavailable', 'linked'),
                category: nullable(obj({ specialization: en('backend', 'frontend', 'ai', 'engineering'), grade: en('junior', 'middle', 'senior') })),
                stack: arr(str()),
                claims: arr(obj({ catalogId: str(), level: en('self_reported', 'artifact', 'third_party', 'platform') }, ['catalogId'])),
              },
              ['id', 'claims'],
            ),
          ),
          relevance: free('relevance[id вакансии][id кандидата] = 0 | 1 | 2; кого нет — 0'),
        },
        ['vacancies', 'candidates', 'relevance'],
      ),
    },
    success: JSON_OK(
      'Метрики по вакансиям и среднее по вакансиям, где есть хотя бы один релевантный',
      free('k, candidates, vacancies, scored, mean {ours, baseline, precisionCeiling} | null, rows [{id, ours, baseline, top, baselineTop, …}], warnings'),
    ),
    errors: { 400: 'Не JSON, не прошла схема, неизвестный id каталога или разметка на несуществующих объектах', 403: 'Чужой Origin', 413: 'Тело больше 1 МБ', 429: 'Слишком много прогонов' },
  },

  'POST /api/simulator': {
    role: 'public',
    summary: 'Прогнать виртуального кандидата через адаптивный тест',
    description:
      'Боевой движок теста на грейд (выбор задания по информации Фишера, EAP-оценка θ, остановка и дозадавание по политике текущей версии) на виртуальном кандидате с заданной истинной θ. Режимы ответов: ideal (2PL по экспертным a, b), noise (шум b на показ), leak (трюк по 30 % семейств). Детерминированно по seed, без БД и LLM. Лимит частоты - 120 прогонов за 10 минут с адреса.',
    body: {
      description: 'Виртуальный кандидат',
      schema: obj(
        {
          subcategoryId: str('Подкатегория с полным банком, например backend.web-api'),
          claimed: en('junior', 'middle', 'senior'),
          theta: { type: 'number', minimum: -3, maximum: 3, description: 'Истинный уровень виртуального кандидата' },
          mode: en('ideal', 'noise', 'leak'),
          seed: int('0..2147483647, по умолчанию 1'),
        },
        ['subcategoryId', 'claimed', 'theta'],
      ),
    },
    success: JSON_OK(
      'Шаги теста и итог',
      free('input, policyVersion, steps [{n, templateId, title, itemGrade, a, b, phase, pModel, correct, theta, se}], start, confirmed, offeredGrade, grade, pPass, theta, se, stopReason, length, correctCount, cuts'),
    ),
    errors: { 400: 'Не JSON, не прошла схема или у подкатегории нет теста', 403: 'Чужой Origin', 413: 'Тело больше 2 КБ', 429: 'Слишком много прогонов' },
  },

  'GET /api/health': {
    role: 'public',
    summary: 'Проверка живости приложения и БД',
    success: { ...JSON_OK('Приложение и БД живы', obj({ ok: bool(), db: en('up', 'down'), llm: str('Провайдер LLM или misconfigured'), time: DT() })), extra: [{ status: 503, description: 'БД недоступна или LLM настроен неверно; тело той же формы', schema: obj({ ok: bool(), db: en('up', 'down'), llm: str(), time: DT() }) }] },
    errors: {},
  },

  'GET /api/auth/consent': {
    summary: 'Версия текста согласия на обработку ПДн', role: 'public', success: JSON_OK('Текущая версия текста согласия', obj({ version: str() })) },
  'POST /api/auth/consent': {
    success: JSON_OK('Согласие записано', obj({ version: str(), acceptedAt: DT() })),
    errors: { 409: 'Версия текста согласия устарела (`conflict`)' },
  },
  'POST /api/auth/logout': {
    summary: 'Выход',
    role: 'public',
    description: 'Выход: только POST (GET-выход можно дёрнуть картинкой с чужого сайта). Куку стирает. Запрос с `Accept: text/html` получает 303 на /auth.',
    success: { ...JSON_OK('Кука стёрта (запрос не из HTML-формы)', obj({ ok: bool() })), extra: [{ status: 303, description: 'HTML-форма: редирект на /auth' }] },
  },
  'GET /api/auth/me': {
    summary: 'Текущий вход',
    role: 'public',
    optionalAuth: true,
    success: JSON_OK(
      'Текущий вход. `user: null` — не вошёл; `legacyCandidateId` — старая кука демо-кандидата без аккаунта',
      obj({ user: nullable(SESSION_USER), legacyCandidateId: str() }, ['user']),
    ),
  },
  'POST /api/auth/onboarding/complete': {
    summary: 'Завершить онбординг',
    success: JSON_OK('Онбординг завершён', obj({ onboarded: { const: true }, next: str('Куда вести дальше (путь интерфейса)') })),
    errors: { 409: 'Не выбрана роль или нет согласия текущей версии (`conflict`)' },
  },
  'POST /api/auth/role': {
    summary: 'Выбрать роль (кандидат или работодатель)',
    description: 'Выбор роли в онбординге (один раз). Перевыпускает куку с новой ролью.',
    success: JSON_OK('Роль выбрана; выставлена новая кука cid', obj({ role: str(), candidateId: nullable(str()), employerProfileId: nullable(str()) })),
    errors: { 409: 'Роль уже выбрана или не дано согласие (`conflict`)' },
  },
  'POST /api/auth/role/switch': {
    summary: 'Переключить активную роль (вторая роль на той же учётке)',
    description:
      'ADR 0004. Профиль целевой роли есть — переключает; нет — создаёт (работодателю нужна `companyName`, создаётся новая компания) и запускает знакомство этой роли в ленте /consultant. Та же роль — идемпотентно (`changed: false`). Перевыпускает куку cid: в ней id профиля только активной роли. Клиент переходит на `next` полной навигацией.',
    success: JSON_OK(
      'Роль активна; выставлена новая кука cid',
      obj({ role: str(), next: str('Дом роли (путь интерфейса)'), created: bool(), changed: bool() }),
    ),
    errors: {
      400: 'Нет названия компании, когда профиль работодателя надо создать (`bad_request`), или тело не прошло схему (`validation_failed`)',
      401: 'Нет входа (`unauthorized`)',
      403: 'Старая демо-кука без аккаунта, общий демо-аккаунт без второй роли или запрос с чужого сайта (`forbidden`)',
      409: 'Роль ещё не выбрана — сначала знакомство (`conflict`)',
      429: 'Слишком много переключений (`rate_limited`)',
    },
  },
  'GET /api/auth/stale': {
    summary: 'Сбросить протухшую сессию',
    role: 'public',
    query: [{ name: 'next', description: 'Куда вернуть после входа; принимаются только внутренние пути', schema: str() }],
    description: 'Страничный guard шлёт сюда, когда кука подписана верно, а аккаунта в БД нет. Стирает куку, только если она и вправду протухла; живую сессию не трогает.',
    success: { description: 'Редирект 303: на /auth?next=… (кука стёрта) или на `next` (кука живая)' },
  },
  'GET /api/auth/yandex': {
    summary: 'Начать вход через Яндекс ID',
    role: 'public',
    query: [
      { name: 'consent', description: 'Версия текста согласия, отмеченная галкой на /auth (из GET /api/auth/consent); без неё в Яндекс не ведём', schema: str(), required: true },
      { name: 'next', description: 'Куда вернуть после входа; только внутренние пути', schema: str() },
    ],
    description: 'Старт входа через Яндекс ID: state и PKCE verifier в короткоживущей подписанной куке (10 минут), редирект на oauth.yandex.ru. Не настроен или нет согласия — обратно на /auth?error=… .',
    success: { description: 'Редирект 303 на oauth.yandex.ru или на /auth?error=yandex_not_configured|consent_required' },
  },
  'GET /api/auth/yandex/callback': {
    summary: 'Возврат из Яндекс ID',
    role: 'public',
    query: [
      { name: 'code', description: 'Код авторизации от Яндекса', schema: str() },
      { name: 'state', description: 'Должен совпасть со state из куки старта', schema: str() },
      { name: 'error', description: 'Присутствует, если пользователь отказал', schema: str() },
    ],
    description: 'Возврат с oauth.yandex.ru: проверка state, обмен кода (PKCE), профиль, создание или поиск аккаунта, новая кука сессии, редирект. Любая ошибка — на /auth?error=<код>, без подробностей и токенов.',
    success: { description: 'Редирект 303: незавершённый онбординг → /consultant (лента знакомства), иначе `next` или кабинет роли; при ошибке /auth?error=<код>' },
  },
  // lane fsp-oidc: привязка ФСП ID к профилю (R-FSP-01..04, R-C-15).
  'GET /api/fsp-id/link': {
    summary: 'Начать привязку ФСП ID',
    description: 'Кнопка в настройках кандидата: state, nonce и PKCE verifier — в подписанной httpOnly-куке на 10 минут (path /api/fsp-id), редирект на authorization endpoint. Без сессии кандидата — на /auth.',
    success: { status: 303, description: 'Редирект на страницу входа ФСП ID' },
  },
  'GET /api/fsp-id/login': {
    summary: 'Войти через ФСП ID',
    query: [
      { name: 'consent', description: 'Версия согласия с галки на /auth; иначе — /auth?error=consent_required', schema: str() },
      { name: 'next', description: 'Куда вернуть после входа (только свой путь)', schema: str() },
    ],
    description: 'Вход на платформу через ФСП ID (кандидат): state, nonce, PKCE verifier, согласие и next — в подписанной httpOnly-куке на 10 минут, редирект на страницу входа провайдера (симулятор ФСП ID по env или встроенный мок).',
    success: { status: 303, description: 'Редирект на страницу входа ФСП ID' },
  },
  'GET /api/fsp-id/callback': {
    summary: 'Возврат из ФСП ID',
    query: [
      { name: 'code', description: 'Код авторизации', schema: str() },
      { name: 'state', description: 'Должен совпасть со state из куки старта', schema: str() },
      { name: 'error', description: 'Присутствует при отказе', schema: str() },
    ],
    description: 'Проверка state, обмен кода с PKCE, проверка ID-токена (подпись по JWKS, iss, aud, exp, nonce). Привязка (кука потока mode=link): кандидат сессии = кандидат потока, участник привязывается к профилю. Вход (mode=login): аккаунт по ФСП ID (новый — сразу кандидат), согласие, привязка, кука сессии. Токены в URL не попадают.',
    success: { status: 303, description: 'Привязка: /settings или /consultant с ?fsp=linked|no_achievements|unavailable|error_<код>. Вход: /consultant или next; ошибка — /auth?error=fsp_<код>' },
  },
  'GET /api/fsp-id/realms/fsp/protocol/openid-connect/auth': {
    summary: 'Мок ФСП ID: страница входа',
    description: 'Authorization endpoint встроенного мока ФСП ID (путь как у Keycloak); только пока внешний провайдер не настроен, иначе 404. Проверяет client_id и redirect_uri по белому списку, PKCE S256, state и nonce; отдаёт HTML-страницу выбора демо-участника.',
    success: { description: 'HTML-страница входа; ошибка запроса — редирект на redirect_uri с error или страница ошибки' },
  },
  'POST /api/fsp-id/realms/fsp/protocol/openid-connect/auth': {
    summary: 'Мок ФСП ID: выбор демо-участника',
    description: 'Форма страницы входа мока: одноразовый код на 60 секунд и редирект на redirect_uri с code и state; «Отмена» — error=access_denied.',
    success: { status: 303, description: 'Редирект на /api/fsp-id/callback' },
  },
  // lane email-auth: вход по почте и паролю (R-D-04). Все формы — same-origin и лимит попыток на клиента (429).
  'POST /api/auth/register': {
    summary: 'Регистрация по почте',
    role: 'public',
    body: {
      schema: obj(
        {
          email: str('Почта; приводится к нижнему регистру', { format: 'email' }),
          password: str('Пароль, 8–128 символов'),
          name: str('Имя, до 120 символов'),
          consent: str('Версия текста согласия из GET /api/auth/consent (R-C-14); без неё аккаунт не создаётся'),
        },
        ['email', 'password', 'consent'],
      ),
    },
    success: JSON_OK('Код подтверждения отправлен. Ответ одинаковый и для занятой почты; `devCode` — только на локальном стенде', obj({ sent: { const: true }, devCode: str() }, ['sent'])),
    errors: { 403: 'Чужой Origin (`forbidden`)', 429: 'Слишком много попыток с клиента или писем на почту (`rate_limited`)', 503: 'Письмо не ушло: SMTP недоступен (`mail_unavailable`)' },
  },
  'POST /api/auth/verify': {
    summary: 'Подтвердить почту кодом из письма',
    role: 'public',
    body: { schema: obj({ email: str(undefined, { format: 'email' }), code: str('6 цифр из письма'), next: nullable(str('Куда вести после входа; только внутренние пути')) }, ['email', 'code']) },
    success: JSON_OK('Почта подтверждена, выставлена кука cid', obj({ next: str('Куда вести: /consultant (лента знакомства) или кабинет роли') })),
    errors: { 400: 'Неверный, просроченный или исчерпанный код (`invalid_code`, `code_expired`, `code_exhausted`) либо тело не прошло проверку', 403: 'Чужой Origin (`forbidden`)', 429: 'Слишком много попыток (`rate_limited`)' },
  },
  'POST /api/auth/verify/resend': {
    summary: 'Выслать код подтверждения заново',
    role: 'public',
    body: { schema: obj({ email: str(undefined, { format: 'email' }) }) },
    success: JSON_OK('Ответ одинаковый для любой почты; `devCode` — только на локальном стенде', obj({ sent: { const: true }, devCode: str() }, ['sent'])),
    errors: { 403: 'Чужой Origin (`forbidden`)', 429: 'Слишком много попыток (`rate_limited`)', 503: 'Письмо не ушло (`mail_unavailable`)' },
  },
  'POST /api/auth/login': {
    summary: 'Вход по почте и паролю',
    role: 'public',
    body: { schema: obj({ email: str(undefined, { format: 'email' }), password: str(), next: nullable(str('Куда вести после входа; только внутренние пути')) }, ['email', 'password']) },
    success: JSON_OK('Вход выполнен, выставлена кука cid', obj({ next: str('Куда вести: /consultant (лента знакомства) или кабинет роли') })),
    errors: {
      401: 'Неверная почта или пароль — одинаковый ответ (`invalid_credentials`)',
      403: 'Почта не подтверждена, новый код отправлен (`email_not_verified`; `details.devCode` — только на локальном стенде) или чужой Origin',
      429: 'Слишком много попыток (`rate_limited`)',
    },
  },
  'POST /api/auth/password/forgot': {
    summary: 'Код сброса пароля письмом',
    role: 'public',
    body: { schema: obj({ email: str(undefined, { format: 'email' }) }) },
    success: JSON_OK('Всегда `{ sent: true }`: не раскрываем, есть ли аккаунт', obj({ sent: { const: true } })),
    errors: { 403: 'Чужой Origin (`forbidden`)', 429: 'Слишком много попыток с клиента (`rate_limited`)', 503: 'Письмо не ушло (`mail_unavailable`)' },
  },
  'POST /api/auth/password/reset': {
    summary: 'Новый пароль по коду из письма',
    role: 'public',
    description: 'Смена пароля по коду; после смены прежние сессии аккаунта отзываются, выставляется новая кука cid.',
    body: { schema: obj({ email: str(undefined, { format: 'email' }), code: str('6 цифр из письма'), password: str('Новый пароль, 8–128 символов'), next: nullable(str()) }, ['email', 'code', 'password']) },
    success: JSON_OK('Пароль сменён, вход выполнен', obj({ next: str('Куда вести: /consultant (лента знакомства) или кабинет роли') })),
    errors: { 400: 'Неверный, просроченный или исчерпанный код (`invalid_code`, `code_expired`, `code_exhausted`) либо слабый пароль', 403: 'Чужой Origin (`forbidden`)', 429: 'Слишком много попыток (`rate_limited`)' },
  },

  'POST /api/claims/confirm-batch': {
    summary: 'Подтвердить пачку утверждений «со слов»',
    description: 'Подтвердить все утверждения «со слов»: одна транзакция, только свои утверждения уровня self_reported.',
    success: JSON_OK('Результат пакетного подтверждения (сколько подтверждено, какие id пропущены)', free('Счётчики и список подтверждённых утверждений')),
  },
  'POST /api/claims/{id}/{action}': {
    summary: 'Подтвердить, поправить или отклонить утверждение',
    pathParams: { action: en('confirm', 'edit', 'reject') },
    description: 'Карточка «да / поправить / нет». `action` — `confirm`, `edit` или `reject`; другое значение — 404. Только владелец: чужое и несуществующее — 404. Тело нужно только для `edit` и меняет лишь формулировку (3–300 символов); отклонённое не оживает (409).',
    body: { description: 'Только для action = edit', schema: obj({ statement: str('Новая формулировка, 3–300 символов; меняет и wording, и statement') }) },
    success: JSON_OK('Обновлённое утверждение', obj({ claim: ref('Claim') })),
    errors: { 409: 'Утверждение уже отклонено или в неподходящем статусе (`conflict`)' },
  },

  'GET /api/consultant/conversations': {
    summary: 'Список разговоров кандидата',
    success: JSON_OK('До 50 разговоров, свежие первыми', obj({ conversations: arr(obj({ id: str(), title: str(), createdAt: DT(), updatedAt: DT() })) })),
  },
  'GET /api/consultant/conversations/{id}': {
    summary: 'История разговора',
    description: 'История разговора. Только владелец. Служебные строки (system, tool, пустые assistant с вызовами) не отдаются.',
    success: JSON_OK(
      'Разговор и реплики по порядку',
      obj({
        conversation: obj({ id: str(), title: str(), createdAt: DT(), updatedAt: DT() }),
        messages: arr(obj({ id: str(), role: en('user', 'assistant'), content: str(), createdAt: DT() })),
      }),
    ),
  },
  'POST /api/consultant/messages': {
    summary: 'Ход консультанта (SSE)',
    description: 'Ход консультанта: тело — текст, вложения (id из /api/uploads) и ссылки; ответ — поток событий `ConsultantEvent`, заканчивается `done`. Один ход на разговор одновременно. Первый ход с вложениями запускает конвейер: сборщик → извлекатель → проверяющий → черновики утверждений (события `step`, `claims`). Не больше 6 вызовов инструментов за ход. В теле должен быть текст, вложение или ссылка (иначе 400); `onboardingStep` — свободный вопрос посреди онбординга, нужен вход, согласие и роль кандидата.',
    success: { schema: { type: 'string', description: 'Кадры `data: <json>`; схема кадра — ConsultantEvent', 'x-event-schema': ref('ConsultantEvent') } },
    errors: { ...SSE_ERRORS, 403: 'Вопрос посреди онбординга без входа или не кандидатом' },
  },

  'POST /api/defense': {
    summary: 'Начать защиту утверждения',
    description: 'Начать (или продолжить активную) защиту утверждения: короткое интервью из 3–5 вопросов, оценщик по рубрике, порог и уровень решает код.',
    success: {
      status: 201,
      schema: free('Сессия защиты: id, утверждение, первый вопрос, лимиты, оговорка; `resumed` — продолжена активная сессия'),
      description: 'Новая сессия защиты и первый вопрос',
      extra: [{ status: 200, description: 'Продолжена активная сессия (`resumed: true`)', schema: free('Та же форма, что у 201') }],
    },
    errors: { 404: 'Утверждение не найдено или чужое', 409: 'Утверждение нельзя защищать в текущем состоянии, исчерпаны лимиты или нет согласия на оценку ИИ (`consent_required`)' },
  },
  'GET /api/defense/{sessionId}': {
    summary: 'Состояние защиты', success: JSON_OK('Состояние: вопросы, ответы, вердикт, лимиты, оговорка', free('Состояние сессии защиты')) },
  'POST /api/defense/{sessionId}': {
    summary: 'Ответить на вопрос защиты',
    description: 'Ответ на текущий вопрос. Пустой ответ допустим («не знаю» оценивается честно). Результат — следующий вопрос или вердикт.',
    success: JSON_OK('Следующий вопрос или вердикт', free('Следующий вопрос либо вердикт с итоговым уровнем')),
    errors: { 409: 'Сессия уже завершена' },
  },

  'GET /api/demo/login': {
    summary: 'Список демо-аккаунтов',
    role: 'public',
    description: 'Список демо-кандидатов и демо-работодателей для экрана выбора. При выключенном DEMO_LOGIN — 404.',
    success: JSON_OK(
      'Демо-аккаунты',
      obj({
        candidates: arr(obj({ id: str(), name: str(), specialization: nullable(str()), fspState: str(), demoResume: nullable(obj({ fileName: str(), link: str() })) })),
        employers: arr(obj({ id: str(), name: str(), company: nullable(obj({ id: str(), name: str() })) })),
      }),
    ),
    errors: { 404: 'Демо-вход выключен' },
  },
  'POST /api/demo/login': {
    summary: 'Войти в демо-аккаунт',
    role: 'public',
    description: 'Вход за демо-аккаунт: новый пользователь (`fresh` с версией согласия), перезапуск онбординга, готовый демо-кандидат или демо-работодатель. Выставляет куку cid. Не-демо аккаунты — 404.',
    success: JSON_OK('Вход выполнен; в ответе `next` — куда вести', obj({ next: str() }, ['next'])),
    errors: { 404: 'Демо-вход выключен или аккаунт не демо' },
  },
  'DELETE /api/demo/login': {
    summary: 'Выйти из демо', role: 'public', description: 'Выход: стирает куку cid.', success: JSON_OK('Кука стёрта', obj({ ok: bool() })), errors: {} },
  'GET /api/demo/resume': {
    summary: 'Демо-резюме текущего демо-кандидата',
    description: 'Демо-резюме текущего демо-кандидата (PDF), чтобы жюри не искало файлы. Только при DEMO_LOGIN и только для демо-кандидатов. `?info=1` — метаданные вместо файла.',
    success: {
      description: 'PDF-файл демо-резюме (при `info=1` — JSON с метаданными)',
      contentType: 'application/pdf',
      schema: { type: 'string', format: 'binary' },
      extra: [{ status: 200, description: 'При `info=1`: имя файла и ссылка для вставки', schema: obj({ fileName: str(), link: str() }) }],
    },
    errors: { 403: 'Демо-вход выключен', 404: 'Не демо-кандидат или у него нет резюме' },
  },

  'POST /api/employer/assistant/messages': {
    summary: 'Ход помощника работодателя (SSE)',
    description: 'Ход помощника работодателя: поток событий `EmployerEvent`, как у консультанта. Разговор — свой, чужой — 404. Один ход на разговор одновременно. Помощник видит только публичную часть кандидатов (псевдоним, категория, покрытие); имя — только у принявших приглашение.',
    success: { schema: { type: 'string', description: 'Кадры `data: <json>`; схема кадра — EmployerEvent', 'x-event-schema': ref('EmployerEvent') } },
    errors: { 409: `${SSE_ERRORS[409]}; не приняты оферта или обязательство по данным (\`consent_required\`)` },
  },
  'GET /api/employer/invitations': {
    summary: 'Трекинг приглашений и остаток лимита',
    description: 'Статусы приглашений компании (R-E-05) и остаток суточного лимита.',
    success: JSON_OK('Приглашения компании и лимит', obj({ invitations: arr(free('Приглашение: кандидат, потребность, зарплата, статус, даты; контакты — только после принятия')), limit: obj({ perDay: int(), sentToday: int() }) })),

    errors: { 409: 'Не приняты оферта или обязательство по данным (`consent_required`, ADR 0005)' },
  },
  'POST /api/employer/invitations': {
    summary: 'Пригласить кандидата',
    description: 'Приглашение: описание задачи и зарплата обязательны, потребность — нет (R-E-05). Контакты кандидата до принятия скрыты.',
    success: { status: 201, description: 'Приглашение создано', schema: free('Созданное приглашение') },
    errors: { 404: 'Кандидат скрыт или не существует, либо потребность чужая', 409: 'Открытое приглашение этому кандидату уже есть, не приняты оферта и обязательство по данным (`consent_required`) или у компании нет способа связи (`company_contact_required`, `details.companyUrl`)', 429: 'Суточный лимит приглашений исчерпан' },
  },
  'GET /api/employer/search': {
    summary: 'Поиск по базе кандидатов',
    query: FILTER_QUERY,
    description: 'Поиск по всему банку без привязки к потребности (R-E-04): та же выдача, что у подборки. Нужны оферта и обязательство по данным (ADR 0005).',
    success: JSON_OK('Ранжированные карточки с обоснованием', MATCHES),
    errors: { 409: 'Не приняты оферта или обязательство по данным (`consent_required`, `details.kind`)' },
  },
  'GET /api/employer/vacancies/{id}/matches': {
    summary: 'Подборка кандидатов под потребность',
    query: FILTER_QUERY,
    description: 'Подборка с обоснованием (R-E-03, R-M-03); фильтры — query (R-M-04). Контакты скрыты до принятия приглашения (R-E-07).',
    success: JSON_OK('Ранжированные карточки с обоснованием', MATCHES),
    errors: { 404: 'Потребность не найдена или чужая', 409: 'Не приняты оферта или обязательство по данным (`consent_required`)' },
  },
  'GET /api/employer/vacancies/{id}': {
    summary: 'Потребность компании', success: JSON_OK('Потребность компании', free('Потребность: поля VacancyInput, id, archived, даты')), errors: { 404: 'Потребность не найдена или чужая' } },
  'PUT /api/employer/vacancies/{id}': { summary: 'Заменить поля потребности', success: JSON_OK('Обновлённая потребность', free('Потребность целиком')), errors: { 404: 'Потребность не найдена или чужая' } },
  'PATCH /api/employer/vacancies/{id}': { summary: 'Закрыть или вернуть потребность', success: JSON_OK('Потребность с новым признаком archived', free('Потребность целиком')), errors: { 404: 'Потребность не найдена или чужая' } },
  'GET /api/employer/vacancies': {
    summary: 'Потребности компании',
    success: JSON_OK('Компания и её потребности', obj({ company: obj({ id: str(), name: str() }), vacancies: arr(free('Потребность')) })),
  },
  'POST /api/employer/vacancies': {
    summary: 'Создать потребность',
    description: 'Создать потребность. Требования — только из каталога своей специализации или общие.',
    success: { status: 201, description: 'Потребность создана', schema: free('Созданная потребность') },
  },

  'GET /api/employer/company': {
    summary: 'Профиль своей компании',
    success: JSON_OK('Название, описание, отрасль, ИНН и контакт компании; `inviteContact` — способ связи в приглашениях от этого представителя (контакт компании, иначе его почта), null — приглашения не отправятся (409 company_contact_required)', obj({ id: str(), name: str(), description: str(), industry: str(), inn: str(), contact: str(), inviteContact: nullable(str()) })),
  },
  'PATCH /api/employer/company': {
    summary: 'Изменить профиль своей компании',
    description: 'Частичная правка: переданные поля заменяются, пустая строка стирает необязательное поле (название стереть нельзя). ИНН проверяется по контрольной сумме, контакт — почта или Telegram.',
    success: JSON_OK('Профиль компании после правки, с `inviteContact`', obj({ id: str(), name: str(), description: str(), industry: str(), inn: str(), contact: str(), inviteContact: nullable(str()) })),
  },

  'GET /api/invitations': {
    query: [{ name: 'view', description: '`1` — отметить просмотр: статус sent → viewed', schema: en('1') }],
    summary: 'Входящие приглашения кандидата',
    success: JSON_OK('Приглашения кандидата, только свои (R-C-16)', obj({ invitations: arr(free('Приглашение: компания, потребность, зарплата, сообщение, статус, даты; `disclosed` — действует раскрытие имени и контактов (Г5)')) })),
  },
  'POST /api/employer/invitations/{id}/hire': {
    summary: 'Отметить найм',
    description: 'Финальный этап пути кандидата: работодатель отмечает найм по своему принятому приглашению (accepted → hired, `hiredAt`). Повторная отметка идемпотентна. Нанятый кандидат не показывается в поиске и подборках других компаний.',
    success: JSON_OK('Приглашение со статусом hired', obj({ id: str(), status: en('hired'), hiredAt: str('Время отметки найма, ISO 8601') })),
    errors: { 404: 'Приглашение чужое или не существует', 409: 'Приглашение не в статусе accepted; не приняты оферта или обязательство по данным (`consent_required`, ADR 0005)' },
  },
  'POST /api/employer/invitations/{id}/withdraw': {
    summary: 'Отозвать приглашение',
    description: 'Работодатель отзывает приглашение своей компании с причиной (3–300 знаков): sent | viewed | accepted → withdrawn. Активное предложение слотов и назначенная живая защита закрываются (`cancelled`), ожидающая сессия защиты отменяется, раскрытие имени и контактов по приглашению прекращается. Кандидат видит статус и причину, получает уведомление и письмо. Лимит приглашений за сутки отзыв не возвращает.',
    success: JSON_OK('Приглашение со статусом withdrawn', obj({ id: str(), status: en('withdrawn'), withdrawn: obj({ at: str('Время отзыва, ISO 8601'), reason: str('Причина') }) })),
    errors: { 400: 'Причина пустая или длиннее 300 знаков (`reason_invalid`)', 404: 'Приглашение чужое или не существует', 409: 'Приглашение уже в статусе hired, declined или withdrawn (`invitation_not_withdrawable`); не приняты оферта или обязательство по данным (`consent_required`)' },
  },
  // lane live-slots (ADR 0008): назначение живой защиты через слоты.
  'POST /api/employer/invitations/{id}/live-defense': {
    summary: 'Предложить слоты живой защиты',
    description: 'Только по принятому приглашению своей компании: 2–5 слотов (ISO 8601, интерфейс вводит по МСК), 30 или 45 минут, не раньше чем через 2 часа и не позже 14 дней, комментарий до 300 знаков. Одно активное предложение на приглашение: новое заменяет старое. Кандидат получает уведомление.',
    success: { status: 201, description: 'Предложение и подстатус живой защиты', schema: ref('LiveDefense') },
    errors: { 400: 'Число слотов, длительность, окно времени или пересечение слотов (`slot_count`, `slot_duration`, `slot_window`, `slot_overlap`)', 404: 'Приглашение чужое или не существует', 409: 'Приглашение не принято (`invitation_not_accepted`); время занято защитой другого кандидата (`slot_taken`); защита уже назначена — сначала отмена (`live_defense_scheduled`)' },
  },
  'POST /api/employer/invitations/{id}/live-defense/cancel': {
    summary: 'Отменить живую защиту (работодатель)',
    description: 'С причиной; назначенную — не позднее чем за 1 час до начала. Время компании освобождается, кандидат получает уведомление.',
    success: JSON_OK('Предложение со статусом cancelled', ref('LiveDefense')),
    errors: { 404: 'Приглашение чужое или защита не назначалась', 409: 'Поздно отменять (`cancel_too_late`) или уже отменено (`not_scheduled`)' },
  },
  'POST /api/invitations/{id}/live-defense/choose': {
    summary: 'Выбрать слот живой защиты',
    description: 'Живая защита записывается (ADR 0008 п. 3): нужен действующее согласие на запись `call_recording` (ADR 0005). Без него — 409 `recording_consent_required` с `details: { version, paragraphs }`; с `recordingConsentVersion` согласие даётся тем же действием. Выбор создаёт или привязывает ожидающую сессию защиты (`CallSession kind=defense`), письма и уведомления — обеим сторонам.',
    success: JSON_OK('Назначенная защита', ref('LiveDefense')),
    errors: { 404: 'Приглашение чужое, предложения нет или слот не из него', 409: '`recording_consent_required`; время занято другим кандидатом компании (`slot_taken`); слот уже выбран или предложение отменено (`slot_already_chosen`); время прошло (`slot_past`)' },
  },
  'POST /api/invitations/{id}/live-defense/none-fit': {
    summary: 'Ни один слот не подходит',
    description: 'Комментарий, когда удобно; работодатель получает уведомление и предлагает новые слоты.',
    success: JSON_OK('Предложение с отметкой noneFit', ref('LiveDefense')),
    errors: { 404: 'Приглашение чужое или предложения нет', 409: 'Слот уже выбран или предложение отменено (`slot_already_chosen`)' },
  },
  'POST /api/invitations/{id}/live-defense/cancel': {
    summary: 'Отменить живую защиту (кандидат)',
    description: 'С причиной, не позднее чем за 1 час до начала.',
    success: JSON_OK('Предложение со статусом cancelled', ref('LiveDefense')),
    errors: { 404: 'Приглашение чужое или защита не назначалась', 409: '`cancel_too_late`; защита ещё не назначена или уже отменена (`not_scheduled`)' },
  },
  'POST /api/invitations/{id}': {
    summary: 'Принять или отклонить приглашение',
    description: 'Ответ кандидата на приглашение (R-C-11). Принятие требует `disclosureVersion` — версию текста согласия на раскрытие (Г5, ADR 0005): работодатель видит имя и контакты, пока раскрытие не отозвано.',
    success: JSON_OK('Приглашение с новым статусом', free('Приглашение')),
    errors: { 403: 'У кандидата нет аккаунта — раскрытие записать некому', 404: 'Приглашение чужое или не существует', 409: 'На приглашение уже отвечено; при accept без `disclosureVersion` — `consent_required`; версия текста устарела — `conflict`' },
  },

  'GET /api/consents': {
    summary: 'Мои согласия',
    description: 'Все согласия своей роли (ADR 0005): вид, текущая версия текста, данная версия, даты, состояние; раскрытия — по каждому приглашению с названием компании.',
    success: JSON_OK('Согласия аккаунта', obj({ items: arr(obj({
      kind: str('Вид согласия'), title: str(), label: str(), paragraphs: arr(str()), currentVersion: str(), version: nullable(str()),
      acceptedAt: nullable(DT()), revokedAt: nullable(DT()), state: en('active', 'outdated', 'revoked', 'none'),
      requiredFor: nullable(str()), revoke: en('button', 'erase', 'per_invitation'), invitationId: str(), company: str(), docUrl: str(),
    }, ['kind', 'title', 'currentVersion', 'version', 'acceptedAt', 'revokedAt', 'state', 'revoke'])) })),
  },
  'POST /api/consents': {
    summary: 'Дать согласие',
    description: 'Записать согласие на текущую версию текста. Повтор при действующем не создаёт дубля. Показ профиля снимает скрытие; раскрытие (`identity_disclosure`) — только по своему принятому приглашению (`context.invitationId`).',
    success: { status: 201, description: 'Согласие записано', schema: obj({ kind: str(), version: str(), acceptedAt: DT() }) },
    errors: { 400: 'Раскрытие без `context.invitationId`', 404: 'Приглашение для раскрытия не найдено или чужое', 409: 'Версия текста устарела или приглашение не принято (`conflict`)' },
  },
  'DELETE /api/consents/{kind}': {
    summary: 'Отозвать согласие',
    description: 'Ставит `revokedAt` у действующих строк. Запись созвона — аудио удаляется сразу, новые созвоны идут текстом. Показ — профиль скрывается. Раскрытие — по `invitationId`. Согласие на обработку ПДн отзывается только удалением аккаунта.',
    query: [{ name: 'invitationId', description: 'Для `identity_disclosure`: приглашение, по которому отозвать раскрытие', schema: str() }],
    success: JSON_OK('Согласие отозвано', obj({ kind: str(), revokedAt: DT(), deletedRecordings: int('Удалено аудиозаписей (только call_recording)') }, ['kind', 'revokedAt'])),
    errors: { 400: 'Неизвестный вид согласия', 409: 'Согласие на обработку ПДн отзывается удалением аккаунта (`consent_revoke_is_erase`)' },
  },
  'GET /api/objections': {
    summary: 'Мои возражения против оценки',
    success: JSON_OK('Возражения кандидата, свежие первыми', obj({ objections: arr(free('Возражение: предмет, текст, статус, срок ответа, ответ')) })),
  },
  'POST /api/objections': {
    summary: 'Оспорить автоматическую оценку',
    description: 'Возражение по ст. 16 152-ФЗ против оценки теста, созвона или защиты. Срок ответа — 30 дней; работодатель возражений не видит.',
    success: { status: 201, description: 'Возражение принято', schema: free('Возражение со сроком ответа `dueAt`') },
    errors: { 404: 'Оценка не найдена или чужая', 409: 'Открытое возражение по этой оценке уже есть' },
  },

  'GET /api/favorites': { errors: { 409: 'Работодатель: ' + 'Не приняты оферта или обязательство по данным (`consent_required`, ADR 0005)' } },
  'PUT /api/favorites': { errors: { 409: 'Работодатель: ' + 'Не приняты оферта или обязательство по данным (`consent_required`, ADR 0005)' } },
  'GET /api/employer/calls': { errors: { 409: 'Не приняты оферта или обязательство по данным (`consent_required`, ADR 0005)' } },
  'GET /api/employer/project-submissions': { errors: { 409: 'Не приняты оферта или обязательство по данным (`consent_required`, ADR 0005)' } },
  'POST /api/employer/project-submissions/{id}/invite-to-defense': { errors: { 409: 'Сдача ещё не проверена или защита уже назначена; ' + 'Не приняты оферта или обязательство по данным (`consent_required`, ADR 0005)' } },
  'POST /api/employer/call/{id}/join': { errors: { 409: 'В эфире другая компания (`room_busy`); ' + 'Не приняты оферта или обязательство по данным (`consent_required`, ADR 0005); ' + 'Не подтверждена запись разговора (`recording_consent_required`, ADR 0008 п. 3)' } },
  'POST /api/employer/call/{id}/audio': {
    summary: 'Сегмент голоса работодателя в живой защите',
    query: [{ name: 'startMs', description: 'Смещение начала сегмента от начала защиты, мс' }],
    body: { contentType: 'audio/webm', description: 'WebM/Opus с микрофона работодателя, до 4 МБ (~60 с)', schema: { type: 'string', format: 'binary' } },
    success: { status: 201, description: 'Сегмент сохранён файлом защиты (calls/<id>/employer)', schema: obj({ name: str('Имя сегмента NNN-<startMs>.webm'), startMs: { type: 'integer' } }) },
    errors: {
      404: 'Чужая или не своя живая защита, нет принятого приглашения',
      409: 'Не подключён, защита завершена или ИИ-защита; запись не подтверждена при входе (`recording_consent_required`); кандидат отозвал согласие на запись (`call_recording_off`); лимит сегментов',
      413: 'Сегмент больше 4 МБ',
    },
  },

  'GET /api/onboarding': {
    summary: 'Состояние онбординга', success: JSON_OK('Текущий шаг, лента, прогресс, итог', ref('OnboardingView')) },
  'POST /api/onboarding': {
    summary: 'Действие онбординга',
    description: 'Ответить на шаг (`answer`), пропустить (`skip`), вернуться (`goto`) или отложить (`later`: у кандидата шаги встают на паузу, лента /consultant продолжается свободным разговором; снимает паузу любой `answer`/`skip`/`goto`). После `answer`/`skip`/`goto` — новое состояние; при смене роли выставляется новая кука cid. Завершение — `POST /api/auth/onboarding/complete`.',
    success: { description: 'Новое состояние онбординга (`later` — `{ next }` без завершения)', schema: { oneOf: [ref('OnboardingView'), obj({ next: str() })] } },
    errors: { 409: 'Шаг недоступен в текущем состоянии' },
  },

  'GET /api/profile/pdf': {
    summary: 'Скачать PDF-профиль',
    description: 'Стандартизированный PDF-профиль текущего кандидата, формируется сервером (pdfkit): категория из теста с датой и версией политики, основное из анкеты и резюме, подтверждённые утверждения с уровнем доказанности (без цитат), статус ФСП, ступени проверки. Всегда `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, без кеширования. Только свои данные.',
    success: { description: 'PDF-файл профиля', contentType: 'application/pdf', schema: { type: 'string', format: 'binary' } },
  },
  'GET /api/profile/privacy': {
    summary: 'Видимость кандидата для работодателей', success: JSON_OK('Видят ли кандидата работодатели (R-C-13)', obj({ hiddenFromEmployers: bool() })) },
  'POST /api/profile/privacy': { summary: 'Скрыть или показать себя работодателям', success: JSON_OK('Новое значение', obj({ hiddenFromEmployers: bool() })) },
  'GET /api/profile': {
    summary: 'Профиль кандидата',
    success: JSON_OK('Профиль кандидата: категория (только из теста) и утверждения по уровням с датой и источником', free('category и claims, сгруппированные по уровням доказанности')),
  },
  'GET /api/recommendations': {
    summary: 'Рекомендации кандидату',
    description: 'Тест, пробелы к выбранной цели, задания под пробелы и цели-вакансии. Всё детерминированно и считается по подтверждённым утверждениям. Цель `vacancy:<id>` или `category:<spec>:<grade>`; по умолчанию — категория из теста, иначе лучшая вакансия.',
    success: JSON_OK(
      'Рекомендации',
      obj({ target: str(), test: free('Рекомендация теста: специализация, грейд, покрытие, пояснение'), gaps: arr(free('Пробел: запись каталога, приоритет')), tasks: arr(free('Задание из банка')), targets: arr(free('Вакансия: «закрываешь k из n»')) }),
    ),
  },

  'GET /api/stt': {
    summary: 'Режим голосового ввода',
    role: 'public',
    success: JSON_OK('Режим голосового ввода', obj({ mode: en('yandex', 'browser', 'off'), sampleRate: int(), maxBytes: int() })),
    errors: {},
  },
  'GET /api/call': {
    summary: 'Мои созвоны и согласие на запись',
    success: JSON_OK('Состояние согласия на запись и созвоны кандидата (свежие первыми, до 10)', obj({ consent: obj({ given: bool(), mode: { ...en('audio', 'text', 'ask'), description: '`audio` — запись разрешена; `text` — согласие отозвано, созвон идёт текстом без записи голоса; `ask` — согласия не было, спросить' }, version: str(), text: arr(str()) }), calls: arr(ref('CallView')) })),
  },
  'POST /api/call/consent': {
    summary: 'Согласие на запись созвона',
    success: JSON_OK('Согласие записано (повтор не создаёт дубля)', obj({ version: str(), acceptedAt: DT() })),
    errors: { 409: 'Версия текста устарела — обновить страницу' },
  },
  'POST /api/call/start': {
    summary: 'Начать созвон',
    success: {
      status: 201,
      description: 'Новый созвон: первая реплика ИИ в transcript',
      schema: obj({ sessionId: str(), resumed: bool(), webrtc: obj({ iceServers: arr({ type: 'object' }) }), call: ref('CallView') }),
      extra: [{ status: 200, description: 'Продолжен активный созвон (`resumed: true`)', schema: free('Та же форма, что у 201') }],
    },
    errors: { 409: 'Нет согласия на оценку ИИ (`consent_required`, kind ai_assessment) или на запись (`call_consent_required`, `details.version`)', 429: 'Лимит созвонов в сутки (`call_limit`, env CALL_DAILY_LIMIT; 0 — без лимита)' },
  },
  'GET /api/call/{id}': { summary: 'Созвон: статус, транскрипт, вердикт', role: 'session', success: JSON_OK('Созвон с учётом роли', ref('CallView')), errors: { 404: 'Нет созвона или нет доступа' } },
  'POST /api/call/{id}/turn': {
    summary: 'Реплика кандидата',
    success: JSON_OK(
      'Реплика кандидата и следующая реплика ИИ (`ai: null` — ИИ выключен работодателем); `done: true` — вопросы закончились, дальше finish',
      obj({ candidate: free('Реплика кандидата'), ai: nullable(free('Реплика ИИ')), text: nullable(str()), audioUrl: str('Зарезервировано; озвучка — через /api/tts'), done: bool() }, ['candidate', 'ai', 'text', 'done']),
    ),
    errors: { 400: 'Пустой текст ответа: распознаёт /audio или браузер, /turn сам STT не зовёт', 404: 'Чужой созвон или сегмент аудио', 409: 'Созвон завершён или ответ уже принят' },
  },
  'POST /api/call/{id}/interrupt': {
    summary: 'Кандидат перебил реплику ИИ',
    success: JSON_OK(
      'Реплика ИИ обрезана до услышанного (пометка «…(перебит)»), хвост — в `meta.interrupted.tail`; повтор идемпотентен, полностью услышанная реплика не меняется',
      free('Реплика транскрипта (TranscriptEntry)'),
    ),
    errors: { 404: 'Нет такой реплики ИИ', 409: 'Созвон завершён или это не текущий вопрос' },
  },
  'POST /api/call/{id}/audio': {
    summary: 'Сегмент голоса кандидата',
    body: { contentType: 'audio/l16', description: 'LPCM 16 бит, моно, 16 кГц, до 3 МБ (~90 с)', schema: { type: 'string', format: 'binary' } },
    success: { status: 201, description: 'Сегмент сохранён (WAV на диске); `text` — распознано SpeechKit или null (распознаёт браузер)', schema: obj({ audioRef: str('Имя сегмента NNN.wav'), text: nullable(str()) }) },
    errors: { 409: 'Созвон завершён, лимит сегментов, параллельная загрузка или согласие на запись отозвано (`call_recording_off`: созвон идёт текстом)', 413: 'Сегмент длиннее ~90 секунд' },
  },
  'POST /api/call/{id}/finish': {
    summary: 'Завершить созвон и получить карту глубины',
    success: JSON_OK('Созвон с вердиктом (без ответов — cancelled без вердикта)', ref('CallView')),
    errors: { 409: 'Оценка уже идёт или созвон закрыт без оценки', 503: 'Оценщик недоступен (`llm_unavailable`); ответы сохранены. Запусков оценщика на созвон не больше 3 — после третьего сбоя созвон закрывается (cancelled)' },
  },
  'POST /api/call/{id}/video': {
    summary: 'Сегмент видео с камеры кандидата',
    query: [{ name: 'startMs', description: 'Смещение начала сегмента от начала созвона, мс' }],
    body: { contentType: 'video/webm', description: 'WebM с камеры (комната звонка), до 8 МБ (~60 с при 300 кбит/с)', schema: { type: 'string', format: 'binary' } },
    success: { status: 201, description: 'Сегмент сохранён файлом созвона; в БД — ничего. Видео не анализируется', schema: obj({ name: str('Имя сегмента NNN-<startMs>.webm'), startMs: { type: 'integer' } }) },
    errors: { 409: 'Созвон завершён, лимит сегментов или параллельная загрузка', 413: 'Сегмент больше 8 МБ' },
  },
  'GET /api/call/{id}/video': {
    summary: 'Сегмент видео кандидата',
    role: 'session',
    query: [{ name: 'segment', description: 'Имя сегмента из CallView.videoSegments' }],
    success: { description: 'WebM', contentType: 'video/webm', schema: { type: 'string', format: 'binary' } },
    errors: { 403: 'Работодателю — только после принятого приглашения', 404: 'Нет сегмента' },
  },
  'GET /api/call/{id}/employer-audio': {
    summary: 'Сегменты голоса работодателя в живой защите',
    role: 'session',
    success: JSON_OK('Список сегментов', obj({ segments: { type: 'array', items: obj({ name: str('NNN-<startMs>.webm'), startMs: { type: 'integer' } }) } })),
    errors: { 403: 'Работодатель без действующего раскрытия (Г5)', 404: 'Нет защиты, ИИ-защита или чужая живая защита' },
  },
  'GET /api/call/{id}/employer-audio/file': {
    summary: 'Сегмент голоса работодателя',
    role: 'session',
    query: [{ name: 'segment', description: 'Имя сегмента из GET /api/call/{id}/employer-audio' }],
    success: { description: 'WebM/Opus', contentType: 'audio/webm', schema: { type: 'string', format: 'binary' } },
    errors: { 403: 'Работодатель без действующего раскрытия (Г5)', 404: 'Нет защиты, сегмента или доступа' },
  },
  'GET /api/call/{id}/recording': {
    summary: 'Аудио ответов кандидата',
    role: 'session',
    query: [{ name: 'segment', description: 'Один сегмент NNN.wav; без параметра — все сегменты одним WAV' }],
    success: { description: 'WAV (PCM 16 бит, 16 кГц)', contentType: 'audio/wav', schema: { type: 'string', format: 'binary' } },
    errors: { 403: 'Работодатель без принятого приглашения', 404: 'Нет созвона, нет доступа или аудио не записывалось' },
  },
  'GET /api/call/{id}/events': {
    summary: 'События созвона (SSE)',
    role: 'session',
    success: { description: 'Поток `text/event-stream`: кадры `event: <type>` + `data: <json>` (схема CallEvent), первым — snapshot; пинг-комментарий раз в 15 с', schema: ref('CallEvent') },
  },

  'POST /api/stt': {
    summary: 'Распознать речь',
    description: 'Голос в текст через Yandex SpeechKit. Тело — LPCM 16 бит, моно, 16 кГц (`audio/l16`), до 1 МБ (около 30 секунд). Только для вошедших. Аудио не сохраняется. Если режим не `yandex` — 400.',
    body: { contentType: 'audio/l16', description: 'Сырое аудио', schema: { type: 'string', format: 'binary' } },
    success: JSON_OK('Распознанный текст', obj({ text: str() })),
    errors: { 400: 'Серверное распознавание выключено или запись пустая', 413: 'Запись длиннее 30 секунд' },
  },

  'POST /api/test/attempt/{id}/answer': {
    summary: 'Ответить на задание теста',
    description: 'Ответ на текущее задание: проверка кодом, обновление оценки, следующее задание или итог.',
    success: JSON_OK('Следующее задание или итог попытки', free('Прогресс и следующее задание (без ключа) либо итог с разбором')),
    errors: { 409: 'Попытка уже завершена' },
  },
  'POST /api/test/attempt/{id}/confirm-junior': {
    summary: 'Подтвердить Junior вместо Middle',
    description: 'Middle не подтверждён — Junior по той же попытке по согласию кандидата (R-C-08).',
    success: JSON_OK('Итог попытки с категорией Junior', free('Итог попытки')),
    errors: { 409: 'Попытка не в состоянии «Middle не подтверждён»' },
  },
  'POST /api/test/attempt/{id}/confirm-start': {
    summary: 'Начать подтверждающий тест',
    description:
      'Попытка в статусе `needs_confirmation` (индекс честности high, ADR-0002, дополнение 11.10): короткий тест 6–8 заданий других семейств, лимит времени ×0,7. Интервалы пересдачи не проверяются и не запускаются. Одна подтверждающая попытка на исходную.',
    success: {
      status: 201,
      description: 'Новая подтверждающая попытка (`kind: confirm`)',
      schema: obj({ attemptId: str(), resumed: bool() }),
      extra: [{ status: 200, description: 'Продолжена активная подтверждающая попытка (`resumed: true`)', schema: obj({ attemptId: str(), resumed: bool() }) }],
    },
    errors: { 409: 'Подтверждение не требуется (`confirm_not_needed`), уже подтверждено (`already_confirmed`), подтверждающий тест уже пройден (`confirm_used`) или есть другая активная попытка (`active_attempt`)' },
  },
  'POST /api/test/attempt/{id}/signal': {
    summary: 'Сигналы браузера во время теста',
    description:
      'Дельты агрегатов браузера с прошлой отправки; сервер суммирует их в попытке для индекса честности. Только счётчики, без содержимого вставок и копий (152-ФЗ). Принимает `application/json` и `text/plain` с JSON (navigator.sendBeacon). Только активная попытка своего кандидата.',
    body: {
      description: 'Дельты; отсутствующее поле — 0',
      schema: obj(
        {
          tabHidden: int('Уходов со вкладки, 0–100'),
          hiddenMs: int('Сколько вкладка была скрыта, мс, до суток'),
          pastes: int('Вставок в поле ответа, 0–100'),
          pasteChars: int('Символов вставлено, до 100000'),
          copies: int('Копирований условия, 0–100'),
          extendedScreen: bool('Подключён второй экран (пометка, не флаг)'),
        },
        [],
      ),
    },
    success: JSON_OK('Накопленные сигналы попытки', obj({ signals: obj({ tabHidden: int(), hiddenMs: int(), pastes: int(), pasteChars: int(), copies: int(), extendedScreen: bool() }) })),
    errors: { 400: 'Тело не JSON, больше 2 КБ или значения вне пределов', 409: 'Попытка завершена или истекла (`attempt_finished`, `attempt_expired`)' },
  },
  'POST /api/test/attempt/{id}/finish': {
    summary: 'Завершить попытку досрочно',
    description: 'Досрочное завершение: итог по данным ответам; без ответов попытка получает статус `abandoned`.',
    success: JSON_OK('Итог попытки', free('Итог попытки')),
  },
  'GET /api/test/attempt/{id}': {
    summary: 'Состояние попытки теста',
    description: 'Состояние попытки: текущее задание без ключа и прогресс; после завершения — итог с разбором. Чужая попытка — 404.',
    success: JSON_OK('Задание или итог', free('Состояние попытки')),
  },
  'GET /api/test/attempts': {
    summary: 'История попыток теста', success: JSON_OK('История попыток (R-C-07)', obj({ attempts: arr(free('Попытка: специализация, грейд, статус, итог, даты')) })) },
  'GET /api/test/start': {
    summary: 'Можно ли начать тест',
    query: [
      { name: 'specialization', required: true, schema: en('backend', 'frontend') },
      { name: 'grade', required: true, schema: en('junior', 'middle') },
    ],
    description: 'Допуск по интервалам пересдачи (R-C-09) и текст правил.',
    success: JSON_OK('Допуск и правила', free('Решение о допуске (`nextAllowedAt`, причина) и `rules` — текст интервалов')),
  },
  'POST /api/test/start': {
    summary: 'Начать попытку теста',
    description: 'Начать попытку теста на грейд (R-C-05, R-C-06, R-C-09).',
    success: {
      status: 201,
      description: 'Новая попытка и первое задание',
      schema: free('Попытка: id, категория, первое задание без ключа; `resumed`'),
      extra: [{ status: 200, description: 'Продолжена активная попытка той же категории (`resumed: true`)', schema: free('Та же форма, что у 201') }],
    },
    errors: { 409: 'Нет согласия на оценку ИИ (`consent_required`); нельзя начать: активная попытка другой категории (`active_attempt`), смена грейда раньше срока (`grade_change_too_soon`) или пересдача раньше срока (`retake_too_soon`); в `details` — `nextAllowedAt`' },
  },

  'GET /api/uploads/{id}/file': {
    summary: 'Скачать оригинал загруженного файла',
    description: 'Оригинал файла владельцу: всегда `Content-Disposition: attachment` (filename* по RFC 5987), `X-Content-Type-Options: nosniff`, тип — только PDF/DOCX, иначе application/octet-stream.',
    success: { description: 'Файл PDF, DOCX, MD, TXT или CSV', contentType: 'application/octet-stream', schema: { type: 'string', format: 'binary' } },
    errors: { 404: 'Нет файла, чужой или загружен до хранения оригиналов' },
  },
  'DELETE /api/uploads/{id}': {
    summary: 'Удалить загруженный файл',
    description: 'Удаляет оригинал с диска и запись. Неподтверждённые утверждения из файла удаляются, подтверждённые и исправленные человеком остаются.',
    success: JSON_OK('Удалено', obj({ deletedClaims: int('Удалено черновиков'), keptClaims: int('Осталось подтверждённых и исправленных') })),
    errors: { 404: 'Нет файла или чужой' },
  },
  'DELETE /api/sources/{id}': {
    summary: 'Удалить подключённую ссылку',
    description: 'Удаляет ссылку (url, GitHub, Codeforces, Stack Overflow) со снимком. Неподтверждённые утверждения из неё удаляются, подтверждённые и исправленные человеком остаются.',
    success: JSON_OK('Удалено', obj({ deletedClaims: int('Удалено черновиков'), keptClaims: int('Осталось подтверждённых и исправленных') })),
    errors: { 404: 'Нет ссылки или чужая' },
  },
  'POST /api/uploads': {
    summary: 'Загрузить резюме или документ',
    description: 'Загрузка резюме или документа: PDF, DOCX, MD, TXT или CSV до 5 МБ (PDF до 20 страниц). Хранится извлечённый текст с координатами и оригинал файла (<UPLOAD_DIR>/<candidateId>/<sha256>, только после успешного разбора). Повтор того же файла (sha256) у того же кандидата возвращает прежнюю запись без второй копии.',
    body: {
      contentType: 'multipart/form-data',
      schema: obj({ file: str('Файл PDF, DOCX, MD, TXT или CSV', { format: 'binary' }), kind: en('resume', 'document') }, ['file']),
      description: '`kind` по умолчанию — resume',
    },
    success: {
      status: 201,
      description: 'Файл разобран',
      schema: obj({
        uploadId: str('Передаётся в POST /api/consultant/messages как uploadIds[]'),
        deduplicated: bool(),
        doc: obj({ title: str(), sourceKind: str(), lines: int(), pages: nullable(int()), flags: free('hiddenText, injectionSuspect, truncated, empty'), preview: str('Первые 300 символов') }),
      }),
      extra: [{ status: 200, description: 'Тот же файл уже загружен (`deduplicated: true`)', schema: obj({ uploadId: str(), deduplicated: bool(), doc: free('Метаданные документа') }) }],
    },
    errors: { 400: 'Нет файла в поле file, пустой файл или multipart не разобран', 413: 'Файл больше 5 МБ', 415: 'Нужен multipart/form-data' },
  },
};
