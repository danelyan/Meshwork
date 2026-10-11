import type { Dataset } from '../types.js';

/**
 * Реалм Keycloak «fsp-id» (симулятор ФСП ID) для `start --import-realm`.
 * Плейсхолдеры `${VAR:default}` Keycloak подставляет из переменных окружения при импорте
 * (docs/guides/server/importExport: «Using Environment Variables within the Realm Configuration Files»).
 * Текст `${…}` в других местах файла недопустим — он тоже будет подставлен.
 */

export const REALM_NAME = 'fsp-id';
export const API_AUDIENCE = 'fsp-api';
/** Публичный клиент стенда: токен спортсмена по общему демо-паролю, чтобы показать ответ API в один клик. */
export const ATHLETE_DEMO_CLIENT = 'fsp-athlete-demo';
/** Сервисный аккаунт API реестра: заводит и удаляет пользователей ФСП ID вслед за правками песочницы. */
export const REGISTRY_ADMIN_CLIENT = 'fsp-registry-admin';

const fspIdMapper = {
  name: 'fsp_id',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-usermodel-attribute-mapper',
  consentRequired: false,
  config: {
    'user.attribute': 'fsp_id',
    'claim.name': 'fsp_id',
    'jsonType.label': 'String',
    'id.token.claim': 'true',
    'access.token.claim': 'true',
    'userinfo.token.claim': 'true',
    'introspection.token.claim': 'true',
  },
};

const regionMapper = {
  name: 'region_code',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-usermodel-attribute-mapper',
  consentRequired: false,
  config: {
    'user.attribute': 'region_code',
    'claim.name': 'region_code',
    'jsonType.label': 'String',
    'id.token.claim': 'true',
    'access.token.claim': 'true',
    'userinfo.token.claim': 'true',
    'introspection.token.claim': 'true',
  },
};

const audienceMapper = {
  name: 'fsp-api-audience',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-audience-mapper',
  consentRequired: false,
  config: {
    'included.client.audience': API_AUDIENCE,
    'id.token.claim': 'false',
    'access.token.claim': 'true',
    'introspection.token.claim': 'true',
  },
};

/** Декларативный профиль пользователя: fsp_id и region_code видит пользователь, меняет только администратор. */
const userProfile = {
  attributes: [
    {
      name: 'username',
      displayName: 'Логин',
      validations: { length: { min: 3, max: 255 }, 'username-prohibited-characters': {}, 'up-username-not-idn-homograph': {} },
      permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] },
      multivalued: false,
    },
    {
      name: 'email',
      displayName: 'Почта',
      validations: { email: {}, length: { max: 255 } },
      required: { roles: ['user'] },
      permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] },
      multivalued: false,
    },
    {
      name: 'firstName',
      displayName: 'Имя',
      validations: { length: { max: 255 }, 'person-name-prohibited-characters': {} },
      required: { roles: ['user'] },
      permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] },
      multivalued: false,
    },
    {
      name: 'lastName',
      displayName: 'Фамилия',
      validations: { length: { max: 255 }, 'person-name-prohibited-characters': {} },
      required: { roles: ['user'] },
      permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] },
      multivalued: false,
    },
    {
      name: 'fsp_id',
      displayName: 'ФСП ID',
      validations: { pattern: { pattern: '^FSP-[0-9]{5}$', 'error-message': 'Формат: FSP-00000' } },
      permissions: { view: ['admin', 'user'], edit: ['admin'] },
      multivalued: false,
    },
    {
      name: 'region_code',
      displayName: 'Код региона',
      validations: { pattern: { pattern: '^[0-9]{2}$', 'error-message': 'Две цифры' } },
      permissions: { view: ['admin', 'user'], edit: ['admin'] },
      multivalued: false,
    },
  ],
  groups: [],
};

