import { cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';

import { resetEnvCache } from '@/server/env';
import { signSession, signUserSession } from '@/server/session';

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
  getCandidateContact: vi.fn(async () => ({ contact: null })),
}));
vi.mock('@/components/Chat', () => ({ Chat: () => null }));
vi.mock('@/components/ProfilePage', () => ({ ProfilePage: () => null }));
vi.mock('@/components/TestPage', () => ({ TestPage: () => null }));
vi.mock('@/components/DefenseDialog', () => ({ DefenseDialog: () => null }));
vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/auth/stale', () => ({ sessionExists: vi.fn(async () => true), isSessionStale: vi.fn(async () => false) }));

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

// Чистая матрица редиректов (foreignPageRedirect) — tests/unit/auth/access-redirects.test.ts; здесь — сами страницы.

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
  it('работодатель → профиль компании /employer/company (решение владельца 10.10)', async () => {
    cookie.value = SESS.employer();
    expect(await outcome(run)).toBe('/employer/company');
  });
  it('роль не выбрана → /consultant (знакомство идёт в его ленте)', async () => {
    cookie.value = SESS.pending();
    expect(await outcome(run)).toBe('/consultant');
  });
  it('поддельная кука = гость', async () => {
    cookie.value = `${SESS.candidate().slice(0, -2)}xx`;
    expect(await outcome(run)).toBe(`/auth?next=${encodeURIComponent(next)}`);
  });
});

describe('/onboarding — только редирект на /consultant (один адрес с чатом, решение владельца 10.10)', () => {
  const run = async () => (await import('@/app/onboarding/page')).default();
  it.each(['guest', 'candidate', 'employer', 'pending'] as const)('%s → /consultant', async (who) => {
    cookie.value = who === 'guest' ? undefined : SESS[who]();
    expect(await outcome(async () => run())).toBe('/consultant');
  });
});

describe('/consultant: общий адрес — гость на вход, роли решает страница (tests/unit/app/consultant-feed.test.tsx)', () => {
  const run = async () => (await import('@/app/(candidate)/consultant/page')).default();
  it('гость → /auth?next=/consultant; поддельная кука = гость', async () => {
    expect(await outcome(run)).toBe('/auth?next=%2Fconsultant');
    cookie.value = `${SESS.candidate().slice(0, -2)}xx`;
    expect(await outcome(run)).toBe('/auth?next=%2Fconsultant');
  });
  it('работодатель → рендер (дом работодателя — лента с помощником по подбору)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    cookie.value = SESS.employer();
    expect(await outcome(run)).toBe('ok');
    warn.mockRestore();
  });
});

// Матрица «роль × страница работодателя → куда» (решение владельца 10.10, зеркало страниц кандидата).
const EMPLOYER_PAGES: Array<[string, () => Promise<unknown>]> = [
  ['/employer', async () => (await import('@/app/employer/page')).default()],
  ['/employer/search', async () => (await import('@/app/employer/search/page')).default({ searchParams: Promise.resolve({}) })],
  ['/employer/invitations', async () => (await import('@/app/employer/invitations/page')).default()],
  ['/employer/needs/new', async () => (await import('@/app/employer/needs/new/page')).default({ searchParams: Promise.resolve({}) })],
  ['/employer/needs/n1', async () => (await import('@/app/employer/needs/[id]/page')).default({ params: Promise.resolve({ id: 'n1' }), searchParams: Promise.resolve({}) })],
  ['/employer/needs/n1/edit', async () => (await import('@/app/employer/needs/[id]/edit/page')).default({ params: Promise.resolve({ id: 'n1' }) })],
];

describe.each(EMPLOYER_PAGES)('страница работодателя %s', (name, run) => {
  it('гость → /auth?next=<путь>', async () => {
    expect(await outcome(run)).toBe(`/auth?next=${encodeURIComponent(name)}`);
  });
  it('кандидат (в т.ч. старая кука демо) → /consultant', async () => {
    cookie.value = SESS.candidate();
    expect(await outcome(run)).toBe('/consultant');
    cookie.value = SESS.legacy();
    expect(await outcome(run)).toBe('/consultant');
  });
  it('роль не выбрана → /consultant', async () => {
    cookie.value = SESS.pending();
    expect(await outcome(run)).toBe('/consultant');
  });
});

describe('/employer/assistant — прежний адрес, любой вход → /consultant', () => {
  it.each(['guest', 'candidate', 'employer', 'pending'] as const)('%s', async (who) => {
    cookie.value = who === 'guest' ? undefined : SESS[who]();
    expect(await outcome(async () => (await import('@/app/employer/assistant/page')).default())).toBe('/consultant');
  });
});

describe('requirePageEmployer (кабинет работодателя)', () => {
  const run = async () => (await import('@/server/auth/page')).requirePageEmployer('/employer/search');
  it('гость → /auth?next, кандидат → /consultant, pending → /consultant, работодатель → пускает', async () => {
    expect(await outcome(run)).toBe('/auth?next=%2Femployer%2Fsearch');
    cookie.value = SESS.candidate();
    expect(await outcome(run)).toBe('/consultant');
    cookie.value = SESS.legacy();
    expect(await outcome(run)).toBe('/consultant');
    cookie.value = SESS.pending();
    expect(await outcome(run)).toBe('/consultant');
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

  it.each(EVIL)('/auth?next=%s → окно входа без next', async (raw) => {
    const AuthPage = (await import('@/app/auth/page')).default;
    const page = (await AuthPage({searchParams:Promise.resolve({next:raw})})) as ReactElement<{next:string|null;initiallyOpen:boolean}>;
    expect(page.props.next).toBeNull();
    expect(page.props.initiallyOpen).toBe(true);
  });

  it.each(EVIL)('/demo?next=%s → next = null', async (raw) => {
    expect(await demoProps(raw)).toBeNull();
  });

  it('свой путь проходит: /auth → окно с next, /demo → DemoScreen next', async () => {
    const AuthPage = (await import('@/app/auth/page')).default;
    const page = (await AuthPage({searchParams:Promise.resolve({next:'/profile'})})) as ReactElement<{next:string|null}>;
    expect(page.props.next).toBe('/profile');
    expect(await demoProps('/test?grade=middle')).toBe('/test?grade=middle');
  });
});
