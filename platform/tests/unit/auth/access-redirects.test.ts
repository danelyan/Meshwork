import { apiLevelFor, foreignPageRedirect, homePathFor, matchRoute, pageLevelFor, PAGE_ACCESS } from '@/server/auth/access';
import { candidateFrom, employerFrom, type SessionPrincipal } from '@/server/session';

// Таблица «сессия × страница → куда» (E-05, фаза 1; решения владельца 10.10). Ожидания выписаны руками,
// а не выведены из таблицы доступа: тест ловит ошибку и в самой таблице. Решает активная роль: учётка
// с обоими профилями (будущее переключение ролей) пускается только туда, где активна её роль.

const P = (x: Partial<SessionPrincipal>): SessionPrincipal => ({ userId: 'u1', role: 'candidate', candidateId: null, employerProfileId: null, ...x });

type Who = 'guest' | 'stale' | 'pending' | 'candidate' | 'employer' | 'legacy' | 'bothAsCandidate' | 'bothAsEmployer' | 'employerNoProfile' | 'candidateNoProfile';

const SESSIONS: Record<Who, { s: SessionPrincipal | null; stale?: boolean }> = {
  guest: { s: null },
  // Подпись верна, аккаунта в БД нет: гард страницы получает session = null и stale = true.
  stale: { s: null, stale: true },
  pending: { s: P({ role: 'pending' }) },
  candidate: { s: P({ candidateId: 'c1' }) },
  employer: { s: P({ userId: 'u2', role: 'employer', employerProfileId: 'e1' }) },
  // Старая кука демо-кандидата: без аккаунта, роль candidate.
  legacy: { s: P({ userId: null, candidateId: 'c1' }) },
  bothAsCandidate: { s: P({ role: 'candidate', candidateId: 'c1', employerProfileId: 'e1' }) },
  bothAsEmployer: { s: P({ role: 'employer', candidateId: 'c1', employerProfileId: 'e1' }) },
  employerNoProfile: { s: P({ role: 'employer' }) },
  candidateNoProfile: { s: P({ role: 'candidate' }) },
};

const auth = (path: string) => `/auth?next=${encodeURIComponent(path)}`;
const stale = (path: string) => `/api/auth/stale?next=${encodeURIComponent(path)}`;
const C = '/consultant';
const CO = '/employer/company';

/** Ожидание для класса страниц: null — пускать. */
type Row = Record<Exclude<Who, 'guest' | 'stale'>, string | null>;
const PUBLIC: Row = { pending: null, candidate: null, employer: null, legacy: null, bothAsCandidate: null, bothAsEmployer: null, employerNoProfile: null, candidateNoProfile: null };
const ACCOUNT: Row = PUBLIC;
const CANDIDATE: Row = { pending: C, candidate: null, employer: CO, legacy: null, bothAsCandidate: null, bothAsEmployer: CO, employerNoProfile: CO, candidateNoProfile: C };
const EMPLOYER: Row = { pending: C, candidate: C, employer: null, legacy: C, bothAsCandidate: C, bothAsEmployer: null, employerNoProfile: C, candidateNoProfile: C };
const UNKNOWN: Row = { pending: C, candidate: C, employer: C, legacy: C, bothAsCandidate: C, bothAsEmployer: C, employerNoProfile: C, candidateNoProfile: C };

const PATHS: Array<[string, Row, 'public' | 'closed']> = [
  ['/', PUBLIC, 'public'],
  ['/auth?next=%2Fprofile', PUBLIC, 'public'],
  ['/consent', PUBLIC, 'public'],
  ['/site-access', PUBLIC, 'public'],
  ['/api-docs', PUBLIC, 'public'],
  ['/demo', PUBLIC, 'public'],
  ['/onboarding', PUBLIC, 'public'],
  ['/employer/assistant', PUBLIC, 'public'],
  ['/design/fonts?display=mono', PUBLIC, 'public'],
  ['/consultant', ACCOUNT, 'closed'],
  ['/profile', CANDIDATE, 'closed'],
  ['/test?specialization=backend&grade=middle', CANDIDATE, 'closed'],
  ['/invitations', CANDIDATE, 'closed'],
  ['/defense/cl1', CANDIDATE, 'closed'],
  ['/design/consultant-a', CANDIDATE, 'closed'],
  ['/employer', EMPLOYER, 'closed'],
  ['/employer/company', EMPLOYER, 'closed'],
  ['/employer/search?q=go', EMPLOYER, 'closed'],
  ['/employer/invitations', EMPLOYER, 'closed'],
  ['/employer/needs/new', EMPLOYER, 'closed'],
  ['/employer/needs/n1', EMPLOYER, 'closed'],
  ['/employer/needs/n1/edit', EMPLOYER, 'closed'],
  // Нет записи — закрыто для всех (deny by default).
  ['/no-such-page', UNKNOWN, 'closed'],
  ['/employer/needs/n1/delete', UNKNOWN, 'closed'],
];