export function buildRealm(dataset: Dataset): Record<string, unknown> {
  const users = dataset.athletes.map((a) => ({
    username: a.username,
    enabled: true,
    emailVerified: true,
    email: a.email,
    firstName: a.first_name,
    lastName: a.last_name,
    attributes: { fsp_id: [a.fsp_id], region_code: [a.region_code] },
    credentials: [{ type: 'password', value: '${FSP_DEMO_PASSWORD:fsp-demo-2026}', temporary: false }],
    realmRoles: ['athlete'],
    requiredActions: [],
  }));

  return {
    realm: REALM_NAME,
    displayName: 'ФСП ID (симулятор)',
    displayNameHtml: '<b>ФСП ID</b> · симулятор для ЛЦТ 2026',
    // Страницы входа с пояснением для жюри: keycloak/themes/fsp-id (монтируется в контейнер Keycloak).
    loginTheme: 'fsp-id',
    enabled: true,
    sslRequired: 'external',
    registrationAllowed: false,
    registrationEmailAsUsername: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: false,
    editUsernameAllowed: false,
    rememberMe: true,
    verifyEmail: false,
    bruteForceProtected: true,
    failureFactor: 10,
    accessTokenLifespan: 900,
    accessTokenLifespanForImplicitFlow: 900,
    ssoSessionIdleTimeout: 1800,
    ssoSessionMaxLifespan: 36000,
    internationalizationEnabled: true,
    // Только русский: пояснения темы входа написаны для жюри по-русски, язык браузера на них не влияет.
    supportedLocales: ['ru'],
    defaultLocale: 'ru',
    roles: {
      realm: [
        { name: 'athlete', description: 'Спортсмен ФСП: доступ к собственному профилю и достижениям' },
        { name: 'partner', description: 'Сервисный аккаунт партнёра: чтение реестра в пределах согласий спортсменов' },
        { name: 'registry-admin', description: 'Администратор реестра (в симуляторе не используется)' },
      ],
    },
    clients: [
      {
        clientId: 'fsp-career',
        name: 'MESHWORK (платформа команды)',
        description: 'Confidential-клиент: вход спортсмена по OIDC (authorization code + PKCE) и client_credentials для чтения реестра.',
        enabled: true,
        protocol: 'openid-connect',
        publicClient: false,
        secret: '${FSP_CAREER_CLIENT_SECRET:fsp-career-demo-secret}',
        standardFlowEnabled: true,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: true,
        serviceAccountsEnabled: true,
        fullScopeAllowed: true,
        redirectUris: [
          'https://fsp2.ru/*',
          'http://localhost:3000/*',
          'http://127.0.0.1:3000/*',
          'http://localhost:3100/*',
        ],
        webOrigins: ['+'],
        attributes: {
          'pkce.code.challenge.method': 'S256',
          'post.logout.redirect.uris': '+',
          'access.token.lifespan': '900',
        },
        protocolMappers: [fspIdMapper, regionMapper, audienceMapper],
      },
      {
        clientId: 'fsp-partner-demo',
        name: 'Демо-партнёр',
        description: 'Только client_credentials. Открытый демонстрационный клиент для показа модели согласий.',
        enabled: true,
        protocol: 'openid-connect',
        publicClient: false,
        secret: '${FSP_PARTNER_DEMO_SECRET:fsp-partner-demo-secret}',
        standardFlowEnabled: false,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
        fullScopeAllowed: true,
        redirectUris: [],
        webOrigins: [],
        protocolMappers: [audienceMapper],
      },
      {
        clientId: ATHLETE_DEMO_CLIENT,
        name: 'Демо-вход спортсмена (стенд)',
        description: 'Публичный клиент только с password grant: кнопки стенда получают токен спортсмена по общему демо-паролю. В настоящем ФСП ID такого клиента быть не должно.',
        enabled: true,
        protocol: 'openid-connect',
        publicClient: true,
        standardFlowEnabled: false,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: true,
        serviceAccountsEnabled: false,
        fullScopeAllowed: true,
        redirectUris: [],
        webOrigins: [],
        protocolMappers: [fspIdMapper, regionMapper, audienceMapper],
      },
      {
        clientId: REGISTRY_ADMIN_CLIENT,
        name: 'API реестра: управление пользователями стенда',
        description: 'Только client_credentials. Сервисный аккаунт с ролью manage-users: API реестра заводит пользователя ФСП ID для участника, созданного в песочнице.',
        enabled: true,
        protocol: 'openid-connect',
        publicClient: false,
        secret: '${FSP_REGISTRY_ADMIN_SECRET:fsp-registry-admin-secret}',
        standardFlowEnabled: false,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
        fullScopeAllowed: true,
        redirectUris: [],
        webOrigins: [],
      },
      {
        clientId: API_AUDIENCE,
        name: 'Реестр ФСП (API)',
        description: 'Ресурс: audience токенов, которые принимает API реестра. Сам не выдаёт токены.',
        enabled: true,
        protocol: 'openid-connect',
        bearerOnly: true,
        publicClient: false,
        standardFlowEnabled: false,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: false,
        redirectUris: [],
      },
    ],
    users: [
      ...users,
      { username: 'service-account-fsp-career', enabled: true, serviceAccountClientId: 'fsp-career', realmRoles: ['partner'] },
      { username: 'service-account-fsp-partner-demo', enabled: true, serviceAccountClientId: 'fsp-partner-demo', realmRoles: ['partner'] },
      {
        username: `service-account-${REGISTRY_ADMIN_CLIENT}`,
        enabled: true,
        serviceAccountClientId: REGISTRY_ADMIN_CLIENT,
        clientRoles: { 'realm-management': ['manage-users', 'view-realm'] },
      },
    ],
    components: {
      'org.keycloak.userprofile.UserProfileProvider': [
        {
          providerId: 'declarative-user-profile',
          subComponents: {},
          config: { 'kc.user.profile.config': [JSON.stringify(userProfile)] },
        },
      ],
    },
  };
}
