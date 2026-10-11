import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  candidate: { update: vi.fn() },
  source: { updateMany: vi.fn(), findFirst: vi.fn(async () => null), update: vi.fn(), create: vi.fn() },
};
vi.mock('@/server/db', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    source: { findFirst: vi.fn(async () => null) },
  },
}));

import { pkceChallenge } from '@/server/auth/yandex';
import { FSP_DEMO_PARTICIPANTS, fspDemoDoc, fspRegistryLookup } from '@/server/collector/fsp-demo';
import { prisma } from '@/server/db';
import {
  buildAuthorizeUrl,
  completeFlow,
  FspCallbackFailed,
  fspIdentity,
  newFlow,
  signFlowState,
  verifyFlowState,
  type FspFlowState,
} from '@/server/fsp-id/client';
import { generateSigningKey, IdTokenInvalid, signJwt, verifyIdToken } from '@/server/fsp-id/jwt';
import { fspLinkView, linkFspSubject } from '@/server/fsp-id/link';
import { renderLoginPage } from '@/server/fsp-id/mock/login-page';
import { discovery, exchangeToken, issueCode, jwks, mockTransport, resetMockProvider, userInfo, validateAuthorize } from '@/server/fsp-id/mock/provider';
import { fetchRegistryAchievements, mapAchievement, registryFor } from '@/server/fsp-id/registry';

const APP = 'https://stand.example.test';
const ISSUER = `${APP}/api/fsp-id/realms/fsp`;
const SECRET = 's'.repeat(40);
const [WITH, NONE, DOWN] = FSP_DEMO_PARTICIPANTS as [(typeof FSP_DEMO_PARTICIPANTS)[number], (typeof FSP_DEMO_PARTICIPANTS)[number], (typeof FSP_DEMO_PARTICIPANTS)[number]];

/** Поток до возврата: старт клиента → страница провайдера → выбор участника → параметры callback. */
async function runToCallback(participant = WITH, candidateId = 'cand-1') {
  const t = mockTransport(APP);
  const flow = newFlow(candidateId);
  const authUrl = new URL(await buildAuthorizeUrl(t, flow));
  const r = validateAuthorize(authUrl.searchParams, APP);
  if (!r.ok) throw new Error('authorize rejected');
  const code = issueCode(r.req, participant);
  return { t, flow, authUrl, params: new URLSearchParams({ code, state: flow.state }) };
}

beforeEach(() => {
  resetMockProvider();
  vi.clearAllMocks();
});

