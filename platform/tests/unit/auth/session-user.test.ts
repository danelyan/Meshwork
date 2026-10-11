import { AppError } from '@/server/errors';
import {
  parseSession,
  requireCandidate,
  requireEmployer,
  requireUser,
  signSession,
  signUserSession,
  verifySession,
} from '@/server/session';

const SECRET = 'x'.repeat(40);
const NOW = 1_800_000_000;
const reqWith = (cookie?: string) => new Request('http://localhost/api/x', { headers: cookie ? { cookie } : {} });

function expectError(fn: () => unknown, status: number) {
  try {
    fn();
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status });
  }
}

describe('session: кука аккаунта (u.…)', () => {
  it('подписывается и разбирается со всеми полями', () => {
    const t = signUserSession({ userId: 'u1', role: 'candidate', candidateId: 'c1' }, SECRET, NOW);
    expect(parseSession(t, SECRET, NOW + 1)).toEqual({ userId: 'u1', role: 'candidate', candidateId: 'c1', employerProfileId: null });
    expect(verifySession(t, SECRET, NOW + 1)).toBe('c1');
  });

  it('подмена роли или профиля ломает подпись', () => {
    const t = signUserSession({ userId: 'u1', role: 'pending' }, SECRET, NOW);
    expect(parseSession(t.replace('.pending.', '.employer.'), SECRET, NOW)).toBeNull();
    const c = signUserSession({ userId: 'u1', role: 'candidate', candidateId: 'c1' }, SECRET, NOW);
    expect(parseSession(c.replace('.c1.', '.c2.'), SECRET, NOW)).toBeNull();
  });

  it('истёкшая, чужой секрет, неизвестная роль – null', () => {
    const t = signUserSession({ userId: 'u1', role: 'employer', employerProfileId: 'e1' }, SECRET, NOW, 60);
    expect(parseSession(t, SECRET, NOW + 60)).toBeNull();
    expect(parseSession(t, 'y'.repeat(40), NOW)).toBeNull();
    expect(() => signUserSession({ userId: 'u1', role: 'admin' as never }, SECRET, NOW)).toThrow();
  });

  it('id профиля не той роли игнорируется', () => {
    const t = signUserSession({ userId: 'u1', role: 'pending', candidateId: 'c1', employerProfileId: 'e1' }, SECRET, NOW);
    expect(parseSession(t, SECRET, NOW)).toMatchObject({ candidateId: null, employerProfileId: null });
  });

  it('старая кука демо-кандидата по-прежнему валидна', () => {
    const t = signSession('demo-a', SECRET, NOW);
    expect(parseSession(t, SECRET, NOW)).toEqual({ userId: null, role: 'candidate', candidateId: 'demo-a', employerProfileId: null });
  });
});

describe('session: guard-ы ролей', () => {
  const cand = `cid=${signUserSession({ userId: 'u1', role: 'candidate', candidateId: 'c1' })}`;
  const emp = `cid=${signUserSession({ userId: 'u2', role: 'employer', employerProfileId: 'e2' })}`;
  const pend = `cid=${signUserSession({ userId: 'u3', role: 'pending' })}`;
  const legacy = `cid=${signSession('demo-a')}`;

  it('requireCandidate: кандидат и старая кука – да; работодатель и pending – 403; нет входа – 401', () => {
    expect(requireCandidate(reqWith(cand))).toBe('c1');
    expect(requireCandidate(reqWith(legacy))).toBe('demo-a');
    expectError(() => requireCandidate(reqWith(emp)), 403);
    expectError(() => requireCandidate(reqWith(pend)), 403);
    expectError(() => requireCandidate(reqWith()), 401);
  });

  it('requireEmployer: только работодатель', () => {
    expect(requireEmployer(reqWith(emp))).toEqual({ userId: 'u2', employerProfileId: 'e2' });
    expectError(() => requireEmployer(reqWith(cand)), 403);
    expectError(() => requireEmployer(reqWith(legacy)), 403);
    expectError(() => requireEmployer(reqWith(pend)), 403);
    expectError(() => requireEmployer(reqWith()), 401);
  });

  it('requireUser: любой аккаунт, включая pending; старая кука без аккаунта – 401', () => {
    expect(requireUser(reqWith(pend)).userId).toBe('u3');
    expect(requireUser(reqWith(emp)).role).toBe('employer');
    expectError(() => requireUser(reqWith(legacy)), 401);
    expectError(() => requireUser(reqWith()), 401);
  });
});
