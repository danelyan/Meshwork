import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal, Verifier } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { Registry, SANDBOX_LIMITS } from '../src/data.js';
import { achievementChecksum, buildDataset } from '../src/generator/build.js';
import { registerRoutes } from '../src/handlers.js';
import { ApiError, createHttpServer, Router } from '../src/http.js';
import type { IdentityAdmin } from '../src/idp.js';

const verify: Verifier = async (token) => {
  const [kind, id] = token.split(':');
  if (kind === 'athlete' && id) return { kind: 'athlete', subject: id, clientId: 'fsp-athlete-demo', fspId: id, roles: ['athlete'] } satisfies Principal;
  if (kind === 'partner' && id) return { kind: 'partner', subject: `sa-${id}`, clientId: id, fspId: null, roles: ['partner'] } satisfies Principal;
  throw new ApiError(401, 'invalid_token', 'Токен не прошёл проверку');
};

const dataset = buildDataset();
const dir = mkdtempSync(join(tmpdir(), 'fsp-sim-'));
const stateFile = join(dir, 'state', 'registry.json');
const registry = new Registry(dataset, stateFile);
const config = loadConfig({ PUBLIC_URL: 'http://sim.test', KC_INTERNAL_URL: 'http://127.0.0.1:1/auth' });

/** Подменный ФСП ID: помнит логины пользователей и умеет «падать». */
const users = new Map<string, { first: string; last: string }>(dataset.athletes.map((a) => [a.username, { first: a.first_name, last: a.last_name }]));
let idpDown = false;
const down = () => {
  if (idpDown) throw new ApiError(503, 'idp_unavailable', 'ФСП ID (Keycloak) недоступен');
};
const idp: IdentityAdmin = {
  upsertUser: async (a) => {
    down();
    users.set(a.username, { first: a.first_name, last: a.last_name });
  },
  deleteUser: async (username) => {
    down();
    users.delete(username);
  },
  reconcile: async (athletes) => {
    down();
    const before = users.size;
    users.clear();
    for (const a of athletes) users.set(a.username, { first: a.first_name, last: a.last_name });
    return { created: 0, updated: 0, deleted: Math.max(0, before - users.size) };
  },
};

const router = new Router();
registerRoutes(router, { registry, verify, config, idp });
const server = createHttpServer(router);
let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

type Body = { data: any; meta: any; error?: { code: string; message: string } };
const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as Body) };
};

const person = { last_name: 'Стендов', first_name: 'Пётр', middle_name: 'Ильич', birth_year: 2001, region_code: '77', disciplines: ['product'] };
const newEvent = { name: 'Хакатон ЛЦТ 2026', discipline: 'product', kind: 'hackathon', date: '2026-10-11', entrants_total: 40 };

