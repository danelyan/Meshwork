import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { candidatePageRedirect } from '@/server/auth/page';
import { resetEnvCache } from '@/server/env';
import { type SessionPrincipal, signSession, signUserSession } from '@/server/session';

// Доступ к страницам группы (candidate) и /employer/* (E-02, граница доверия; R-C-14 — без входа данных не показываем).
const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'cid' && cookie.value ? { name, value: cookie.value } : undefined) }),
}));
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  notFound: () => {
    throw new Redirect('404');
  },
}));
vi.mock('@/server/agent/restore', () => ({ loadLastChat: vi.fn(async () => undefined) }));
vi.mock('@/server/demo/context', () => ({ resolveChatDemoContext: vi.fn(async () => ({ noLlm: false, resume: null })) }));
vi.mock('@/server/employer', () => ({
  listCandidateInvitations: vi.fn(async () => []),
  getPrivacy: vi.fn(async () => ({ hiddenFromEmployers: false })),
}));
vi.mock('@/components/Chat', () => ({ Chat: () => null }));
vi.mock('@/components/ProfilePage', () => ({ ProfilePage: () => null }));
vi.mock('@/components/TestPage', () => ({ TestPage: () => null }));
vi.mock('@/components/DefenseDialog', () => ({ DefenseDialog: () => null }));
vi.mock('@/server/db', () => ({ prisma: {} }));

const SESS = {
  guest: undefined,
  candidate: () => signUserSession({ userId: 'u1', role: 'candidate', candidateId: 'c1' }),
  legacy: () => signSession('c1'),
  employer: () => signUserSession({ userId: 'u2', role: 'employer', employerProfileId: 'e1' }),
  pending: () => signUserSession({ userId: 'u3', role: 'pending' }),
};

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'ok';
  } catch (e) {
    if (e instanceof Redirect) return e.to;
    throw e;
  }
}

const noSearch = { searchParams: Promise.resolve({}) };
const PAGES: Array<[string, string, () => Promise<unknown>]> = [
  ['/consultant', '/consultant', async () => (await import('@/app/(candidate)/consultant/page')).default()],
  ['/profile', '/profile', async () => (await import('@/app/(candidate)/profile/page')).default()],
  ['/test', '/test', async () => (await import('@/app/(candidate)/test/page')).default(noSearch)],
  [
    '/test?specialization=backend&grade=middle',
    '/test?specialization=backend&grade=middle',
    async () =>
      (await import('@/app/(candidate)/test/page')).default({ searchParams: Promise.resolve({ specialization: 'backend', grade: 'middle' }) }),
  ],
  ['/defense/cl1', '/defense/cl1', async () => (await import('@/app/(candidate)/defense/[claimId]/page')).default({ params: Promise.resolve({ claimId: 'cl1' }) })],
  ['/invitations', '/invitations', async () => (await import('@/app/(candidate)/invitations/page')).default()],
];

afterEach(() => {
  cookie.value = undefined;
  cleanup();
});

describe('candidatePageRedirect', () => {
  const p = (x: Partial<SessionPrincipal>): SessionPrincipal => ({ userId: 'u', role: 'candidate', candidateId: null, employerProfileId: null, ...x });
  it('матрица ролей', () => {
    expect(candidatePageRedirect(null, '/test?a=1&b=2')).toBe('/auth?next=%2Ftest%3Fa%3D1%26b%3D2');
    expect(candidatePageRedirect(p({ candidateId: 'c' }), '/x')).toBeNull();
    expect(candidatePageRedirect(p({ userId: null, candidateId: 'c' }), '/x')).toBeNull();
    expect(candidatePageRedirect(p({ role: 'employer', employerProfileId: 'e' }), '/x')).toBe('/employer');
    expect(candidatePageRedirect(p({ role: 'pending' }), '/x')).toBe('/onboarding');
  });
});

describe.each(PAGES)('страница %s', (_name, next, run) => {
  it('гость → /auth?next=<путь>', async () => {
    expect(await outcome(run)).toBe(`/auth?next=${encodeURIComponent(next)}`);
  });
  it('кандидат → рендер', async () => {
    cookie.value = SESS.candidate();
    expect(await outcome(run)).toBe('ok');
  });
  it('старая кука демо-кандидата → рендер (как requireCandidate в API)', async () => {
    cookie.value = SESS.legacy();
    expect(await outcome(run)).toBe('ok');
  });
  it('работодатель → /employer', async () => {
    cookie.value = SESS.employer();
    expect(await outcome(run)).toBe('/employer');
  });
  it('роль не выбрана → /onboarding', async () => {
    cookie.value = SESS.pending();
    expect(await outcome(run)).toBe('/onboarding');
  });
  it('поддельная кука = гость', async () => {
    cookie.value = `${SESS.candidate().slice(0, -2)}xx`;
    expect(await outcome(run)).toBe(`/auth?next=${encodeURIComponent(next)}`);
  });
});

describe('requirePageEmployer (кабинет работодателя)', () => {
  const run = async () => (await import('@/server/auth/page')).requirePageEmployer('/employer/search');
  it('гость → /auth?next, кандидат → /consultant, pending → /onboarding, работодатель → пускает', async () => {
    expect(await outcome(run)).toBe('/auth?next=%2Femployer%2Fsearch');
    cookie.value = SESS.candidate();
    expect(await outcome(run)).toBe('/consultant');
    cookie.value = SESS.legacy();
    expect(await outcome(run)).toBe('/consultant');
    cookie.value = SESS.pending();
    expect(await outcome(run)).toBe('/onboarding');
    cookie.value = SESS.employer();
    expect(await outcome(run)).toBe('ok');
  });
});

describe('open redirect: /auth и /demo игнорируют чужой next', () => {
  const EVIL = ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/api/auth/logout'];
  let prev: string | undefined;
  beforeAll(() => {
    prev = process.env.DEMO_LOGIN;
    process.env.DEMO_LOGIN = 'true';
    resetEnvCache();
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.DEMO_LOGIN;
    else process.env.DEMO_LOGIN = prev;
    resetEnvCache();
  });
  const demoProps = async (next: string) => {
    const DemoPage = (await import('@/app/demo/page')).default;
    const el = (await DemoPage({ searchParams: Promise.resolve({ next }) })) as ReactElement<{ children: ReactElement<{ next: string | null }> }>;
    return el.props.children.props.next;
  };

  it.each(EVIL)('/auth?next=%s → демо-ссылка без next', async (raw) => {
    const AuthPage = (await import('@/app/auth/page')).default;
    render((await AuthPage({ searchParams: Promise.resolve({ next: raw }) })) as ReactElement);
    expect(screen.getByRole('link', { name: 'Демо для жюри' }).getAttribute('href')).toBe('/demo');
  });

  it.each(EVIL)('/demo?next=%s → next = null', async (raw) => {
    expect(await demoProps(raw)).toBeNull();
  });

  it('свой путь проходит: /auth → /demo?next=…, /demo → DemoScreen next', async () => {
    const AuthPage = (await import('@/app/auth/page')).default;
    render((await AuthPage({ searchParams: Promise.resolve({ next: '/profile' }) })) as ReactElement);
    expect(screen.getByRole('link', { name: 'Демо для жюри' }).getAttribute('href')).toBe('/demo?next=%2Fprofile');
    expect(await demoProps('/test?grade=middle')).toBe('/test?grade=middle');
  });
});
