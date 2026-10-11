import type { Config } from './config.js';

/**
 * OpenAPI 3.1 симулятора. Это предложенный командой контракт (docs/fsp-integration.md), а не
 * спецификация ФСП. Документ строится от PUBLIC_URL: адреса OAuth 2.0 указывают на реалм Keycloak.
 */

const envelope = (data: unknown, extraMeta: Record<string, unknown> = {}) => ({
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data,
    meta: { type: 'object', properties: { simulator: { type: 'boolean', const: true }, ...extraMeta } },
  },
});

const pageMeta = {
  page: { type: 'integer' },
  per_page: { type: 'integer' },
  total: { type: 'integer' },
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const list = (name: string) => ({ type: 'array', items: ref(name) });

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('ErrorEnvelope') } },
});

const ok = (schema: unknown, description = 'Успешно') => ({
  description,
  content: { 'application/json': { schema } },
});

const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'per_page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];

const disciplineEnum = ['product', 'algorithmic', 'infosec', 'robotics', 'drones'];
const kindEnum = ['championship', 'cup_qualifier', 'cup_final', 'junior_championship', 'regional_championship', 'hackathon'];
const rankEnum = ['МС', 'КМС', 'I спортивный разряд', 'II спортивный разряд', 'III спортивный разряд', 'I юношеский разряд', 'II юношеский разряд'];

const athleteSec = [{ fspId: ['openid'] }];
const partnerSec = [{ fspId: [] }, { fspIdClientCredentials: [] }];
const fspIdParam = { name: 'fsp_id', in: 'path', required: true, schema: { type: 'string', pattern: '^FSP-[0-9]{5}$' }, example: 'FSP-10001' };

