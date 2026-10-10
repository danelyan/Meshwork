import { GET as callback } from '@/app/api/fsp-id/callback/route';
import { GET as link } from '@/app/api/fsp-id/link/route';
import { POST as authChoose } from '@/app/api/fsp-id/realms/fsp/protocol/openid-connect/auth/route';
import { GET, POST } from '@/app/api/onboarding/route';
import { CONSENT_VERSION } from '@/server/auth/consent';
import { FSP_DEMO_PARTICIPANTS } from '@/server/collector/fsp-demo';
import { getEnv } from '@/server/env';
import { FSP_OAUTH_COOKIE } from '@/server/fsp-id/client';
import type { OnboardingView } from '@/server/onboarding/types';
import { parseSession, signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

/** Шаг знакомства «Привяжем ФСП ID?» → вход в ФСП ID (встроенный мок) → возврат в чат со следующим шагом. */

const APP = getEnv().APP_URL;
const pending = (userId: string) => `cid=${signUserSession({ userId, role: 'pending' })}`;
const act = async (cookie: string, body: unknown) => {
  const res = await POST(jsonRequest('/api/onboarding', 'POST', body, cookie));
  return { res, status: res.status, json: (await res.json()) as OnboardingView };
};
const flowCookie = (res: Response) => /^[^=]+=([^;]*)/.exec(res.headers.getSetCookie().find((c) => c.startsWith(`${FSP_OAUTH_COOKIE}=`)) ?? '')?.[1] ?? '';

async function asCandidate(userId: string): Promise<string> {
  const c = pending(userId);
  expect((await act(c, { action: 'answer', stepId: 'consent', value: { version: CONSENT_VERSION } })).status).toBe(200);
  const r = await act(c, { action: 'answer', stepId: 'role', value: 'candidate' });
  return cookieFrom(r.res)!;
}

async function loginFromStep(cookie: string, participant: string) {
  const start = await link(new Request(`${APP}/api/fsp-id/link?return=consultant`, { headers: { cookie } }));
  const authorize = new URL(start.headers.get('location')!);
  const form = new URLSearchParams(authorize.searchParams);
  form.set('participant', participant);
  const chosen = await authChoose(new Request(authorize.origin + authorize.pathname, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
  const back = new URL(chosen.headers.get('location')!);
  return callback(new Request(back, { headers: { cookie: `${cookie}; ${FSP_OAUTH_COOKIE}=${flowCookie(start)}` } }));
}

describe('ФСП ID из шага знакомства', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    await prisma.user.create({ data: { id: 'u1', name: 'Иван Петров', email: 'ivan@example.test' } });
  });

  it('вариант-ссылка не отвечает на шаг через API; вход возвращает в чат, шаг ФСП закрыт настоящей привязкой', async () => {
    const c = await asCandidate('u1');
    const cid = parseSession(c.slice(4), getEnv().SESSION_SECRET)!.candidateId!;
    const at = await act(c, { action: 'goto', stepId: 'fsp' });
    expect(at.json.current.id).toBe('fsp');
    expect(at.json.current.options?.find((o) => o.value === 'linked')?.href).toBe('/api/fsp-id/link?return=consultant');
    expect((await act(c, { action: 'answer', stepId: 'fsp', value: 'linked' })).status).toBe(400);

    const done = await loginFromStep(c, FSP_DEMO_PARTICIPANTS[0]!.sub);
    const target = new URL(done.headers.get('location')!);
    expect(target.pathname).toBe('/consultant');
    expect(target.searchParams.get('fsp')).toBe('linked');

    expect(await prisma.candidate.findUniqueOrThrow({ where: { id: cid } })).toMatchObject({ fspState: 'linked' });
    expect(await prisma.source.count({ where: { candidateId: cid, kind: 'fsp', ownershipVerified: true } })).toBe(1);
    const state = await prisma.onboardingState.findUniqueOrThrow({ where: { userId: 'u1' } });
    expect((state.answers as Record<string, unknown>).fsp).toBe('linked');
    expect(state.stepId).not.toBe('fsp');
    const v = (await (await GET(jsonRequest('/api/onboarding', 'GET', undefined, c))).json()) as OnboardingView;
    expect(v.history.find((h) => h.stepId === 'fsp')?.answer).toBe('ФСП ID привязан');
  });

  it('участник без истории — шаг закрыт состоянием no_achievements', async () => {
    const c = await asCandidate('u1');
    await act(c, { action: 'goto', stepId: 'fsp' });
    await loginFromStep(c, FSP_DEMO_PARTICIPANTS[1]!.sub);
    const state = await prisma.onboardingState.findUniqueOrThrow({ where: { userId: 'u1' } });
    expect((state.answers as Record<string, unknown>).fsp).toBe('no_achievements');
  });
});
