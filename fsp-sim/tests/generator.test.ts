import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { achievementChecksum, buildDataset, impliedRank } from '../src/generator/build.js';
import { buildRealm } from '../src/generator/realm.js';
import { DATASET_PATH, REALM_PATH, renderFiles } from '../scripts/generate.js';
import type { Athlete } from '../src/types.js';

const ds = buildDataset();

describe('генератор набора данных', () => {
  it('детерминирован: два вызова дают одинаковый JSON', () => {
    expect(JSON.stringify(buildDataset())).toBe(JSON.stringify(ds));
  });

  it('закоммиченные data/dataset.json и keycloak/fsp-id-realm.json совпадают с генерацией (npm run generate)', () => {
    const files = renderFiles();
    expect(readFileSync(DATASET_PATH, 'utf8')).toBe(files.dataset);
    expect(readFileSync(REALM_PATH, 'utf8')).toBe(files.realm);
  });

  it('объём набора: 120 спортсменов, десятки соревнований, достижения у каждого участника', () => {
    expect(ds.athletes).toHaveLength(120);
    expect(ds.events.length).toBeGreaterThan(60);
    expect(ds.achievements.length).toBeGreaterThan(1000);
    expect(ds.ranks.length).toBeGreaterThan(50);
    expect(ds.simulator).toBe(true);
  });

  it('ссылочная целостность: достижения, результаты, команды и разряды ссылаются на существующие записи', () => {
    const athletes = new Set(ds.athletes.map((a) => a.fsp_id));
    const events = new Map(ds.events.map((e) => [e.event_id, e]));
    const teams = new Map(ds.teams.map((t) => [t.team_id, t]));
    const achievements = new Set(ds.achievements.map((a) => a.achievement_id));
    for (const a of ds.achievements) {
      expect(athletes.has(a.fsp_id)).toBe(true);
      expect(events.has(a.event_id)).toBe(true);
      if (a.team_id) expect(teams.get(a.team_id)!.members).toContain(a.fsp_id);
      expect(a.checksum).toBe(achievementChecksum(a));
      expect(a.date).toBe(events.get(a.event_id)!.ends_on);
    }
    for (const r of ds.results) {
      expect(events.has(r.event_id)).toBe(true);
      if (r.entrant_type === 'team') expect(teams.has(r.team_id!)).toBe(true);
      else expect(athletes.has(r.fsp_id!)).toBe(true);
      expect(r.status === 'disqualified' ? r.place === null : r.place !== null).toBe(true);
    }
    for (const t of ds.teams) {
      expect(events.has(t.event_id)).toBe(true);
      expect(t.members.length).toBeGreaterThanOrEqual(3);
      for (const m of t.members) expect(athletes.has(m)).toBe(true);
    }
    for (const r of ds.ranks) {
      expect(athletes.has(r.fsp_id)).toBe(true);
      expect(achievements.has(r.basis_achievement_id!)).toBe(true);
    }
    for (const c of ds.consents) {
      expect(athletes.has(c.fsp_id)).toBe(true);
      expect(ds.partners.some((p) => p.client_id === c.client_id)).toBe(true);
    }
  });

  it('уникальность идентификаторов', () => {
    for (const key of ['athletes', 'events', 'teams', 'results', 'achievements', 'ranks'] as const) {
      const idKey = { athletes: 'fsp_id', events: 'event_id', teams: 'team_id', results: 'result_id', achievements: 'achievement_id', ranks: 'rank_id' }[key];
      const ids = (ds[key] as unknown as Array<Record<string, unknown>>).map((x) => x[idKey]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('места в протоколе идут подряд с первого, участники соответствуют дисциплине и дате членства', () => {
    const byEvent = new Map<string, number[]>();
    for (const r of ds.results) if (r.place !== null) byEvent.set(r.event_id, [...(byEvent.get(r.event_id) ?? []), r.place]);
    for (const [eventId, places] of byEvent) {
      const sorted = [...places].sort((a, b) => a - b);
      expect(sorted, eventId).toEqual(sorted.map((_, i) => i + 1));
      const ev = ds.events.find((e) => e.event_id === eventId)!;
      expect(ev.entrants_total).toBe(ds.results.filter((r) => r.event_id === eventId).length);
    }
    const athletes = new Map(ds.athletes.map((a) => [a.fsp_id, a]));
    for (const a of ds.achievements) {
      const athlete = athletes.get(a.fsp_id)!;
      expect(athlete.disciplines).toContain(a.discipline);
      expect(athlete.member_since <= a.date).toBe(true);
    }
  });

  it('разряды: взрослый победитель чемпионата – МС, юниор – КМС, хакатон разряда не даёт', () => {
    const adult: Athlete = { ...ds.athletes[0]!, birth_year: 1999 };
    const junior: Athlete = { ...ds.athletes[0]!, birth_year: 2009 };
    const base = ds.achievements.find((a) => a.kind === 'championship')!;
    expect(impliedRank({ ...base, place: 1, season: 2025 }, adult)).toBe('МС');
    expect(impliedRank({ ...base, place: 1, season: 2025 }, junior)).toBe('КМС');
    expect(impliedRank({ ...base, kind: 'hackathon', place: 1 }, adult)).toBeNull();
    expect(impliedRank({ ...base, place: null }, adult)).toBeNull();
  });
});

describe('реалм Keycloak', () => {
  const realm = buildRealm(ds) as { users: Array<Record<string, unknown>>; clients: Array<Record<string, unknown>>; loginTheme: string };

  it('тема входа реалма лежит в репозитории: форма Keycloak цела, участники берутся у API реестра, пароль в тему не зашит', () => {
    const dir = resolve(dirname(REALM_PATH), 'themes', realm.loginTheme, 'login');
    const read = (name: string) => readFileSync(resolve(dir, name), 'utf8');
    expect(read('theme.properties')).toMatch(/^parent=keycloak\.v2$/m);
    const ftl = read('login.ftl');
    for (const part of ['action="${url.loginAction}"', 'name="username"', 'name="password"', 'name="credentialId"', 'js/quick-login.js']) expect(ftl).toContain(part);
    const js = read('resources/js/quick-login.js');
    expect(js).toContain('/api/v1/sandbox');
    for (const file of ['login.ftl', 'footer.ftl', 'resources/js/quick-login.js', 'messages/messages_ru.properties']) expect(read(file)).not.toContain('fsp-demo-2026');
    expect(read('messages/messages_ru.properties')).toMatch(/^fspSimFooter=Это не сервис Федерации/m);
  });

  it('пользователь на каждого спортсмена с атрибутом fsp_id и ролью athlete, плюс сервисные аккаунты', () => {
    const users = realm.users.filter((u) => !u['serviceAccountClientId']);
    expect(users).toHaveLength(ds.athletes.length);
    for (const [i, u] of users.entries()) {
      expect((u['attributes'] as { fsp_id: string[] }).fsp_id).toEqual([ds.athletes[i]!.fsp_id]);
      expect(u['realmRoles']).toEqual(['athlete']);
      expect(u['username']).toBe(ds.athletes[i]!.username);
    }
    const sa = realm.users.filter((u) => u['serviceAccountClientId']);
    expect(sa.map((u) => u['serviceAccountClientId']).sort()).toEqual(['fsp-career', 'fsp-partner-demo', 'fsp-registry-admin']);
    for (const u of sa.filter((x) => x['serviceAccountClientId'] !== 'fsp-registry-admin')) expect(u['realmRoles']).toEqual(['partner']);
    // Сервисный аккаунт API реестра управляет пользователями, но в реестр как партнёр не ходит.
    const admin = sa.find((x) => x['serviceAccountClientId'] === 'fsp-registry-admin')!;
    expect(admin['clientRoles']).toEqual({ 'realm-management': ['manage-users', 'view-realm'] });
    expect(admin['realmRoles']).toBeUndefined();
  });

  it('клиенты: fsp-career с PKCE и audience fsp-api, партнёр только client_credentials, fsp-api bearer-only', () => {
    const byId = new Map(realm.clients.map((c) => [c['clientId'], c]));
    const career = byId.get('fsp-career')!;
    expect((career['attributes'] as Record<string, string>)['pkce.code.challenge.method']).toBe('S256');
    expect(career['redirectUris']).toContain('https://fsp2.ru/*');
    const mappers = (career['protocolMappers'] as Array<{ name: string; config: Record<string, string> }>);
    expect(mappers.map((m) => m.name)).toEqual(['fsp_id', 'region_code', 'fsp-api-audience']);
    expect(mappers[2]!.config['included.client.audience']).toBe('fsp-api');
    const partner = byId.get('fsp-partner-demo')!;
    expect(partner['standardFlowEnabled']).toBe(false);
    expect(partner['serviceAccountsEnabled']).toBe(true);
    expect(byId.get('fsp-api')!['bearerOnly']).toBe(true);
  });

  it('клиенты стенда: публичный fsp-athlete-demo только с password grant и теми же claims, fsp-registry-admin только client_credentials', () => {
    const byId = new Map(realm.clients.map((c) => [c['clientId'], c]));
    const demo = byId.get('fsp-athlete-demo')!;
    expect(demo['publicClient']).toBe(true);
    expect(demo['directAccessGrantsEnabled']).toBe(true);
    expect(demo['standardFlowEnabled']).toBe(false);
    expect(demo['redirectUris']).toEqual([]);
    expect((demo['protocolMappers'] as Array<{ name: string }>).map((m) => m.name)).toEqual(['fsp_id', 'region_code', 'fsp-api-audience']);
    const admin = byId.get('fsp-registry-admin')!;
    expect(admin['publicClient']).toBe(false);
    expect(admin['serviceAccountsEnabled']).toBe(true);
    expect(admin['standardFlowEnabled']).toBe(false);
    expect(admin['directAccessGrantsEnabled']).toBe(false);
  });

  it('плейсхолдеры ${…} только у секретов и пароля – иначе Keycloak подставит переменные окружения в текст', () => {
    const text = JSON.stringify(realm);
    const placeholders = [...text.matchAll(/\$\{([A-Z_]+)(?::[^}]*)?\}/g)].map((m) => m[1]);
    expect(new Set(placeholders)).toEqual(new Set(['FSP_DEMO_PASSWORD', 'FSP_CAREER_CLIENT_SECRET', 'FSP_PARTNER_DEMO_SECRET', 'FSP_REGISTRY_ADMIN_SECRET']));
    expect(text.replace(/\$\{[A-Z_]+(?::[^}]*)?\}/g, '')).not.toContain('${');
  });
});