describe.each(PATHS)('foreignPageRedirect: %s', (path, row, kind) => {
  it('гость и протухшая кука', () => {
    expect(foreignPageRedirect(null, path)).toBe(kind === 'public' ? null : auth(path));
    expect(foreignPageRedirect(SESSIONS.stale.s, path, { stale: true })).toBe(kind === 'public' ? null : stale(path));
  });
  it.each(Object.keys(row) as Array<keyof Row>)('%s', (who) => {
    expect(foreignPageRedirect(SESSIONS[who].s, path)).toBe(row[who]);
  });
});

describe('таблица и сопоставление путей', () => {
  it('статичный сегмент точнее динамического: /employer/needs/new — не [id]', () => {
    expect(matchRoute(PAGE_ACCESS, '/employer/needs/new')).toBe('/employer/needs/new');
    expect(matchRoute(PAGE_ACCESS, '/employer/needs/new-1')).toBe('/employer/needs/[id]');
  });
  it('query и hash не влияют; лишний сегмент — нет записи', () => {
    expect(pageLevelFor('/test?grade=middle#q')).toBe('candidate');
    expect(pageLevelFor('/profile/extra')).toBeNull();
  });
  it('API по методу: GET /api/stt публичный, POST — с входом; неизвестный метод закрыт', () => {
    expect(apiLevelFor('/api/stt', 'GET')).toBe('public');
    expect(apiLevelFor('/api/stt', 'POST')).toBe('session');
    expect(apiLevelFor('/api/stt', 'DELETE')).toBeNull();
    expect(apiLevelFor('/api/auth/consent', 'POST')).toBe('account');
    expect(apiLevelFor('/api/test/attempt/a1/answer', 'POST')).toBe('candidate');
    expect(apiLevelFor('/api/employer/vacancies/v1/matches', 'GET')).toBe('employer');
    expect(apiLevelFor('/api/nope', 'GET')).toBeNull();
  });
  it('дом роли — /consultant для всех ролей (решение владельца 10.10)', () => {
    expect(homePathFor('pending')).toBe('/consultant');
    expect(homePathFor('candidate')).toBe('/consultant');
    expect(homePathFor('employer')).toBe('/consultant');
  });
});

describe('API-гварды по активной роли (candidateFrom / employerFrom)', () => {
  const status = (fn: () => unknown) => {
    try {
      fn();
      return 200;
    } catch (e) {
      return (e as { status: number }).status;
    }
  };
  const ROWS: Array<[Who, number, number]> = [
    ['guest', 401, 401],
    ['pending', 403, 403],
    ['candidate', 200, 403],
    ['legacy', 200, 403],
    ['employer', 403, 200],
    ['bothAsCandidate', 200, 403],
    ['bothAsEmployer', 403, 200],
    ['employerNoProfile', 403, 403],
    ['candidateNoProfile', 403, 403],
  ];
  it.each(ROWS)('%s → кандидат %i, работодатель %i', (who, cand, emp) => {
    const s = SESSIONS[who].s;
    expect(status(() => candidateFrom(s))).toBe(cand);
    expect(status(() => employerFrom(s))).toBe(emp);
  });
  it('учётка с обоими профилями отдаёт id только активной роли', () => {
    expect(candidateFrom(SESSIONS.bothAsCandidate.s)).toBe('c1');
    expect(employerFrom(SESSIONS.bothAsEmployer.s)).toEqual({ userId: 'u1', employerProfileId: 'e1' });
  });
});