describe('песочница: участники', () => {
  it('страница и её файлы отдаются; meta описывает стенд без секрета платформы', async () => {
    const css = await fetch(`${base}/assets/app.css`);
    expect(css.headers.get('content-type')).toContain('text/css');
    const js = await fetch(`${base}/assets/app.js`);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(await js.text()).toContain('/sandbox');
    const meta = (await call('GET', '/sandbox/meta')).body!.data;
    expect(meta.token_url).toBe('http://sim.test/auth/realms/fsp-id/protocol/openid-connect/token');
    expect(meta.athlete_demo_client).toBe('fsp-athlete-demo');
    expect(meta.platform_url).toBe('https://fsp2.ru');
    expect(meta.changes.modified).toBe(false);
    expect(JSON.stringify(meta)).not.toContain('fsp-career-demo-secret');
    expect(JSON.stringify(meta)).not.toContain(config.registryAdminSecret);
  });

  it('созданный участник получает номер FSP-2xxxx, пользователя ФСП ID и сразу виден в основном API', async () => {
    const created = await call('POST', '/sandbox/athletes', person);
    expect(created.status).toBe(201);
    const card = created.body!.data;
    expect(card.athlete.fsp_id).toBe('FSP-20001');
    expect(card.athlete.manual).toBe(true);
    expect(card.login).toEqual({ username: 'fsp-20001', password: config.demoPassword });
    expect(users.get('fsp-20001')).toEqual({ first: 'Пётр', last: 'Стендов' });

    const me = await call('GET', '/me', undefined, 'athlete:FSP-20001');
    expect(me.body!.data.full_name).toBe('Стендов Пётр Ильич');
    expect((await call('GET', '/me/achievements', undefined, 'athlete:FSP-20001')).body!.data).toEqual([]);
    // Платформе команды согласие дано сразу, демо-партнёру – нет.
    expect((await call('GET', '/athletes/FSP-20001', undefined, 'partner:fsp-career')).status).toBe(200);
    expect((await call('GET', '/athletes/FSP-20001', undefined, 'partner:fsp-partner-demo')).status).toBe(403);

    const list = (await call('GET', '/sandbox/athletes?per_page=3')).body!;
    expect(list.data[0].fsp_id).toBe('FSP-20001');
    expect(list.meta.total).toBe(dataset.athletes.length + 1);
    expect(list.meta.changes).toMatchObject({ modified: true, manual_athletes: 1 });
    expect((await call('GET', '/sandbox/athletes?q=стендов')).body!.meta.total).toBe(1);
  });

  it('без отчества имя собирается без «undefined»', async () => {
    const created = await call('POST', '/sandbox/athletes', { ...person, last_name: 'Безотчества', middle_name: '' });
    const id = created.body!.data.athlete.fsp_id;
    const me = (await call('GET', '/me', undefined, `athlete:${id}`)).body!.data;
    expect(me.full_name).toBe('Безотчества Пётр');
    expect(me.display_name).toBe('Безотчества П.');
    expect((await call('DELETE', `/sandbox/athletes/${id}`)).status).toBe(204);
  });

  it('неверные поля – 400, произвольный текст в имени не проходит', async () => {
    for (const bad of [
      { ...person, last_name: '<script>alert(1)</script>' },
      { ...person, first_name: '' },
      { ...person, birth_year: 1900 },
      { ...person, region_code: '00' },
      { ...person, disciplines: [] },
      { ...person, disciplines: ['chess'] },
    ]) {
      const r = await call('POST', '/sandbox/athletes', bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body!.error!.code).toBe('validation');
    }
    expect((await call('GET', '/sandbox/athletes/FSP-1')).status).toBe(400);
    expect((await call('GET', '/sandbox/athletes/FSP-99999')).status).toBe(404);
  });

  it('правка меняет запись в реестре и пользователя ФСП ID', async () => {
    const r = await call('PATCH', '/sandbox/athletes/FSP-20001', { last_name: 'Стендова', first_name: 'Анна', sex: 'f', region_code: '78' });
    expect(r.status).toBe(200);
    expect(r.body!.data.athlete).toMatchObject({ last_name: 'Стендова', first_name: 'Анна', middle_name: 'Ильич', region_code: '78', username: 'fsp-20001' });
    expect(users.get('fsp-20001')).toEqual({ first: 'Анна', last: 'Стендова' });
    expect((await call('GET', '/me', undefined, 'athlete:FSP-20001')).body!.data.region.code).toBe('78');
    expect((await call('PATCH', '/sandbox/athletes/FSP-20001', {})).status).toBe(400);
    expect((await call('PATCH', '/sandbox/athletes/FSP-29999', { last_name: 'Нет' })).status).toBe(404);
  });

  it('если ФСП ID недоступен, участник не создаётся и не удаляется', async () => {
    idpDown = true;
    const before = registry.dataset.athletes.length;
    expect((await call('POST', '/sandbox/athletes', person)).status).toBe(503);
    expect((await call('DELETE', '/sandbox/athletes/FSP-20001')).status).toBe(503);
    expect((await call('POST', '/sandbox/reset')).status).toBe(503);
    idpDown = false;
    expect(registry.dataset.athletes.length).toBe(before);
    expect(registry.athletesById.has('FSP-20001')).toBe(true);
  });
});