describe('мок ФСП ID: discovery и поток Authorization Code + PKCE', () => {
  it('discovery с путями Keycloak, только S256 и RS256', () => {
    const d = discovery(ISSUER);
    expect(d.authorization_endpoint).toBe(`${ISSUER}/protocol/openid-connect/auth`);
    expect(d.token_endpoint).toBe(`${ISSUER}/protocol/openid-connect/token`);
    expect(d.jwks_uri).toBe(`${ISSUER}/protocol/openid-connect/certs`);
    expect(d.code_challenge_methods_supported).toEqual(['S256']);
    expect(d.id_token_signing_alg_values_supported).toEqual(['RS256']);
  });

  it('JWKS — только публичная часть ключа', () => {
    const [k] = jwks().keys;
    expect(k).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
    expect(k).not.toHaveProperty('d');
    expect(k).not.toHaveProperty('p');
  });

  it('authorize URL: S256-челлендж от verifier, state и nonce', async () => {
    const { flow, authUrl } = await runToCallback();
    expect(authUrl.searchParams.get('code_challenge')).toBe(pkceChallenge(flow.verifier));
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('state')).toBe(flow.state);
    expect(authUrl.searchParams.get('nonce')).toBe(flow.nonce);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(`${APP}/api/fsp-id/callback`);
    // Логин спрашиваем всегда: иначе SSO-сессия провайдера молча впускает под прежним участником.
    expect(authUrl.searchParams.get('prompt')).toBe('login');
  });

  it('успешный возврат: подпись, iss, aud, nonce проверены, sub участника', async () => {
    const { t, flow, params } = await runToCallback();
    const { claims, accessToken } = await completeFlow(t, params, flow, 'cand-1');
    expect(accessToken.length).toBeGreaterThan(20);
    expect(claims.sub).toBe(WITH.sub);
    expect(claims.iss).toBe(ISSUER);
    expect(claims.aud).toBe('fsp-career');
    expect(claims.nonce).toBe(flow.nonce);
  });

  it('неверный state → state', async () => {
    const { t, flow, params } = await runToCallback();
    params.set('state', 'x'.repeat(32));
    await expect(completeFlow(t, params, flow, 'cand-1')).rejects.toMatchObject({ code: 'state' });
  });

  it('нет куки потока → state', async () => {
    const { t, params } = await runToCallback();
    await expect(completeFlow(t, params, null, 'cand-1')).rejects.toMatchObject({ code: 'state' });
  });

  it('поток начат другим кандидатом → session', async () => {
    const { t, flow, params } = await runToCallback();
    await expect(completeFlow(t, params, flow, 'cand-2')).rejects.toMatchObject({ code: 'session' });
  });

  it('неверный PKCE verifier → exchange (invalid_grant)', async () => {
    const { t, flow, params } = await runToCallback();
    const bad: FspFlowState = { ...flow, verifier: 'A'.repeat(64) };
    await expect(completeFlow(t, params, bad, 'cand-1')).rejects.toMatchObject({ code: 'exchange', detail: 'invalid_grant' });
  });

  it('код одноразовый: повтор → invalid_grant', async () => {
    const { t, flow, params } = await runToCallback();
    await completeFlow(t, params, flow, 'cand-1');
    await expect(completeFlow(t, params, flow, 'cand-1')).rejects.toMatchObject({ code: 'exchange', detail: 'invalid_grant' });
  });

  it('просроченный ID-токен → token (exp)', async () => {
    const { t, flow, params } = await runToCallback();
    const later = Math.floor(Date.now() / 1000) + 3600;
    await expect(completeFlow(t, params, flow, 'cand-1', { nowSec: later })).rejects.toMatchObject({ code: 'token', detail: 'exp' });
  });

  it('отказ пользователя → denied', async () => {
    const { t, flow } = await runToCallback();
    await expect(completeFlow(t, new URLSearchParams({ error: 'access_denied', state: flow.state }), flow, 'cand-1')).rejects.toBeInstanceOf(FspCallbackFailed);
  });

  it('token endpoint: чужой redirect_uri и client_id отклоняются', async () => {
    const { flow, params } = await runToCallback();
    const form = new URLSearchParams({ grant_type: 'authorization_code', code: params.get('code')!, client_id: 'fsp-career', redirect_uri: 'https://evil.example/cb', code_verifier: flow.verifier });
    expect(exchangeToken(form, ISSUER)).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    const second = await runToCallback();
    const form2 = new URLSearchParams({ grant_type: 'authorization_code', code: second.params.get('code')!, client_id: 'other', redirect_uri: `${APP}/api/fsp-id/callback`, code_verifier: second.flow.verifier });
    expect(exchangeToken(form2, ISSUER)).toMatchObject({ status: 401, body: { error: 'invalid_client' } });
  });

  it('userinfo по access_token; без токена — null', async () => {
    const { flow, params } = await runToCallback(NONE);
    const res = exchangeToken(new URLSearchParams({ grant_type: 'authorization_code', code: params.get('code')!, client_id: 'fsp-career', redirect_uri: `${APP}/api/fsp-id/callback`, code_verifier: flow.verifier }), ISSUER);
    expect(res.status).toBe(200);
    expect(userInfo(`Bearer ${String(res.body.access_token)}`)).toMatchObject({ sub: NONE.sub });
    expect(userInfo(null)).toBeNull();
    expect(userInfo('Bearer ' + 'x'.repeat(40))).toBeNull();
  });
});