export function buildOpenApi(config: Config): Record<string, unknown> {
  const oidc = `${config.issuer}/protocol/openid-connect`;
  return {
    openapi: '3.1.0',
    info: {
      title: 'Реестр ФСП — симулятор API',
      version: '1.0.0',
      summary: 'Синтетический реестр достижений Федерации спортивного программирования и ФСП ID на Keycloak.',
      description: [
        '**Это симулятор команды для ЛЦТ 2026, а не сервис ФСП.** Организатор API и схему реестра не выдаёт; этот контракт — предложение команды.',
        'Все спортсмены, команды, соревнования, протоколы и разряды синтетические (детерминированный генератор). Каждый ответ помечен `meta.simulator=true` и заголовком `X-FSP-Simulator: true`.',
        '',
        'Доступ: публичные справочники и протоколы — без токена; `/me/*` — токен спортсмена (вход через ФСП ID, claim `fsp_id`, роль `athlete`);',
        '`/athletes/*` — токен сервисного аккаунта партнёра (`client_credentials`, роль `partner`) **в пределах согласий спортсмена** (`profile`, `achievements`, `ranks`). Согласия спортсмен меняет в `/me/consents`.',
        '',
        '`/sandbox/*` — **песочница стенда**: ручная правка реестра без токена (участники, достижения, разряды). Она есть только в симуляторе, чтобы проверяющий мог изменить данные и увидеть их в ответах API и на платформе.',
        '',
        `Discovery OIDC: ${config.issuer}/.well-known/openid-configuration`,
      ].join('\n'),
      contact: { name: 'Команда ФСП Карьера (ЛЦТ 2026)' },
      license: { name: 'MIT' },
    },
    servers: [{ url: `${config.publicUrl}/api/v1` }],
    tags: [
      { name: 'Справочники', description: 'Открытые данные: дисциплины, регионы, партнёры' },
      { name: 'Соревнования', description: 'Соревнования и протоколы результатов (открыто, как публикуемые протоколы)' },
      { name: 'Проверка', description: 'Проверка записи о достижении по идентификатору' },
      { name: 'Спортсмен', description: 'Собственный профиль, достижения, разряды и согласия' },
      { name: 'Партнёр', description: 'Чтение реестра партнёром в пределах согласий' },
      { name: 'Песочница стенда', description: 'Ручная правка реестра без токена: участники, достижения, разряды, возврат к исходному набору. Есть только в симуляторе — в настоящем реестре записи вносит федерация по протоколам. Участник, созданный здесь, получает пользователя ФСП ID и может войти на платформе.' },
      { name: 'Служебное' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['Служебное'], operationId: 'health', summary: 'Состояние симулятора',
          responses: { 200: ok(envelope({ type: 'object', properties: { ok: { type: 'boolean' }, idp: { type: 'string', enum: ['up', 'down'] }, issuer: { type: 'string' }, athletes: { type: 'integer' }, events: { type: 'integer' }, achievements: { type: 'integer' } } })) },
        },
      },
      '/disciplines': { get: { tags: ['Справочники'], operationId: 'listDisciplines', summary: 'Дисциплины ФСП', responses: { 200: ok(envelope(list('Discipline'))) } } },
      '/regions': { get: { tags: ['Справочники'], operationId: 'listRegions', summary: 'Регионы', responses: { 200: ok(envelope(list('Region'))) } } },
      '/partners': { get: { tags: ['Справочники'], operationId: 'listPartners', summary: 'Зарегистрированные партнёры (клиенты ФСП ID)', responses: { 200: ok(envelope(list('Partner'))) } } },
      '/events': {
        get: {
          tags: ['Соревнования'], operationId: 'listEvents', summary: 'Список соревнований',
          parameters: [
            { name: 'discipline', in: 'query', schema: { type: 'string', enum: disciplineEnum } },
            { name: 'season', in: 'query', schema: { type: 'integer' }, example: 2025 },
            { name: 'level', in: 'query', schema: { type: 'string', enum: ['regional', 'national'] } },
            { name: 'kind', in: 'query', schema: { type: 'string', enum: kindEnum } },
            { name: 'region', in: 'query', schema: { type: 'string', pattern: '^[0-9]{2}$' } },
            ...pageParams,
          ],
          responses: { 200: ok(envelope(list('Event'), pageMeta)), 400: errorResponse('Неверные параметры') },
        },
      },
      '/events/{event_id}': {
        get: {
          tags: ['Соревнования'], operationId: 'getEvent', summary: 'Карточка соревнования',
          parameters: [{ name: 'event_id', in: 'path', required: true, schema: { type: 'string' }, example: 'EV-2025-003' }],
          responses: { 200: ok(envelope(ref('Event'))), 404: errorResponse('Не найдено') },
        },
      },
      '/events/{event_id}/results': {
        get: {
          tags: ['Соревнования'], operationId: 'getEventResults', summary: 'Протокол результатов',
          description: 'Места, баллы и критерии по регламенту соревнования. Как в публикуемых протоколах: фамилия с инициалами и регион; личная роль в команде протоколом не фиксируется.',
          parameters: [{ name: 'event_id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok(envelope({ type: 'object', properties: { event: { type: 'object' }, results: list('Result') } })), 404: errorResponse('Не найдено') },
        },
      },
      '/teams/{team_id}': {
        get: {
          tags: ['Соревнования'], operationId: 'getTeam', summary: 'Команда на соревновании',
          parameters: [{ name: 'team_id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok(envelope(ref('Team'))), 404: errorResponse('Не найдено') },
        },
      },
      '/achievements/{achievement_id}/verify': {
        get: {
          tags: ['Проверка'], operationId: 'verifyAchievement', summary: 'Проверить запись о достижении',
          description: 'По идентификатору из профиля кандидата: существует ли запись, кому принадлежит, какое место и соревнование. Контрольная сумма — SHA-256 ключевых полей, не электронная подпись.',
          parameters: [{ name: 'achievement_id', in: 'path', required: true, schema: { type: 'string' }, example: 'ACH-2025-0001' }],
          responses: { 200: ok(envelope(ref('Verification'))) },
        },
      },
      '/me': {
        get: { tags: ['Спортсмен'], operationId: 'getMe', summary: 'Мой профиль', security: athleteSec, responses: { 200: ok(envelope(ref('AthleteProfile'))), 401: errorResponse('Нет или неверный токен'), 403: errorResponse('Токен не спортсмена') } },
      },
      '/me/achievements': {
        get: { tags: ['Спортсмен'], operationId: 'getMyAchievements', summary: 'Мои достижения', security: athleteSec, parameters: pageParams, responses: { 200: ok(envelope(list('Achievement'), pageMeta)), 401: errorResponse('Нет токена') } },
      },
      '/me/ranks': {
        get: { tags: ['Спортсмен'], operationId: 'getMyRanks', summary: 'Мои спортивные разряды', security: athleteSec, responses: { 200: ok(envelope(list('Rank'))), 401: errorResponse('Нет токена') } },
      },
      '/me/consents': {
        get: { tags: ['Спортсмен'], operationId: 'getMyConsents', summary: 'Мои согласия партнёрам', security: athleteSec, responses: { 200: ok(envelope(list('Consent'))), 401: errorResponse('Нет токена') } },
      },
      '/me/consents/{client_id}': {
        put: {
          tags: ['Спортсмен'], operationId: 'grantConsent', summary: 'Дать или изменить согласие партнёру', security: athleteSec,
          parameters: [{ name: 'client_id', in: 'path', required: true, schema: { type: 'string' }, example: 'fsp-partner-demo' }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { scopes: { type: 'array', items: { type: 'string', enum: ['profile', 'achievements', 'ranks'] } } } } } } },
          responses: { 200: ok(envelope(ref('Consent'))), 404: errorResponse('Партнёр не зарегистрирован') },
        },
        delete: {
          tags: ['Спортсмен'], operationId: 'revokeConsent', summary: 'Отозвать согласие', security: athleteSec,
          parameters: [{ name: 'client_id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 204: { description: 'Отозвано (или не было)' }, 404: errorResponse('Партнёр не зарегистрирован') },
        },
      },
      '/athletes': {
        get: {
          tags: ['Партнёр'], operationId: 'searchAthletes', summary: 'Поиск спортсменов, давших согласие партнёру', security: partnerSec,
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string', minLength: 2 }, description: 'ФСП ID или часть ФИО' },
            { name: 'region', in: 'query', schema: { type: 'string', pattern: '^[0-9]{2}$' } },
            { name: 'discipline', in: 'query', schema: { type: 'string', enum: disciplineEnum } },
            ...pageParams,
          ],
          responses: { 200: ok(envelope(list('AthleteCard'), { ...pageMeta, client_id: { type: 'string' } })), 403: errorResponse('Не партнёр') },
        },
      },
      '/athletes/{fsp_id}': {
        get: { tags: ['Партнёр'], operationId: 'getAthlete', summary: 'Профиль спортсмена (согласие profile)', security: partnerSec, parameters: [fspIdParam], responses: { 200: ok(envelope(ref('AthleteProfile'))), 403: errorResponse('Нет согласия: `consent_required`') } },
      },
      '/athletes/{fsp_id}/achievements': {
        get: { tags: ['Партнёр'], operationId: 'getAthleteAchievements', summary: 'Достижения спортсмена (согласие achievements)', security: partnerSec, parameters: [fspIdParam, ...pageParams], responses: { 200: ok(envelope(list('Achievement'), pageMeta)), 403: errorResponse('Нет согласия') } },
      },
      '/athletes/{fsp_id}/ranks': {
        get: { tags: ['Партнёр'], operationId: 'getAthleteRanks', summary: 'Разряды спортсмена (согласие ranks)', security: partnerSec, parameters: [fspIdParam], responses: { 200: ok(envelope(list('Rank'))), 403: errorResponse('Нет согласия') } },
      },
      '/sandbox/meta': {
        get: { tags: ['Песочница стенда'], operationId: 'sandboxMeta', summary: 'Настройки стартовой страницы: адреса, демо-клиенты, справочники, пределы и сводка правок', security: [], responses: { 200: ok(envelope({ type: 'object' })) } },
      },
      '/sandbox/athletes': {
        get: {
          tags: ['Песочница стенда'], operationId: 'sandboxListAthletes', summary: 'Все участники реестра (сначала добавленные вручную)', security: [],
          parameters: [{ name: 'q', in: 'query', schema: { type: 'string' }, description: 'Часть ФИО, номера ФСП ID или логина' }, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } }, { name: 'per_page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } }],
          responses: { 200: ok(envelope(list('SandboxAthleteRow'), pageMeta)) },
        },
        post: {
          tags: ['Песочница стенда'], operationId: 'sandboxCreateAthlete', summary: 'Завести участника: номер FSP-2xxxx и пользователь ФСП ID с общим демо-паролем', security: [],
          requestBody: { required: true, content: { 'application/json': { schema: ref('SandboxAthleteInput') } } },
          responses: { 201: ok(envelope(ref('SandboxAthleteCard')), 'Создан'), 400: errorResponse('Неверные поля'), 409: errorResponse('Достигнут предел ручных записей: `limit_reached`'), 503: errorResponse('ФСП ID недоступен, реестр не изменён') },
        },
      },
      '/sandbox/athletes/{fsp_id}': {
        get: { tags: ['Песочница стенда'], operationId: 'sandboxGetAthlete', summary: 'Карточка участника: данные, логин ФСП ID, достижения, разряды, согласия', security: [], parameters: [fspIdParam], responses: { 200: ok(envelope(ref('SandboxAthleteCard'))), 404: errorResponse('Нет такого участника') } },
        patch: {
          tags: ['Песочница стенда'], operationId: 'sandboxUpdateAthlete', summary: 'Изменить данные участника (в реестре и в ФСП ID)', security: [], parameters: [fspIdParam],
          requestBody: { required: true, content: { 'application/json': { schema: ref('SandboxAthleteInput') } } },
          responses: { 200: ok(envelope(ref('SandboxAthleteCard'))), 400: errorResponse('Неверные поля'), 404: errorResponse('Нет такого участника') },
        },
        delete: { tags: ['Песочница стенда'], operationId: 'sandboxDeleteAthlete', summary: 'Удалить участника с достижениями, разрядами, согласиями и пользователем ФСП ID', security: [], parameters: [fspIdParam], responses: { 204: { description: 'Удалён' }, 404: errorResponse('Нет такого участника') } },
      },
      '/sandbox/athletes/{fsp_id}/achievements': {
        post: {
          tags: ['Песочница стенда'], operationId: 'sandboxAddAchievement', summary: 'Внести достижение: по существующему соревнованию (`event_id`) или по новому (`event`)', security: [], parameters: [fspIdParam],
          requestBody: { required: true, content: { 'application/json': { schema: ref('SandboxAchievementInput'), example: { event: { name: 'Хакатон ЛЦТ 2026', discipline: 'product', kind: 'hackathon', date: '2026-10-11', entrants_total: 40 }, place: 1, team_name: 'Команда стенда' } } } },
          responses: { 201: ok(envelope(ref('Achievement')), 'Внесено'), 400: errorResponse('Неверные поля'), 404: errorResponse('Нет участника или соревнования'), 409: errorResponse('Запись об этом соревновании уже есть или достигнут предел') },
        },
      },
      '/sandbox/achievements/{id}': {
        delete: { tags: ['Песочница стенда'], operationId: 'sandboxDeleteAchievement', summary: 'Удалить запись о достижении', security: [], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Удалена' }, 404: errorResponse('Нет такой записи') } },
      },
      '/sandbox/athletes/{fsp_id}/ranks': {
        post: {
          tags: ['Песочница стенда'], operationId: 'sandboxAddRank', summary: 'Присвоить разряд', security: [], parameters: [fspIdParam],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['discipline', 'rank', 'assigned_on'], properties: { discipline: { type: 'string', enum: disciplineEnum }, rank: { type: 'string', enum: rankEnum }, assigned_on: { type: 'string', format: 'date' } } } } } },
          responses: { 201: ok(envelope(ref('Rank')), 'Внесён'), 400: errorResponse('Неверные поля'), 404: errorResponse('Нет такого участника') },
        },
      },
      '/sandbox/ranks/{id}': {
        delete: { tags: ['Песочница стенда'], operationId: 'sandboxDeleteRank', summary: 'Удалить разряд', security: [], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Удалён' }, 404: errorResponse('Нет такого разряда') } },
      },
      '/sandbox/reset': {
        post: { tags: ['Песочница стенда'], operationId: 'sandboxReset', summary: 'Отменить все ручные правки: вернуть исходный набор и пользователей ФСП ID', security: [], responses: { 200: ok(envelope({ type: 'object' })), 503: errorResponse('ФСП ID недоступен, реестр не изменён') } },
      },
    },
    components: {
      securitySchemes: {
        fspId: {
          type: 'oauth2',
          description: 'ФСП ID (Keycloak, реалм fsp-id). Код авторизации с PKCE для спортсмена; client_credentials — для партнёра.',
          flows: {
            authorizationCode: { authorizationUrl: `${oidc}/auth`, tokenUrl: `${oidc}/token`, scopes: { openid: 'Вход', profile: 'Имя', email: 'Почта' } },
            clientCredentials: { tokenUrl: `${oidc}/token`, scopes: {} },
          },
        },
        fspIdClientCredentials: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token сервисного аккаунта партнёра' },
        fspIdDiscovery: { type: 'openIdConnect', openIdConnectUrl: `${config.issuer}/.well-known/openid-configuration` },
      },
      schemas: {
        ErrorEnvelope: {
          type: 'object',
          properties: {
            error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string', examples: ['unauthorized', 'forbidden', 'consent_required', 'validation', 'not_found'] }, message: { type: 'string' } } },
            meta: { type: 'object', properties: { simulator: { type: 'boolean' } } },
          },
        },
        Discipline: { type: 'object', properties: { code: { type: 'string', enum: disciplineEnum }, name: { type: 'string' }, short_name: { type: 'string' }, entrant_type: { type: 'string', enum: ['team', 'individual'] }, description: { type: 'string' }, criteria: { type: ['array', 'null'], items: { type: 'string' } } } },
        Region: { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' }, city: { type: 'string' } } },
        Partner: { type: 'object', properties: { client_id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } } },
        Event: {
          type: 'object',
          properties: {
            event_id: { type: 'string' }, name: { type: 'string' }, discipline: { type: 'string', enum: disciplineEnum }, kind: { type: 'string', enum: kindEnum },
            level: { type: 'string', enum: ['regional', 'national'] }, season: { type: 'integer' }, starts_on: { type: 'string', format: 'date' }, ends_on: { type: 'string', format: 'date' },
            format: { type: 'string', enum: ['online', 'offline', 'hybrid'] }, region_code: { type: ['string', 'null'] }, city: { type: ['string', 'null'] }, organizer: { type: 'string' },
            regulation: { type: 'object', properties: { code: { type: 'string' }, version: { type: 'string' }, criteria: { type: ['array', 'null'], items: { type: 'string' } } } },
            entrant_type: { type: 'string', enum: ['team', 'individual'] }, entrants_total: { type: 'integer' }, participants_total: { type: 'integer' }, protocol_url: { type: 'string' },
          },
        },
        Result: {
          type: 'object',
          properties: {
            result_id: { type: 'string' }, place: { type: ['integer', 'null'] }, status: { type: 'string', enum: ['ranked', 'disqualified'] },
            entrant: { type: 'object', description: 'Команда (team_id, name, region, members[]) или участник (fsp_id, display_name, region)' },
            points: { type: 'number' }, criteria_scores: { type: ['array', 'null'], items: { type: 'number' } }, tasks_solved: { type: ['integer', 'null'] }, penalty: { type: ['integer', 'null'] },
          },
        },
        Team: { type: 'object', properties: { team_id: { type: 'string' }, name: { type: 'string' }, region: { type: 'object' }, event: { type: 'object' }, captain_fsp_id: { type: 'string' }, members: { type: 'array', items: { type: 'object', properties: { fsp_id: { type: 'string' }, display_name: { type: 'string' } } } }, result: { type: ['object', 'null'] } } },
        AthleteCard: { type: 'object', properties: { fsp_id: { type: 'string' }, display_name: { type: 'string', description: 'Фамилия и инициалы' }, region: { type: 'object' }, disciplines: { type: 'array', items: { type: 'string' } }, best_rank: { type: ['string', 'null'], enum: [...rankEnum, null] } } },
        AthleteProfile: {
          type: 'object',
          properties: {
            fsp_id: { type: 'string' }, last_name: { type: 'string' }, first_name: { type: 'string' }, middle_name: { type: 'string' }, full_name: { type: 'string' }, display_name: { type: 'string' },
            birth_year: { type: 'integer' }, region: { type: 'object' }, disciplines: { type: 'array', items: { type: 'object' } }, member_since: { type: 'string', format: 'date' }, status: { type: 'string' },
            best_rank: { type: ['object', 'null'] }, achievements_total: { type: 'integer' },
          },
        },
        Achievement: {
          type: 'object',
          description: 'Подтверждённое реестром участие в соревновании. Личная роль в команде, ссылка на проект и стек — вне реестра: их сообщает сам кандидат.',
          properties: {
            achievement_id: { type: 'string' }, fsp_id: { type: 'string' }, event_id: { type: 'string' }, event_name: { type: 'string' }, discipline: { type: 'string', enum: disciplineEnum },
            level: { type: 'string', enum: ['regional', 'national'] }, kind: { type: 'string', enum: kindEnum }, season: { type: 'integer' }, date: { type: 'string', format: 'date' },
            entrant_type: { type: 'string', enum: ['team', 'individual'] }, team_id: { type: ['string', 'null'] }, team_name: { type: ['string', 'null'] }, place: { type: ['integer', 'null'] },
            status: { type: 'string', enum: ['ranked', 'disqualified'] }, entrants_total: { type: 'integer' }, points: { type: 'number' }, criteria_scores: { type: ['array', 'null'], items: { type: 'number' } },
            regulation: { type: 'object', properties: { code: { type: 'string' }, version: { type: 'string' } } }, verified: { type: 'boolean', const: true }, verified_at: { type: 'string', format: 'date-time' },
            protocol_url: { type: 'string' }, checksum: { type: 'string', description: 'SHA-256 ключевых полей' },
            manual: { type: 'boolean', description: 'Запись внесена вручную через песочницу стенда; у записей из набора поля нет' },
          },
        },
        Rank: { type: 'object', properties: { rank_id: { type: 'string' }, fsp_id: { type: 'string' }, discipline: { type: 'string', enum: disciplineEnum }, rank: { type: 'string', enum: rankEnum }, order_no: { type: 'string' }, assigned_on: { type: 'string', format: 'date' }, valid_until: { type: ['string', 'null'], format: 'date' }, basis_achievement_id: { type: ['string', 'null'] }, manual: { type: 'boolean', description: 'Внесён вручную через песочницу стенда' } } },
        SandboxAthleteInput: {
          type: 'object',
          description: 'При создании обязательны все поля, кроме middle_name и sex; при изменении — любое подмножество.',
          properties: {
            last_name: { type: 'string', maxLength: 40, description: 'Буквы, пробел, дефис, апостроф' },
            first_name: { type: 'string', maxLength: 40 },
            middle_name: { type: 'string', maxLength: 40 },
            sex: { type: 'string', enum: ['m', 'f'] },
            birth_year: { type: 'integer', minimum: 1950, maximum: 2015 },
            region_code: { type: 'string', pattern: '^[0-9]{2}$', description: 'Код из /regions' },
            disciplines: { type: 'array', minItems: 1, items: { type: 'string', enum: disciplineEnum } },
          },
        },
        SandboxAthleteRow: { type: 'object', properties: { fsp_id: { type: 'string' }, full_name: { type: 'string' }, username: { type: 'string' }, region: { type: ['object', 'null'] }, disciplines: { type: 'array', items: { type: 'string' } }, achievements_total: { type: 'integer' }, ranks_total: { type: 'integer' }, manual: { type: 'boolean' } } },
        SandboxAthleteCard: { type: 'object', properties: { athlete: { type: 'object' }, login: { type: 'object', properties: { username: { type: 'string' }, password: { type: 'string', description: 'Общий демо-пароль симулятора' } } }, achievements: list('Achievement'), ranks: list('Rank'), consents: list('Consent') } },
        SandboxAchievementInput: {
          type: 'object',
          description: 'Ровно одно из `event_id` и `event`. При `status: disqualified` место не указывается.',
          properties: {
            event_id: { type: 'string', description: 'Соревнование из /events' },
            event: { type: 'object', required: ['name', 'discipline', 'date', 'entrants_total'], properties: { name: { type: 'string', minLength: 3, maxLength: 160 }, discipline: { type: 'string', enum: disciplineEnum }, kind: { type: 'string', enum: kindEnum, default: 'hackathon' }, date: { type: 'string', format: 'date' }, entrants_total: { type: 'integer', minimum: 1, maximum: 5000 } } },
            place: { type: ['integer', 'null'], minimum: 1 },
            status: { type: 'string', enum: ['ranked', 'disqualified'], default: 'ranked' },
            team_name: { type: 'string', maxLength: 60 },
          },
        },
        Consent: { type: 'object', properties: { fsp_id: { type: 'string' }, client_id: { type: 'string' }, scopes: { type: 'array', items: { type: 'string', enum: ['profile', 'achievements', 'ranks'] } }, granted_at: { type: 'string', format: 'date-time' }, partner: { type: ['string', 'null'] } } },
        Verification: { type: 'object', properties: { valid: { type: 'boolean' }, achievement_id: { type: 'string' }, checksum: { type: 'string' }, fsp_id: { type: 'string' }, athlete: { type: ['string', 'null'] }, event: { type: 'object' }, entrant_type: { type: 'string' }, team_name: { type: ['string', 'null'] }, place: { type: ['integer', 'null'] }, status: { type: 'string' }, entrants_total: { type: 'integer' }, verified_at: { type: 'string' }, protocol_url: { type: 'string' }, reason: { type: 'string' } } },
      },
    },
  };
}
