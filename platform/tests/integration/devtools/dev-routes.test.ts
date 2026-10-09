import { POST as deleteAccount } from '@/app/api/dev/delete-account/route';
import { GET as loginAsList, POST as loginAs } from '@/app/api/dev/login-as/route';
import { POST as logout } from '@/app/api/dev/logout/route';
import { POST as newConversation } from '@/app/api/dev/new-conversation/route';
import { POST as newUser } from '@/app/api/dev/new-user/route';
import { POST as resetOnboarding } from '@/app/api/dev/reset-onboarding/route';
import { POST as resetAttempts } from '@/app/api/dev/reset-test-attempts/route';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom } from '../../helpers/requests';

const SECRET = process.env.SESSION_SECRET ?? '';

function req(path: string, method = 'POST', body?: unknown, cookie?: string, host = 'localhost:3016'): Request {
  const headers = new Headers({ 'content-type': 'application/json', host });
  if (cookie) headers.set('cookie', cookie);
  return new Request(`http://${host}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const cookieFor = (userId: string, role: 'candidate' | 'employer' | 'pending', candidateId?: string | null, employerProfileId?: string | null) =>
  `cid=${signUserSession({ userId, role, candidateId, employerProfileId }, SECRET)}`;

async function mkCandidate(tag: string) {
  const candidate = await prisma.candidate.create({ data: { email: `${tag}@example.test`, name: `Кандидат ${tag}`, consentAt: new Date() } });
  const user = await prisma.user.create({ data: { name: `Юзер ${tag}`, role: 'candidate', candidateId: candidate.id, onboardedAt: new Date() } });
  await prisma.consent.create({ data: { userId: user.id, version: 'v1' } });
  await prisma.onboardingState.create({ data: { userId: user.id, answers: { a: 1 } } });
  await prisma.candidateProfile.create({ data: { candidateId: candidate.id, stack: ['Go'], city: 'Казань' } });
  const conv = await prisma.conversation.create({ data: { candidateId: candidate.id } });
  await prisma.message.create({ data: { conversationId: conv.id, role: 'user', content: 'привет' } });
  await prisma.upload.create({ data: { candidateId: candidate.id, filename: 'cv.pdf', mime: 'application/pdf', sha256: `h-${tag}`, size: 1 } });
  await prisma.agentRun.create({ data: { candidateId: candidate.id, purpose: 'consultant', provider: 'stub', model: 'm', latencyMs: 1, ok: true } });
  return { candidate, user, cookie: cookieFor(user.id, 'candidate', candidate.id) };
}

async function mkEmployer(tag: string, companyId?: string) {
  const company = companyId
    ? await prisma.company.findUniqueOrThrow({ where: { id: companyId } })
    : await prisma.company.create({ data: { name: `Компания ${tag}`, isDemo: false } });
  const user = await prisma.user.create({ data: { name: `HR ${tag}`, role: 'employer', onboardedAt: new Date() } });
  const profile = await prisma.employerProfile.create({ data: { userId: user.id, companyId: company.id } });
  const conv = await prisma.employerConversation.create({ data: { employerProfileId: profile.id } });
  await prisma.employerMessage.create({ data: { conversationId: conv.id, role: 'user', content: 'ищу' } });
  return { company, user, profile, cookie: cookieFor(user.id, 'employer', null, profile.id) };
}

describe('api/dev/*', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('delete-account кандидата: убирает всё своё в транзакции и не трогает чужое', async () => {
    const a = await mkCandidate('a');
    const b = await mkCandidate('b');
    const attempt = await prisma.testAttempt.create({
      data: { candidateId: a.candidate.id, specialization: 'backend', grade: 'junior', seed: 1, policyVersion: 'v', expiresAt: new Date(Date.now() + 1e6) },
    });
    const company = await prisma.company.create({ data: { name: 'К' } });
    await prisma.invitation.create({ data: { candidateId: a.candidate.id, companyId: company.id } });

    const res = await deleteAccount(req('/api/dev/delete-account', 'POST', {}, a.cookie));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/cid=;/);

    const gone = { candidateId: a.candidate.id };
    expect(await prisma.candidate.count({ where: { id: a.candidate.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: a.user.id } })).toBe(0);
    expect(await prisma.conversation.count({ where: gone })).toBe(0);
    expect(await prisma.message.count({ where: { conversation: gone } })).toBe(0);
    expect(await prisma.upload.count({ where: gone })).toBe(0);
    expect(await prisma.agentRun.count({ where: gone })).toBe(0);
    expect(await prisma.invitation.count({ where: gone })).toBe(0);
    expect(await prisma.candidateProfile.count({ where: gone })).toBe(0);
    expect(await prisma.testAttempt.count({ where: { id: attempt.id } })).toBe(0);
    expect(await prisma.onboardingState.count({ where: { userId: a.user.id } })).toBe(0);
    expect(await prisma.consent.count({ where: { userId: a.user.id } })).toBe(0);

    // чужое на месте
    expect(await prisma.candidate.count({ where: { id: b.candidate.id } })).toBe(1);
    expect(await prisma.user.count({ where: { id: b.user.id } })).toBe(1);
    expect(await prisma.conversation.count({ where: { candidateId: b.candidate.id } })).toBe(1);
    expect(await prisma.upload.count({ where: { candidateId: b.candidate.id } })).toBe(1);
    expect(await prisma.agentRun.count({ where: { candidateId: b.candidate.id } })).toBe(1);
    expect(await prisma.candidateProfile.count({ where: { candidateId: b.candidate.id } })).toBe(1);
    expect(await prisma.company.count({ where: { id: company.id } })).toBe(1);
  });

  it('delete-account работодателя: вакансии, приглашения, разговоры, компания; соседний работодатель целый', async () => {
    const a = await mkEmployer('a');
    const b = await mkEmployer('b');
    const cand = await mkCandidate('c');
    const vac = await prisma.vacancy.create({
      data: { companyId: a.company.id, title: 'Go', specialization: 'backend', grade: 'junior', salaryFrom: 1, salaryTo: 2, needs: [] },
    });
    await prisma.invitation.create({ data: { candidateId: cand.candidate.id, companyId: a.company.id, vacancyId: vac.id, employerProfileId: a.profile.id } });
    await prisma.invitation.create({ data: { candidateId: cand.candidate.id, companyId: b.company.id, employerProfileId: b.profile.id } });

    expect((await deleteAccount(req('/api/dev/delete-account', 'POST', {}, a.cookie))).status).toBe(200);

    expect(await prisma.user.count({ where: { id: a.user.id } })).toBe(0);
    expect(await prisma.employerProfile.count({ where: { id: a.profile.id } })).toBe(0);
    expect(await prisma.employerConversation.count({ where: { employerProfileId: a.profile.id } })).toBe(0);
    expect(await prisma.employerMessage.count({ where: { conversation: { employerProfileId: a.profile.id } } })).toBe(0);
    expect(await prisma.vacancy.count({ where: { companyId: a.company.id } })).toBe(0);
    expect(await prisma.company.count({ where: { id: a.company.id } })).toBe(0);
    expect(await prisma.invitation.count({ where: { companyId: a.company.id } })).toBe(0);

    expect(await prisma.company.count({ where: { id: b.company.id } })).toBe(1);
    expect(await prisma.employerProfile.count({ where: { id: b.profile.id } })).toBe(1);
    expect(await prisma.invitation.count({ where: { companyId: b.company.id } })).toBe(1);
    expect(await prisma.candidate.count({ where: { id: cand.candidate.id } })).toBe(1);
  });

  it('delete-account: компания с другим представителем остаётся', async () => {
    const a = await mkEmployer('a');
    const b = await mkEmployer('b', a.company.id);
    expect((await deleteAccount(req('/api/dev/delete-account', 'POST', {}, a.cookie))).status).toBe(200);
    expect(await prisma.company.count({ where: { id: a.company.id } })).toBe(1);
    expect(await prisma.employerProfile.count({ where: { id: b.profile.id } })).toBe(1);
  });

  it('без сессии → 401', async () => {
    expect((await deleteAccount(req('/api/dev/delete-account'))).status).toBe(401);
    expect((await newConversation(req('/api/dev/new-conversation'))).status).toBe(401);
  });

  it('new-conversation: у кандидата новый разговор, старые целы; у работодателя - помощника', async () => {
    const a = await mkCandidate('a');
    const res = await newConversation(req('/api/dev/new-conversation', 'POST', {}, a.cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.next).toBe('/consultant');
    expect(await prisma.conversation.count({ where: { candidateId: a.candidate.id } })).toBe(2);
    const last = await prisma.conversation.findFirstOrThrow({ where: { candidateId: a.candidate.id }, orderBy: { updatedAt: 'desc' } });
    expect(last.id).toBe(body.conversationId);
    expect(await prisma.message.count({ where: { conversationId: last.id } })).toBe(0);

    const e = await mkEmployer('e');
    const r2 = await (await newConversation(req('/api/dev/new-conversation', 'POST', {}, e.cookie))).json();
    expect(r2.next).toBe('/employer/assistant');
    expect(await prisma.employerConversation.count({ where: { employerProfileId: e.profile.id } })).toBe(2);

    const pending = await prisma.user.create({ data: { name: 'P' } });
    expect((await newConversation(req('/api/dev/new-conversation', 'POST', {}, cookieFor(pending.id, 'pending')))).status).toBe(409);
  });

  it('reset-onboarding: состояние и onboardedAt; профиль - только с alsoProfile', async () => {
    const a = await mkCandidate('a');
    const b = await mkCandidate('b');
    expect((await resetOnboarding(req('/api/dev/reset-onboarding', 'POST', {}, a.cookie))).status).toBe(200);
    expect(await prisma.onboardingState.count({ where: { userId: a.user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).onboardedAt).toBeNull();
    expect(await prisma.candidateProfile.count({ where: { candidateId: a.candidate.id } })).toBe(1);

    await resetOnboarding(req('/api/dev/reset-onboarding', 'POST', { alsoProfile: true }, a.cookie));
    expect(await prisma.candidateProfile.count({ where: { candidateId: a.candidate.id } })).toBe(0);
    // чужие данные
    expect(await prisma.onboardingState.count({ where: { userId: b.user.id } })).toBe(1);
    expect(await prisma.candidateProfile.count({ where: { candidateId: b.candidate.id } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.user.id } })).onboardedAt).not.toBeNull();
  });

  it('reset-onboarding работодателя с alsoProfile: поля компании и вакансии онбординга', async () => {
    const e = await mkEmployer('e');
    await prisma.company.update({ where: { id: e.company.id }, data: { inn: '123', industry: 'it', contact: 'x', description: 'd' } });
    const mine = await prisma.vacancy.create({ data: { companyId: e.company.id, title: 'M', specialization: 'backend', grade: 'junior', salaryFrom: 1, salaryTo: 2, needs: [] } });
    const other = await prisma.vacancy.create({ data: { companyId: e.company.id, title: 'O', specialization: 'backend', grade: 'middle', salaryFrom: 1, salaryTo: 2, needs: [] } });
    await prisma.onboardingState.create({ data: { userId: e.user.id, meta: { vacancies: { junior: mine.id } } } });
    await resetOnboarding(req('/api/dev/reset-onboarding', 'POST', { alsoProfile: true }, e.cookie));
    const c = await prisma.company.findUniqueOrThrow({ where: { id: e.company.id } });
    expect([c.inn, c.industry, c.contact, c.description]).toEqual([null, null, null, null]);
    expect(await prisma.vacancy.count({ where: { id: mine.id } })).toBe(0);
    expect(await prisma.vacancy.count({ where: { id: other.id } })).toBe(1);
  });

  it('reset-test-attempts: только попытки текущего кандидата', async () => {
    const a = await mkCandidate('a');
    const b = await mkCandidate('b');
    for (const c of [a, b]) {
      await prisma.testAttempt.create({
        data: { candidateId: c.candidate.id, specialization: 'backend', grade: 'junior', seed: 1, policyVersion: 'v', expiresAt: new Date(Date.now() + 1e6) },
      });
    }
    const res = await resetAttempts(req('/api/dev/reset-test-attempts', 'POST', {}, a.cookie));
    expect((await res.json()).deleted).toBe(1);
    expect(await prisma.testAttempt.count({ where: { candidateId: b.candidate.id } })).toBe(1);
    const e = await mkEmployer('e');
    expect((await resetAttempts(req('/api/dev/reset-test-attempts', 'POST', {}, e.cookie))).status).toBe(403);
  });

  it('new-user, login-as, logout', async () => {
    const res = await newUser(req('/api/dev/new-user'));
    expect((await res.json()).next).toBe('/onboarding');
    expect(cookieFrom(res)).toMatch(/^cid=u\./);
    expect(await prisma.user.count({ where: { isDemo: true } })).toBe(1);

    await prisma.candidate.create({ data: { id: 'demo-x', email: 'x@example.test', name: 'Икс', isDemo: true } });
    const list = await (await loginAsList(req('/api/dev/login-as', 'GET'))).json();
    expect(list.candidates.map((c: { id: string }) => c.id)).toEqual(['demo-x']);
    const li = await loginAs(req('/api/dev/login-as', 'POST', { candidateId: 'demo-x' }));
    expect(li.status).toBe(200);
    expect(cookieFrom(li)).toMatch(/^cid=u\./);
    expect((await loginAs(req('/api/dev/login-as', 'POST', { candidateId: 'nope' }))).status).toBe(404);

    const out = await logout(req('/api/dev/logout'));
    expect(out.headers.get('set-cookie')).toMatch(/cid=;/);
  });

  it('чужой Origin → 403 (CSRF), свой Origin проходит', async () => {
    const a = await mkCandidate('a');
    const bad = req('/api/dev/new-conversation', 'POST', {}, a.cookie);
    bad.headers.set('origin', 'http://evil.example');
    expect((await newConversation(bad)).status).toBe(403);
    const ok = req('/api/dev/new-conversation', 'POST', {}, a.cookie);
    ok.headers.set('origin', 'http://localhost:3016');
    expect((await newConversation(ok)).status).toBe(200);
  });
});

describe('api/dev/*: production и чужой хост → 404', () => {
  const handlers = [deleteAccount, loginAs, logout, newConversation, newUser, resetOnboarding, resetAttempts, loginAsList];
  afterEach(() => vi.unstubAllEnvs());

  it('NODE_ENV=production: 404 на всё, ничего не создаётся', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await resetDb();
    for (const h of handlers) expect((await h(req('/api/dev/x', 'POST', { fresh: true }))).status).toBe(404);
    expect(await prisma.user.count()).toBe(0);
  });

  it('Host fsp.example.ru: 404 на всё', async () => {
    await resetDb();
    for (const h of handlers) expect((await h(req('/api/dev/x', 'POST', {}, undefined, 'fsp.example.ru'))).status).toBe(404);
    expect(await prisma.user.count()).toBe(0);
  });

  it('DEVTOOLS=false: 404 даже на localhost', async () => {
    vi.stubEnv('DEVTOOLS', 'false');
    for (const h of handlers) expect((await h(req('/api/dev/x', 'POST', {}))).status).toBe(404);
  });
});
