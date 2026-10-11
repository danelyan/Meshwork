import { z } from 'zod';

const stripSlash = (s: string) => s.replace(/\/+$/, '');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  /** Внешний адрес сервиса (Caddy): отсюда issuer токенов и ссылки в OpenAPI. */
  PUBLIC_URL: z.string().url().default('http://localhost:8088').transform(stripSlash),
  /** Keycloak внутри compose (JWKS и discovery читаются по внутренней сети). */
  KC_INTERNAL_URL: z.string().url().default('http://keycloak:8080/auth').transform(stripSlash),
  KC_REALM: z.string().min(1).default('fsp-id'),
  FSP_AUDIENCE: z.string().min(1).default('fsp-api'),
  FSP_DATA_FILE: z.string().min(1).default('data/dataset.json'),
  FSP_DEMO_PASSWORD: z.string().min(1).default('fsp-demo-2026'),
  FSP_PARTNER_DEMO_SECRET: z.string().min(1).default('fsp-partner-demo-secret'),
  /** Секрет клиента fsp-registry-admin: им API заводит пользователей ФСП ID для участников из песочницы. */
  FSP_REGISTRY_ADMIN_SECRET: z.string().min(1).default('fsp-registry-admin-secret'),
  /** Файл с правками песочницы (переживает рестарт). Не задан – правки живут в памяти. */
  FSP_STATE_FILE: z.string().min(1).optional(),
  /** Каталог со стартовой страницей стенда (index.html, app.css, app.js). */
  FSP_PUBLIC_DIR: z.string().min(1).default('public'),
  /** Платформа, на которой проверяют вход через ФСП ID (ссылка на стартовой странице). */
  PLATFORM_URL: z.string().url().default('https://fsp2.ru').transform(stripSlash),
});

export interface Config {
  port: number;
  publicUrl: string;
  /** Публичный адрес Keycloak: `${publicUrl}/auth`. */
  authBase: string;
  realm: string;
  issuer: string;
  jwksUrl: string;
  internalDiscoveryUrl: string;
  audience: string;
  dataFile: string;
  demoPassword: string;
  partnerDemoSecret: string;
  /** Адрес Admin REST API реалма по внутренней сети. */
  adminBase: string;
  internalTokenUrl: string;
  registryAdminSecret: string;
  stateFile: string | null;
  publicDir: string;
  platformUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Неверные переменные окружения: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const e = parsed.data;
  const authBase = `${e.PUBLIC_URL}/auth`;
  return {
    port: e.PORT,
    publicUrl: e.PUBLIC_URL,
    authBase,
    realm: e.KC_REALM,
    issuer: `${authBase}/realms/${e.KC_REALM}`,
    jwksUrl: `${e.KC_INTERNAL_URL}/realms/${e.KC_REALM}/protocol/openid-connect/certs`,
    internalDiscoveryUrl: `${e.KC_INTERNAL_URL}/realms/${e.KC_REALM}/.well-known/openid-configuration`,
    audience: e.FSP_AUDIENCE,
    dataFile: e.FSP_DATA_FILE,
    demoPassword: e.FSP_DEMO_PASSWORD,
    partnerDemoSecret: e.FSP_PARTNER_DEMO_SECRET,
    adminBase: `${e.KC_INTERNAL_URL}/admin/realms/${e.KC_REALM}`,
    internalTokenUrl: `${e.KC_INTERNAL_URL}/realms/${e.KC_REALM}/protocol/openid-connect/token`,
    registryAdminSecret: e.FSP_REGISTRY_ADMIN_SECRET,
    stateFile: e.FSP_STATE_FILE ?? null,
    publicDir: e.FSP_PUBLIC_DIR,
    platformUrl: e.PLATFORM_URL,
  };
}