describe('мок ФСП ID: проверка запроса авторизации (нет open redirect)', () => {
  const base = async () => {
    const t = mockTransport(APP);
    return new URL(await buildAuthorizeUrl(t, newFlow('c'))).searchParams;
  };

  it('чужой redirect_uri — страница ошибки, без редиректа', async () => {
    const p = await base();
    p.set('redirect_uri', 'https://evil.example/api/fsp-id/callback');
    expect(validateAuthorize(p, APP)).toMatchObject({ ok: false, fatal: true });
    p.set('redirect_uri', `${APP}/api/fsp-id/callback/../../evil`);
    expect(validateAuthorize(p, APP)).toMatchObject({ ok: false, fatal: true });
  });

  it('неизвестный client_id — страница ошибки', async () => {
    const p = await base();
    p.set('client_id', 'evil');
    expect(validateAuthorize(p, APP)).toMatchObject({ ok: false, fatal: true });
  });

  it('plain PKCE, нет nonce или openid — ошибка редиректом на свой redirect_uri', async () => {
    for (const [k, v] of [['code_challenge_method', 'plain'], ['nonce', ''], ['scope', 'profile'], ['response_type', 'token']] as const) {
      const p = await base();
      p.set(k, v);
      expect(validateAuthorize(p, APP)).toMatchObject({ ok: false, fatal: false, redirectUri: `${APP}/api/fsp-id/callback` });
    }
  });

  it('страница входа экранирует параметры', () => {
    const html = renderLoginPage({ clientId: 'fsp-career', redirectUri: `${APP}/api/fsp-id/callback`, state: '"><script>alert(1)</script>', nonce: 'n'.repeat(16), codeChallenge: 'c'.repeat(43) }, '/x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(html).toContain('демо-данные');
  });
});

describe('проверка ID-токена (verifyIdToken)', () => {
  const key = generateSigningKey('k1');
  const set = { keys: [key.publicJwk] };
  const now = 1_800_000_000;
  const good = { iss: ISSUER, sub: 'u1', aud: 'fsp-career', azp: 'fsp-career', exp: now + 300, iat: now, nonce: 'n'.repeat(20) };
  const opts = { issuer: ISSUER, clientId: 'fsp-career', nonce: 'n'.repeat(20), nowSec: now };
  const reason = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof IdTokenInvalid ? e.reason : 'other';
    }
    return 'ok';
  };

  it('валидный токен проходит', () => {
    expect(verifyIdToken(signJwt(good, key), set, opts).sub).toBe('u1');
  });

  it.each([
    ['чужой aud', { aud: 'other-client' }, 'aud'],
    ['чужой iss', { iss: 'https://evil.example/realms/fsp' }, 'iss'],
    ['просрочен', { exp: now - 60 }, 'exp'],
    ['iat из будущего', { iat: now + 3600 }, 'iat'],
    ['чужой nonce', { nonce: 'm'.repeat(20) }, 'nonce'],
    ['несколько aud без azp клиента', { aud: ['fsp-career', 'x'], azp: 'x' }, 'azp'],
  ])('%s → %s', (_n, patch, want) => {
    expect(reason(() => verifyIdToken(signJwt({ ...good, ...patch }, key), set, opts))).toBe(want);
  });

  it('подпись чужим ключом → signature; неизвестный kid → kid', () => {
    const other = generateSigningKey('k1');
    expect(reason(() => verifyIdToken(signJwt(good, other), set, opts))).toBe('signature');
    const k2 = generateSigningKey('k2');
    expect(reason(() => verifyIdToken(signJwt(good, k2), set, opts))).toBe('kid');
  });

  it('подмена payload → signature; alg none → alg; мусор → malformed', () => {
    const [h, , s] = signJwt(good, key).split('.');
    const forged = Buffer.from(JSON.stringify({ ...good, sub: 'admin' })).toString('base64url');
    expect(reason(() => verifyIdToken(`${h}.${forged}.${s}`, set, opts))).toBe('signature');
    const none = Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url');
    expect(reason(() => verifyIdToken(`${none}.${forged}.AAAA`, set, opts))).toBe('alg');
    expect(reason(() => verifyIdToken('a.b', set, opts))).toBe('malformed');
  });
});

describe('кука потока ФСП ID', () => {
  it('подпись проверяется; подмена и срок — null', () => {
    const f = newFlow('cand-1', 1000);
    const token = signFlowState(f, SECRET);
    expect(verifyFlowState(token, SECRET, 1001)).toEqual(f);
    expect(verifyFlowState(token, SECRET, f.exp + 1)).toBeNull();
    expect(verifyFlowState(token, 'o'.repeat(40), 1001)).toBeNull();
    const [p, s] = token.split('.');
    const tampered = Buffer.from(JSON.stringify({ ...f, candidateId: 'cand-2' })).toString('base64url');
    expect(verifyFlowState(`${tampered}.${s}`, SECRET, 1001)).toBeNull();
    expect(verifyFlowState(`${p}.${s}.x`, SECRET, 1001)).toBeNull();
  });
});

