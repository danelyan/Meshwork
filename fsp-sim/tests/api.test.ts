import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal, Verifier } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/data.js';
import { buildDataset } from '../src/generator/build.js';
import { registerRoutes } from '../src/handlers.js';
import { ApiError, createHttpServer, Router } from '../src/http.js';

/** Подменный проверяющий токенов: `athlete:FSP-10001`, `partner:fsp-career`, иначе 401. */
const verify: Verifier = async (token) => {
  const [kind, id] = token.split(':');
  if (kind === 'athlete' && id) return { kind: 'athlete', subject: id, clientId: 'fsp-career', fspId: id, roles: ['athlete'] } satisfies Principal;
  if (kind === 'partner' && id) return { kind: 'partner', subject: `sa-${id}`, clientId: id, fspId: null, roles: ['partner'] } satisfies Principal;
  throw new ApiError(401, 'invalid_token', 'Токен не прошёл проверку', { 'www-authenticate': 'Bearer realm="fsp-id"' });
};

const dataset = buildDataset();
const registry = new Registry(dataset);
const config = loadConfig({ PUBLIC_URL: 'http://sim.test', KC_INTERNAL_URL: 'http://127.0.0.1:1/auth' });
const router = new Router();
registerRoutes(router, { registry, verify, config });
const server = createHttpServer(router);
let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const get = (path: string, token?: string) => fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const json = async (r: Response) => (await r.json()) as { data: any; meta: any; error?: { code: string; message: string } };

const first = dataset.athletes[0]!;
const consentedToDemo = dataset.consents.find((c) => c.client_id === 'fsp-partner-demo')!.fsp_id;
const notConsentedToDemo = dataset.athletes.find((a) => !dataset.consents.some((c) => c.client_id === 'fsp-partner-demo' && c.fsp_id === a.fsp_id))!.fsp_id;

