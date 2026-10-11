import type { Config } from './config.js';
import { REGISTRY_ADMIN_CLIENT } from './generator/realm.js';
import { ApiError } from './http.js';
import type { Athlete } from './types.js';

/**
 * Пользователи ФСП ID вслед за правками песочницы: участник, созданный на стенде, должен войти
 * через ФСП ID на платформе. Работает через Admin REST API Keycloak с токеном сервисного аккаунта
 * `fsp-registry-admin` (роли realm-management: manage-users, view-realm).
 */
export interface IdentityAdmin {
  /** Создаёт пользователя участника или приводит имя и атрибуты существующего к записи реестра. */
  upsertUser(athlete: Athlete): Promise<void>;
  deleteUser(username: string): Promise<void>;
  /** Приводит пользователей-спортсменов реалма к списку участников реестра. */
  reconcile(athletes: Athlete[]): Promise<{ created: number; updated: number; deleted: number }>;
}

interface UserRep {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, string[]>;
}

const ATHLETE_LOGIN = /^fsp-\d{5}$/;
const TIMEOUT_MS = 10_000;

const unavailable = (what: string) => new ApiError(503, 'idp_unavailable', `ФСП ID (Keycloak) недоступен: ${what}. Реестр не изменён, повторите позже`);

function userBody(a: Athlete) {
  return {
    username: a.username,
    enabled: true,
    emailVerified: true,
    email: a.email,
    firstName: a.first_name,
    lastName: a.last_name,
    attributes: { fsp_id: [a.fsp_id], region_code: [a.region_code] },
  };
}

function differs(u: UserRep, a: Athlete): boolean {
  return u.firstName !== a.first_name || u.lastName !== a.last_name || u.attributes?.['fsp_id']?.[0] !== a.fsp_id || u.attributes?.['region_code']?.[0] !== a.region_code;
}

export function createKeycloakAdmin(config: Pick<Config, 'adminBase' | 'internalTokenUrl' | 'registryAdminSecret' | 'demoPassword'>): IdentityAdmin {
  let token: { value: string; expiresAt: number } | null = null;
  let athleteRole: { id: string; name: string } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 10_000) return token.value;
    const res = await fetch(config.internalTokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: REGISTRY_ADMIN_CLIENT, client_secret: config.registryAdminSecret }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`token: http_${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return token.value;
  }

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${config.adminBase}${path}`, {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${method} ${path.split('?')[0]}: http_${res.status}`);
    return res;
  }

  async function findUser(username: string): Promise<UserRep | null> {
    const res = await call('GET', `/users?username=${encodeURIComponent(username)}&exact=true`);
    return ((await res.json()) as UserRep[])[0] ?? null;
  }

  async function create(a: Athlete): Promise<void> {
    const res = await call('POST', '/users', { ...userBody(a), credentials: [{ type: 'password', value: config.demoPassword, temporary: false }] });
    // Идентификатор нового пользователя Keycloak отдаёт в Location; роли при создании через API не назначаются.
    const id = res.headers.get('location')?.split('/').pop() ?? (await findUser(a.username))?.id;
    if (!id) throw new Error('create: no user id');
    athleteRole ??= (await (await call('GET', '/roles/athlete')).json()) as { id: string; name: string };
    await call('POST', `/users/${id}/role-mappings/realm`, [{ id: athleteRole.id, name: athleteRole.name }]);
  }

  const update = (id: string, a: Athlete) => call('PUT', `/users/${id}`, userBody(a));

  const guarded = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      console.warn(`[fsp-sim] ФСП ID: ${what} — ${err instanceof Error ? err.message : 'unknown'}`);
      throw unavailable(what);
    }
  };

  return {
    upsertUser: (a) =>
      guarded('пользователь не сохранён', async () => {
        const existing = await findUser(a.username);
        if (existing) await update(existing.id, a);
        else await create(a);
      }),
    deleteUser: (username) =>
      guarded('пользователь не удалён', async () => {
        const existing = await findUser(username);
        if (existing) await call('DELETE', `/users/${existing.id}`);
      }),
    reconcile: (athletes) =>
      guarded('пользователи не сверены с реестром', async () => {
        const users = ((await (await call('GET', '/users?max=5000&briefRepresentation=false')).json()) as UserRep[]).filter((u) => ATHLETE_LOGIN.test(u.username));
        const byLogin = new Map(users.map((u) => [u.username, u]));
        const wanted = new Set(athletes.map((a) => a.username));
        const out = { created: 0, updated: 0, deleted: 0 };
        for (const u of users) {
          if (wanted.has(u.username)) continue;
          await call('DELETE', `/users/${u.id}`);
          out.deleted += 1;
        }
        for (const a of athletes) {
          const u = byLogin.get(a.username);
          if (!u) {
            await create(a);
            out.created += 1;
          } else if (differs(u, a)) {
            await update(u.id, a);
            out.updated += 1;
          }
        }
        return out;
      }),
  };
}