describe('песочница: достижения и разряды', () => {
  let manualId = '';

  it('достижение по новому соревнованию видно спортсмену, в списке соревнований и в проверке записи', async () => {
    const r = await call('POST', '/sandbox/athletes/FSP-20001/achievements', { event: newEvent, place: 1, team_name: 'Команда стенда' });
    expect(r.status).toBe(201);
    const a = r.body!.data;
    manualId = a.achievement_id;
    expect(a).toMatchObject({ fsp_id: 'FSP-20001', event_name: 'Хакатон ЛЦТ 2026', season: 2026, date: '2026-10-11', place: 1, entrants_total: 40, team_name: 'Команда стенда', manual: true, verified: true, status: 'ranked', level: 'national' });
    expect(a.achievement_id).toMatch(/^ACH-2026-M\d{3}$/);
    expect(a.checksum).toBe(achievementChecksum(a));

    const mine = (await call('GET', '/me/achievements', undefined, 'athlete:FSP-20001')).body!;
    expect(mine.data.map((x: any) => x.achievement_id)).toEqual([manualId]);
    const ev = (await call('GET', `/events/${a.event_id}`)).body!.data;
    expect(ev).toMatchObject({ name: 'Хакатон ЛЦТ 2026', manual: true, entrant_type: 'team' });
    expect((await call('GET', `/events/${a.event_id}/results`)).body!.data.results).toEqual([]);
    expect((await call('GET', `/achievements/${manualId}/verify`)).body!.data).toMatchObject({ valid: true, fsp_id: 'FSP-20001', place: 1 });
  });

  it('достижение по соревнованию из набора: место в пределах числа участников, повтор – 409', async () => {
    const ev = dataset.events.find((e) => e.entrant_type === 'individual')!;
    const r = await call('POST', '/sandbox/athletes/FSP-20001/achievements', { event_id: ev.event_id, place: 2 });
    expect(r.status).toBe(201);
    expect(r.body!.data).toMatchObject({ event_id: ev.event_id, event_name: ev.name, team_name: null, entrants_total: ev.entrants_total, manual: true });
    // Баллы берутся у строки протокола с тем же местом.
    expect(r.body!.data.points).toBe(dataset.results.find((x) => x.event_id === ev.event_id && x.place === 2)!.points);
    expect((await call('POST', '/sandbox/athletes/FSP-20001/achievements', { event_id: ev.event_id, place: 3 })).status).toBe(409);
    const other = dataset.events.find((e) => e.event_id !== ev.event_id)!;
    expect((await call('POST', '/sandbox/athletes/FSP-20001/achievements', { event_id: other.event_id, place: other.entrants_total + 1 })).status).toBe(400);
    expect((await call('POST', '/sandbox/athletes/FSP-20001/achievements', { event_id: 'EV-1999-001', place: 1 })).status).toBe(404);
  });

  it('неверное тело достижения – 400', async () => {
    for (const bad of [
      { place: 1 },
      { event_id: dataset.events[0]!.event_id, event: newEvent, place: 1 },
      { event: newEvent },
      { event: { ...newEvent, date: '2026-02-30' }, place: 1 },
      { event: { ...newEvent, date: '2099-01-01' }, place: 1 },
      { event: { ...newEvent, name: '<b>x</b>' }, place: 1 },
      { event: newEvent, place: 0 },
    ]) {
      expect((await call('POST', '/sandbox/athletes/FSP-20001/achievements', bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const dq = await call('POST', '/sandbox/athletes/FSP-20001/achievements', { event: { ...newEvent, name: 'Кубок стенда' }, status: 'disqualified', place: 3 });
    expect(dq.body!.data).toMatchObject({ status: 'disqualified', place: null });
  });

  it('разряд вносится и удаляется; срок действия – по правилу набора', async () => {
    const r = await call('POST', '/sandbox/athletes/FSP-20001/ranks', { discipline: 'product', rank: 'КМС', assigned_on: '2026-10-01' });
    expect(r.status).toBe(201);
    expect(r.body!.data).toMatchObject({ rank: 'КМС', valid_until: '2029-10-01', basis_achievement_id: null, manual: true });
    expect((await call('GET', '/me', undefined, 'athlete:FSP-20001')).body!.data.best_rank).toEqual({ rank: 'КМС', discipline: 'product' });
    expect((await call('POST', '/sandbox/athletes/FSP-20001/ranks', { discipline: 'product', rank: 'Гроссмейстер', assigned_on: '2026-10-01' })).status).toBe(400);
    expect((await call('DELETE', `/sandbox/ranks/${r.body!.data.rank_id}`)).status).toBe(204);
    expect((await call('DELETE', `/sandbox/ranks/${r.body!.data.rank_id}`)).status).toBe(404);
    expect((await call('GET', '/me/ranks', undefined, 'athlete:FSP-20001')).body!.data).toEqual([]);
  });

  it('удаление записи убирает её из API, а соревнование, заведённое вручную, – вместе с последней записью', async () => {
    const eventId = registry.achievementsById.get(manualId)!.event_id;
    expect((await call('DELETE', `/sandbox/achievements/${manualId}`)).status).toBe(204);
    expect((await call('GET', `/achievements/${manualId}/verify`)).body!.data.valid).toBe(false);
    expect((await call('GET', `/events/${eventId}`)).status).toBe(404);
    expect((await call('DELETE', `/sandbox/achievements/${manualId}`)).status).toBe(404);
  });

  it('запись из исходного набора тоже удаляется; разряд по ней остаётся без основания', async () => {
    const rank = dataset.ranks[0]!;
    const basis = rank.basis_achievement_id!;
    expect((await call('DELETE', `/sandbox/achievements/${basis}`)).status).toBe(204);
    const ranks = (await call('GET', '/me/ranks', undefined, `athlete:${rank.fsp_id}`)).body!.data;
    expect(ranks.find((r: any) => r.rank_id === rank.rank_id).basis_achievement_id).toBeNull();
    // Исходный набор при этом не меняется: к нему возвращает сброс.
    expect(dataset.ranks[0]!.basis_achievement_id).toBe(basis);
  });
});

describe('песочница: состояние, удаление и сброс', () => {
  it('правки и согласия переживают рестарт: новый реестр читает файл состояния', async () => {
    await call('PUT', '/me/consents/fsp-partner-demo', { scopes: ['achievements'] }, 'athlete:FSP-20001');
    const again = new Registry(dataset, stateFile);
    expect(again.athletesById.get('FSP-20001')?.last_name).toBe('Стендова');
    expect(again.achievementsOf('FSP-20001').length).toBe(registry.achievementsOf('FSP-20001').length);
    expect(again.hasConsent('FSP-20001', 'fsp-partner-demo', 'achievements')).toBe(true);
    expect(again.changes().modified).toBe(true);
    // Номера не переиспользуются и после рестарта.
    expect(again.draftAthlete({ ...person, sex: 'm', disciplines: ['product'] }, '2026-10-11').fsp_id).not.toBe('FSP-20001');
  });

  it('файл состояния от другого исходного набора отбрасывается', () => {
    const other = buildDataset(7);
    const fresh = new Registry(other, stateFile);
    expect(fresh.athletesById.has('FSP-20001')).toBe(false);
    expect(fresh.changes().modified).toBe(false);
  });

  it('удалённого участника нет ни в реестре, ни в ФСП ID; протоколы остаются читаемыми', async () => {
    const victim = dataset.athletes[0]!;
    const eventId = dataset.achievements.find((a) => a.fsp_id === victim.fsp_id)!.event_id;
    expect((await call('DELETE', `/sandbox/athletes/${victim.fsp_id}`)).status).toBe(204);
    expect(users.has(victim.username)).toBe(false);
    expect((await call('GET', '/me', undefined, `athlete:${victim.fsp_id}`)).status).toBe(404);
    expect((await call('GET', `/athletes/${victim.fsp_id}`, undefined, 'partner:fsp-career')).status).toBe(403);
    expect((await call('GET', `/events/${eventId}/results`)).status).toBe(200);
    expect((await call('GET', '/sandbox/meta')).body!.data.changes.removed_athletes).toBe(1);
    expect((await call('DELETE', `/sandbox/athletes/${victim.fsp_id}`)).status).toBe(404);
  });

  it('предел ручных участников – 409 limit_reached', async () => {
    const have = registry.changes().manual_athletes;
    for (let i = have; i < SANDBOX_LIMITS.manual_athletes; i += 1) expect((await call('POST', '/sandbox/athletes', person)).status).toBe(201);
    const over = await call('POST', '/sandbox/athletes', person);
    expect(over.status).toBe(409);
    expect(over.body!.error!.code).toBe('limit_reached');
  });

  it('сброс возвращает исходный набор и пользователей, а номера ручных участников не переиспользует', async () => {
    const last = registry.dataset.athletes.at(-1)!.fsp_id;
    const r = await call('POST', '/sandbox/reset');
    expect(r.status).toBe(200);
    expect(r.body!.data.stats).toEqual(new Registry(dataset).stats());
    expect(registry.changes()).toEqual({ modified: false, manual_athletes: 0, removed_athletes: 0, manual_achievements: 0, manual_ranks: 0 });
    expect([...users.keys()].sort()).toEqual(dataset.athletes.map((a) => a.username).sort());
    expect(registry.hasConsent('FSP-20001', 'fsp-career', 'profile')).toBe(false);
    const next = await call('POST', '/sandbox/athletes', person);
    expect(Number(next.body!.data.athlete.fsp_id.slice(4))).toBe(Number(last.slice(4)) + 1);
    await call('POST', '/sandbox/reset');
  });
});
