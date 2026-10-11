import { AppError } from '@/server/errors';

// Маршрут вопросов работодателя кандидату: согласия работодателя (ADR 0005) проверяются до сервиса.
const calls: string[] = [];
let consentsAccepted = true;

vi.mock('@/server/session', () => ({
  requireEmployer: () => ({ userId: 'user1', employerProfileId: 'emp1' }),
  parseSession: () => null,
  readCookie: () => undefined,
  SESSION_COOKIE: 'cid',
}));
vi.mock('@/server/consent/service', () => ({
  assertEmployerConsents: async (userId: string) => {
    calls.push(`consents:${userId}`);
    if (!consentsAccepted) throw new AppError('consent_required', 'Нужны согласия работодателя', 409, { kind: 'employer_offer' });
  },
}));
vi.mock('@/server/employer', () => ({
  loadEmployerContext: async (employerProfileId: string) => {
    calls.push('context');
    return { employerProfileId, userId: 'user1' };
  },
}));
vi.mock('@/server/defense-room', () => ({
  listEmployerQuestions: async () => {
    calls.push('list');
    return [{ id: 'q1' }];
  },
  createEmployerQuestion: async () => {
    calls.push('create');
    return { id: 'q2' };
  },
}));

const { GET, POST } = await import('@/app/api/employer/questions/route');

const CANDIDATE = 'cand_1';
const get = () => GET(new Request(`http://localhost/api/employer/questions?candidateId=${CANDIDATE}`));
const post = () =>
  POST(
    new Request('http://localhost/api/employer/questions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidateId: CANDIDATE, text: 'Расскажите про схему данных проекта' }),
    }),
  );

beforeEach(() => {
  calls.length = 0;
  consentsAccepted = true;
});

describe('/api/employer/questions: согласия работодателя', () => {
  it('без оферты и обязательства GET и POST — 409 consent_required, до сервиса дело не доходит', async () => {
    consentsAccepted = false;
    for (const call of [get, post]) {
      const res = await call();
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatchObject({ code: 'consent_required', details: { kind: 'employer_offer' } });
    }
    expect(calls).toEqual(['consents:user1', 'consents:user1']);
  });

  it('с принятыми согласиями: проверка по userId сессии, затем сервис', async () => {
    const list = await get();
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ questions: [{ id: 'q1' }] });
    const created = await post();
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: 'q2' });
    expect(calls).toEqual(['consents:user1', 'context', 'list', 'consents:user1', 'context', 'create']);
  });
});