describe('демо-реестр и привязка к профилю', () => {
  it('три демо-участника — три состояния; неизвестный sub — без достижений', () => {
    expect(fspRegistryLookup(WITH.sub).state).toBe('linked');
    expect(fspRegistryLookup(WITH.sub).achievements.length).toBeGreaterThan(0);
    expect(fspRegistryLookup(NONE.sub)).toEqual({ state: 'no_achievements', achievements: [] });
    expect(fspRegistryLookup(DOWN.sub)).toEqual({ state: 'unavailable', achievements: [] });
    expect(fspRegistryLookup('unknown')).toEqual({ state: 'no_achievements', achievements: [] });
  });

  it('снимок участника: форматы ФСП, пометка демо, форма достижения прежняя', () => {
    const doc = fspDemoDoc('cand-1', 'linked', { sub: WITH.sub, name: WITH.name });
    expect(doc.origin).toBe(`fsp:${WITH.sub}`);
    expect(doc.meta).toMatchObject({ demo: true, fspState: 'linked', fspSubject: WITH.sub, linkedVia: 'fsp-id-oidc' });
    const items = doc.meta!.achievements as { event: string; year: number; result: string; role: string }[];
    expect(items.map((a) => Object.keys(a).sort())).toEqual(items.map(() => ['event', 'result', 'role', 'year']));
    expect(items.some((a) => /Кубок России по спортивному программированию/.test(a.event))).toBe(true);
    for (const l of doc.lines) expect(l.text).toMatch(/демонстрационные данные/);
  });

  it('linkFspSubject: fspState кандидата и подтверждённый источник fsp:<sub>', async () => {
    const view = await linkFspSubject('cand-1', { fspId: WITH.sub, name: WITH.name }, fspRegistryLookup(WITH.sub));
    expect(view.achievements).toEqual(WITH.achievements);
    expect(view.state).toBe('linked');
    expect(tx.candidate.update).toHaveBeenCalledWith({ where: { id: 'cand-1' }, data: { fspState: 'linked' } });
    expect(tx.source.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { ownershipVerified: false } }));
    expect(tx.source.create).toHaveBeenCalledWith({ data: expect.objectContaining({ candidateId: 'cand-1', kind: 'fsp', origin: `fsp:${WITH.sub}`, ownershipVerified: true }) });
  });

  it('участник «реестр недоступен» → unavailable, без достижений (R-FSP-03: без штрафа)', async () => {
    const view = await linkFspSubject('cand-1', { fspId: DOWN.sub, name: DOWN.name }, fspRegistryLookup(DOWN.sub));
    expect(view).toMatchObject({ state: 'unavailable', achievements: [] });
  });

  it('fspLinkView: без привязки — только состояние, источник не читается', async () => {
    expect(await fspLinkView('cand-1', 'not_linked')).toEqual({ state: 'not_linked', subject: null, name: null, achievements: [] });
    expect(prisma.source.findFirst).not.toHaveBeenCalled();
  });

  it('fspLinkView: привязанный участник — достижения из снимка привязки', async () => {
    vi.mocked(prisma.source.findFirst).mockResolvedValueOnce({ snapshot: { meta: { fspSubject: WITH.sub, fspName: WITH.name, achievements: WITH.achievements } } } as never);
    const v = await fspLinkView('cand-1', 'linked');
    expect(v).toMatchObject({ subject: WITH.sub, name: WITH.name });
    expect(v.achievements).toEqual(WITH.achievements);
  });
});

describe('реестр симулятора ФСП (внешний провайдер)', () => {
  const raw = { event_name: 'Кубок России по спортивному программированию', discipline: 'product', season: 2025, entrant_type: 'team', team_name: 'Альфа', place: 2, status: 'ranked', entrants_total: 40 };

  it('запись реестра → прежняя форма достижения', () => {
    expect(mapAchievement(raw)).toEqual({ event: 'Кубок России по спортивному программированию, дисциплина «продуктовое программирование»', year: 2025, result: '2 место из 40', role: 'участник команды «Альфа»' });
    expect(mapAchievement({ ...raw, status: 'disqualified' }).result).toBe('дисквалификация');
    expect(mapAchievement({ ...raw, entrant_type: 'individual', team_name: null }).role).toBe('личный зачёт');
  });

  it('GET /me/achievements по токену участника; пусто → no_achievements; сбой → unavailable', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [raw, { junk: 1 }], meta: { simulator: true } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const r = await fetchRegistryAchievements('https://sim.example/api/v1', 'tok');
      expect(r.state).toBe('linked');
      expect(r.achievements).toHaveLength(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://sim.example/api/v1/me/achievements?per_page=50');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      expect(await fetchRegistryAchievements('https://sim.example/api/v1', 'tok')).toEqual({ state: 'no_achievements', achievements: [] });
      fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
      expect((await fetchRegistryAchievements('https://sim.example/api/v1', 'tok')).state).toBe('unavailable');
      fetchMock.mockRejectedValueOnce(new Error('net'));
      expect((await fetchRegistryAchievements('https://sim.example/api/v1', 'tok')).state).toBe('unavailable');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('без API реестра — демо-реестр мока по sub', async () => {
    expect(await registryFor(WITH.sub, { apiUrl: null, accessToken: 'tok' })).toEqual(fspRegistryLookup(WITH.sub));
  });

  it('идентификатор участника — claim fsp_id, иначе sub', () => {
    const base = { iss: ISSUER, sub: 'kc-uuid', aud: 'fsp-career', exp: 1, iat: 1 };
    expect(fspIdentity({ ...base, fsp_id: 'FSP-000123', name: 'Иван' })).toMatchObject({ fspId: 'FSP-000123', name: 'Иван' });
    expect(fspIdentity({ ...base, preferred_username: 'ivan' })).toMatchObject({ fspId: 'kc-uuid', name: 'ivan' });
  });
});