describe('открытые маршруты', () => {
  it('каждый ответ помечен симулятором и завёрнут в data/meta', async () => {
    const r = await get('/api/v1/disciplines');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-fsp-simulator')).toBe('true');
    const body = await json(r);
    expect(body.meta.simulator).toBe(true);
    expect(body.data).toHaveLength(5);
  });

  it('список соревнований с фильтром и постраничностью; неверный фильтр — 400', async () => {
    const body = await json(await get('/api/v1/events?discipline=algorithmic&per_page=3&page=2'));
    expect(body.data).toHaveLength(3);
    expect(body.meta).toMatchObject({ page: 2, per_page: 3 });
    for (const e of body.data) expect(e.discipline).toBe('algorithmic');
    expect((await get('/api/v1/events?per_page=1000')).status).toBe(400);
    expect((await get('/api/v1/events?discipline=chess')).status).toBe(400);
  });

  it('протокол: места по порядку, у команд — состав с инициалами, без полных имён', async () => {
    const ev = dataset.events.find((e) => e.entrant_type === 'team')!;
    const body = await json(await get(`/api/v1/events/${ev.event_id}/results`));
    expect(body.data.event.event_id).toBe(ev.event_id);
    const places = body.data.results.filter((r: any) => r.place !== null).map((r: any) => r.place);
    expect(places).toEqual(places.map((_: number, i: number) => i + 1));
    const team = body.data.results[0].entrant;
    expect(team.type).toBe('team');
    expect(team.members[0].display_name).toMatch(/^\S+ \S\. \S\.$/);
    expect(JSON.stringify(body)).not.toContain(first.first_name + ' ' + first.middle_name);
  });

  it('команда и проверка достижения', async () => {
    const team = dataset.teams[0]!;
    expect((await json(await get(`/api/v1/teams/${team.team_id}`))).data.members).toHaveLength(team.members.length);
    const ach = dataset.achievements[0]!;
    const v = (await json(await get(`/api/v1/achievements/${ach.achievement_id}/verify`))).data;
    expect(v).toMatchObject({ valid: true, fsp_id: ach.fsp_id, checksum: ach.checksum, place: ach.place });
    expect((await json(await get('/api/v1/achievements/ACH-1999-0001/verify'))).data.valid).toBe(false);
  });

  it('404 для неизвестного маршрута и записи, 405 для метода', async () => {
    expect((await get('/api/v1/nothing')).status).toBe(404);
    expect((await get('/api/v1/events/EV-0000-000')).status).toBe(404);
    expect((await fetch(`${base}/api/v1/events`, { method: 'DELETE' })).status).toBe(405);
  });

  it('некорректная цель запроса (`//[`) — 400, процесс живёт', async () => {
    const { createConnection } = await import('node:net');
    const port = (server.address() as AddressInfo).port;
    const raw = await new Promise<string>((resolve, reject) => {
      const sock = createConnection(port, '127.0.0.1', () => sock.write('GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
      let buf = '';
      sock.on('data', (d) => (buf += d.toString()));
      sock.on('end', () => resolve(buf));
      sock.on('error', reject);
    });
    expect(raw.startsWith('HTTP/1.1 400')).toBe(true);
    expect(raw).toContain('bad_request');
    expect((await get('/api/v1/disciplines')).status).toBe(200);
  });

  it('стартовая страница, Swagger UI и OpenAPI', async () => {
    const landing = await get('/');
    expect(landing.headers.get('content-type')).toContain('text/html');
    expect(await landing.text()).toContain('не сервис Федерации');
    expect((await get('/docs')).status).toBe(200);
    const spec = (await (await get('/openapi.json')).json()) as any;
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.servers[0].url).toBe('http://sim.test/api/v1');
    expect(spec.components.securitySchemes.fspId.flows.authorizationCode.tokenUrl).toBe('http://sim.test/auth/realms/fsp-id/protocol/openid-connect/token');
    expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(17);
  });
});

describe('спортсмен', () => {
  it('без токена — 401 с WWW-Authenticate; с чужим — 401', async () => {
    const r = await get('/api/v1/me');
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('fsp-id');
    expect((await get('/api/v1/me', 'garbage')).status).toBe(401);
  });

  it('свой профиль, достижения и разряды', async () => {
    const me = (await json(await get('/api/v1/me', `athlete:${first.fsp_id}`))).data;
    expect(me.fsp_id).toBe(first.fsp_id);
    expect(me.full_name).toBe(`${first.last_name} ${first.first_name} ${first.middle_name}`);
    const ach = await json(await get('/api/v1/me/achievements?per_page=5', `athlete:${first.fsp_id}`));
    expect(ach.meta.total).toBe(dataset.achievements.filter((a) => a.fsp_id === first.fsp_id).length);
    expect(ach.data.length).toBeLessThanOrEqual(5);
    const ranks = (await json(await get('/api/v1/me/ranks', `athlete:${first.fsp_id}`))).data;
    expect(ranks).toEqual(expect.arrayContaining(dataset.ranks.filter((r) => r.fsp_id === first.fsp_id)));
  });

  it('спортсмен видит только себя через /athletes', async () => {
    expect((await get(`/api/v1/athletes/${first.fsp_id}`, `athlete:${first.fsp_id}`)).status).toBe(200);
    const other = dataset.athletes[1]!.fsp_id;
    expect((await get(`/api/v1/athletes/${other}`, `athlete:${first.fsp_id}`)).status).toBe(403);
    expect((await get('/api/v1/athletes', `athlete:${first.fsp_id}`)).status).toBe(403);
  });

  it('партнёрский токен к /me — 403', async () => {
    expect((await get('/api/v1/me', 'partner:fsp-career')).status).toBe(403);
  });
});

describe('партнёр и согласия', () => {
  it('fsp-career читает всех (исходные согласия), demo-партнёр — только давших согласие', async () => {
    const all = await json(await get('/api/v1/athletes?per_page=100', 'partner:fsp-career'));
    expect(all.meta.total).toBe(dataset.athletes.length);
    expect(all.data[0]).not.toHaveProperty('first_name');
    const demo = await json(await get('/api/v1/athletes?per_page=100', 'partner:fsp-partner-demo'));
    expect(demo.meta.total).toBe(dataset.consents.filter((c) => c.client_id === 'fsp-partner-demo').length);
    expect(demo.meta.client_id).toBe('fsp-partner-demo');
  });

  it('поиск по ФСП ID и региону', async () => {
    const byId = await json(await get(`/api/v1/athletes?q=${first.fsp_id}`, 'partner:fsp-career'));
    expect(byId.data.map((a: any) => a.fsp_id)).toEqual([first.fsp_id]);
    const byRegion = await json(await get('/api/v1/athletes?region=77&per_page=100', 'partner:fsp-career'));
    for (const a of byRegion.data) expect(a.region.code).toBe('77');
  });

  it('без согласия — 403 consent_required, с согласием — профиль и достижения; несуществующий id неотличим', async () => {
    const r = await get(`/api/v1/athletes/${notConsentedToDemo}`, 'partner:fsp-partner-demo');
    expect(r.status).toBe(403);
    expect((await json(r)).error?.code).toBe('consent_required');
    expect((await get('/api/v1/athletes/FSP-99999', 'partner:fsp-partner-demo')).status).toBe(403);
    expect((await get('/api/v1/athletes/bad-id', 'partner:fsp-partner-demo')).status).toBe(400);
    expect((await get(`/api/v1/athletes/${consentedToDemo}`, 'partner:fsp-partner-demo')).status).toBe(200);
    expect((await get(`/api/v1/athletes/${consentedToDemo}/achievements`, 'partner:fsp-partner-demo')).status).toBe(200);
    // demo-партнёру дают profile и achievements, но не ranks
    expect((await get(`/api/v1/athletes/${consentedToDemo}/ranks`, 'partner:fsp-partner-demo')).status).toBe(403);
  });

  it('спортсмен даёт и отзывает согласие, партнёр сразу видит разницу', async () => {
    const token = `athlete:${notConsentedToDemo}`;
    const before = (await json(await get('/api/v1/me/consents', token))).data.map((c: any) => c.client_id);
    expect(before).toEqual(['fsp-career']);
    const put = await fetch(`${base}/api/v1/me/consents/fsp-partner-demo`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ scopes: ['profile', 'ranks'] }),
    });
    expect(put.status).toBe(200);
    expect((await json(put)).data.scopes).toEqual(['profile', 'ranks']);
    expect((await get(`/api/v1/athletes/${notConsentedToDemo}/ranks`, 'partner:fsp-partner-demo')).status).toBe(200);
    expect((await get(`/api/v1/athletes/${notConsentedToDemo}/achievements`, 'partner:fsp-partner-demo')).status).toBe(403);
    const del = await fetch(`${base}/api/v1/me/consents/fsp-partner-demo`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(del.status).toBe(204);
    expect((await get(`/api/v1/athletes/${notConsentedToDemo}`, 'partner:fsp-partner-demo')).status).toBe(403);
    expect((await fetch(`${base}/api/v1/me/consents/unknown-client`, { method: 'PUT', headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    const bad = await fetch(`${base}/api/v1/me/consents/fsp-partner-demo`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ scopes: ['everything'] }),
    });
    expect(bad.status).toBe(400);
  });
});
