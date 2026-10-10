import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  candidate: { update: vi.fn() },
  source: { updateMany: vi.fn(), findFirst: vi.fn(async () => null), update: vi.fn(), create: vi.fn() },
};
vi.mock('@/server/db', () => ({
  prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) },
}));

import { GET as callback } from '@/app/api/fsp-id/callback/route';
import { GET as link } from '@/app/api/fsp-id/link/route';
import { GET as authPage, POST as authChoose } from '@/app/api/fsp-id/realms/fsp/protocol/openid-connect/auth/route';
import { FSP_DEMO_PARTICIPANTS } from '@/server/collector/fsp-demo';
import { getEnv } from '@/server/env';
import { FSP_OAUTH_COOKIE } from '@/server/fsp-id/client';
import { resetMockProvider } from '@/server/fsp-id/mock/provider';
import { SESSION_COOKIE, signSession } from '@/server/session';

/**
 * Сквозной поток через настоящие route handlers с встроенным моком (внешний провайдер в env не задан):
 * кнопка → страница входа мока → выбор участника → callback → привязка и /settings?fsp=<итог>.
 */

const APP = getEnv().APP_URL;
const session = (id: string) => `${SESSION_COOKIE}=${signSession(id, getEnv().SESSION_SECRET)}`;
const cookieValue = (res: Response, name: string) => /^[^=]+=([^;]*)/.exec(res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? '')?.[1] ?? '';

async function runFlow(participantSub: string | null, opts: { startedBy?: string; returnedAs?: string } = {}) {
  const startedBy = opts.startedBy ?? 'cand-1';
  const start = await link(new Request(`${APP}/api/fsp-id/link`, { headers: { cookie: session(startedBy) } }));
  expect(start.status).toBe(303);
  const authorize = new URL(start.headers.get('location')!);
  const flowCookie = cookieValue(start, FSP_OAUTH_COOKIE);

  const page = await authPage(new Request(authorize));
  expect(page.status).toBe(200);
  const html = await page.text();

  const form = new URLSearchParams(authorize.searchParams);
  if (participantSub) form.set('participant', participantSub);
  else form.set('cancel', '1');
  const chosen = await authChoose(new Request(authorize.origin + authorize.pathname, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(APP).origin } }));
  expect(chosen.status).toBe(303);
  const back = new URL(chosen.headers.get('location')!);

  const done = await callback(new Request(back, { headers: { cookie: `${session(opts.returnedAs ?? startedBy)}; ${FSP_OAUTH_COOKIE}=${flowCookie}` } }));
  return { authorize, html, back, done, result: new URL(done.headers.get('location')!).searchParams.get('fsp') };
}

beforeEach(() => {
  resetMockProvider();
  vi.clearAllMocks();
});

describe('ФСП ID через маршруты (встроенный мок)', () => {
  it('старт: редирект на страницу входа мока с PKCE, кука потока httpOnly', async () => {
    const res = await link(new Request(`${APP}/api/fsp-id/link`, { headers: { cookie: session('cand-1') } }));
    const u = new URL(res.headers.get('location')!);
    expect(u.pathname).toBe('/api/fsp-id/realms/fsp/protocol/openid-connect/auth');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe(`${new URL('/api/fsp-id/callback', APP)}`);
    expect(res.headers.getSetCookie().find((c) => c.startsWith(`${FSP_OAUTH_COOKIE}=`))).toMatch(/HttpOnly/i);
  });

  it('без сессии — на вход', async () => {
    const res = await link(new Request(`${APP}/api/fsp-id/link`));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/auth');
  });

  it.each([
    [0, 'linked'],
    [1, 'no_achievements'],
    [2, 'unavailable'],
  ] as const)('демо-участник %i → /settings?fsp=%s и привязка в профиле', async (i, want) => {
    const p = FSP_DEMO_PARTICIPANTS[i]!;
    const { html, back, result } = await runFlow(p.sub);
    expect(html).toContain(p.name);
    expect(back.pathname).toBe('/api/fsp-id/callback');
    expect(back.searchParams.get('code')).toBeTruthy();
    expect(result).toBe(want);
    expect(tx.candidate.update).toHaveBeenCalledWith({ where: { id: 'cand-1' }, data: { fspState: want } });
    expect(tx.source.create).toHaveBeenCalledWith({ data: expect.objectContaining({ origin: `fsp:${p.sub}`, ownershipVerified: true }) });
  });

  it('«Отмена» на странице входа → error_denied, профиль не меняется', async () => {
    const { result } = await runFlow(null);
    expect(result).toBe('error_denied');
    expect(tx.candidate.update).not.toHaveBeenCalled();
  });

  it('возврат в чужую сессию → error_session', async () => {
    const { result } = await runFlow(FSP_DEMO_PARTICIPANTS[0]!.sub, { returnedAs: 'cand-2' });
    expect(result).toBe('error_session');
    expect(tx.candidate.update).not.toHaveBeenCalled();
  });

  it('POST формы входа с чужого сайта — 403', async () => {
    const res = await authChoose(new Request(`${APP}/api/fsp-id/realms/fsp/protocol/openid-connect/auth`, { method: 'POST', body: 'participant=x', headers: { origin: 'https://evil.example' } }));
    expect(res.status).toBe(403);
  });
});
