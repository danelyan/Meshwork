import { POST as complete } from '@/app/api/auth/onboarding/complete/route';
import { GET, POST } from '@/app/api/onboarding/route';
import { CONSENT_VERSION } from '@/server/auth/consent';
import type { OnboardingView } from '@/server/onboarding/types';
import { parseSession, signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

const pending = (userId: string) => `cid=${signUserSession({ userId, role: 'pending' })}`;

async function view(cookie: string): Promise<OnboardingView> {
  const res = await GET(jsonRequest('/api/onboarding', 'GET', undefined, cookie));
  expect(res.status).toBe(200);
  return res.json();
}

async function act(cookie: string, body: unknown) {
  const res = await POST(jsonRequest('/api/onboarding', 'POST', body, cookie));
  return { res, status: res.status, json: (await res.json()) as OnboardingView & { error?: { code: string; message: string }; next?: string } };
}

/** Согласие + роль кандидата → кука кандидата. */
async function asCandidate(userId: string): Promise<string> {
  let c = pending(userId);
  expect((await act(c, { action: 'answer', stepId: 'consent', value: { version: CONSENT_VERSION } })).status).toBe(200);
  const r = await act(c, { action: 'answer', stepId: 'role', value: 'candidate' });
  expect(r.status).toBe(200);
  c = cookieFrom(r.res)!;
  expect(c).toBeDefined();
  // ADR 0005: шаг согласий кандидата (Г3/Г4/Г6/Г7) сразу после роли; без галочек — можно дальше.
  expect((await act(c, { action: 'answer', stepId: 'candidateConsents', value: [] })).status).toBe(200);
  return c;
}

describe('API онбординга', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    await prisma.user.create({ data: { id: 'u1', name: 'Иван Петров', email: 'ivan@example.test' } });
  });

  it('без входа — 401; первый шаг — согласие с приветствием по имени; состояние создаётся', async () => {
    expect((await GET(jsonRequest('/api/onboarding', 'GET'))).status).toBe(401);
    const v = await view(pending('u1'));
    expect(v.current).toMatchObject({ id: 'consent', kind: 'consent', required: true });
    expect(v.current.lead).toMatch(/Иван/);
    expect(v.progress.done).toBe(0);
    expect(await prisma.onboardingState.findUnique({ where: { userId: 'u1' } })).toMatchObject({ stepId: 'consent' });
  });

  it('согласие и роль нельзя пропустить; согласие пишется с версией; роль кандидата перевыпускает куку', async () => {
    const c = pending('u1');
    expect((await act(c, { action: 'skip', stepId: 'consent' })).status).toBe(409);
    expect((await act(c, { action: 'answer', stepId: 'consent', value: { version: 'old' } })).status).toBe(409);
    await view(c); // чат открыт: шаг согласия показан (реплика запомнена)
    const ok = await act(c, { action: 'answer', stepId: 'consent', value: { version: CONSENT_VERSION } });
    expect(ok.json.current.id).toBe('role');
    // Приветствие уже было в шаге согласия: роль не здоровается второй раз.
    expect(ok.json.current.lead).not.toMatch(/^Привет/);
    expect(await prisma.consent.count({ where: { userId: 'u1', version: CONSENT_VERSION } })).toBe(1);
    expect((await act(c, { action: 'skip', stepId: 'role' })).status).toBe(409);
    const r = await act(c, { action: 'answer', stepId: 'role', value: 'candidate' });
    const s = parseSession(cookieFrom(r.res)!.slice(4))!;
    expect(s).toMatchObject({ role: 'candidate' });
    const cand = await prisma.candidate.findUniqueOrThrow({ where: { id: s.candidateId! } });
    expect(cand.consentAt).toBeInstanceOf(Date);
    expect(r.json.current.id).toBe('candidateConsents');
    expect(r.json.scenario).toBe('candidate');
  });

  it('ответы кандидата сразу пишутся в Candidate и CandidateProfile', async () => {
    const c = await asCandidate('u1');
    const cid = parseSession(c.slice(4))!.candidateId!;
    await act(c, { action: 'answer', stepId: 'goal', value: 'grade_confirm' });
    await act(c, { action: 'skip', stepId: 'documents' });
    await act(c, { action: 'answer', stepId: 'fsp', value: 'not_linked' });
    await act(c, { action: 'answer', stepId: 'specialization', value: 'frontend' });
    // lane directions: необязательная подкатегория своего направления (R-T-05)
    expect((await view(c)).current.id).toBe('subcategory');
    expect((await act(c, { action: 'answer', stepId: 'subcategory', value: 'ai.llm-apps' })).status).toBe(400);
    await act(c, { action: 'answer', stepId: 'subcategory', value: 'frontend.ui-app' });
    expect((await view(c)).current.id).toBe('experience');
    await act(c, { action: 'answer', stepId: 'experience', value: 'oneToThree' });
    await act(c, { action: 'answer', stepId: 'experienceSummary', value: 'Разработал интерфейс учебного проекта, отвечал за доступность.' });
    await act(c, { action: 'answer', stepId: 'candidateIndustries', value: ['Образование'] });
    expect((await prisma.onboardingState.findUniqueOrThrow({ where: { userId: 'u1' } })).answers).toMatchObject({ experience: 'oneToThree', experienceSummary: 'Разработал интерфейс учебного проекта, отвечал за доступность.', candidateIndustries: ['Образование'] });
    expect(await prisma.claim.count({ where: { candidateId: cid } })).toBe(0);
    expect(await prisma.candidateCategory.count({ where: { candidateId: cid } })).toBe(0);
    const g = await view(c);
    expect(g.current.id).toBe('grade');
    expect(g.current.hint).toMatch(/Подтверди утверждения/);
    await act(c, { action: 'answer', stepId: 'grade', value: 'middle' });
    const st = await act(c, { action: 'answer', stepId: 'stack', value: ['react', 'TypeScript', 'Svelte'] });
    expect(st.json.current.id).toBe('formats');
    await act(c, { action: 'answer', stepId: 'formats', value: ['hybrid'] });
    expect((await view(c)).current.id).toBe('city');
    await act(c, { action: 'answer', stepId: 'city', value: 'Казань' });
    await act(c, { action: 'answer', stepId: 'salary', value: { from: 150, to: 220 } });
    expect((await view(c)).current.id).toBe('candidateContact');
    expect((await act(c, { action: 'answer', stepId: 'candidateContact', value: 'напишите мне' })).status).toBe(400);
    await act(c, { action: 'answer', stepId: 'candidateContact', value: 'https://t.me/ivan_dev' });
    const last = await act(c, { action: 'answer', stepId: 'fspParticipation', value: 'participant' });
    expect(last.json.current.kind).toBe('summary');
    expect(last.json.summary!.skipped).toEqual([{ stepId: 'documents', label: 'Документы' }]);

    expect(await prisma.candidate.findUniqueOrThrow({ where: { id: cid } })).toMatchObject({ specialization: 'frontend', subcategoryId: 'frontend.ui-app', fspState: 'not_linked', contact: '@ivan_dev' });
    expect(await prisma.candidateProfile.findUniqueOrThrow({ where: { candidateId: cid } })).toMatchObject({
      goal: 'grade_confirm',
      claimedGrade: 'middle',
      stack: ['React', 'TypeScript', 'Svelte'],
      workFormats: ['hybrid'],
      city: 'Казань',
      salaryMin: 150_000,
      salaryExpected: 220_000,
      fspParticipation: 'participant',
    });
  });

  it('недоступное направление и мусор — 400; шаг вне сценария — 409', async () => {
    const c = await asCandidate('u1');
    const r = await act(c, { action: 'answer', stepId: 'specialization', value: 'mobile' });
    expect(r.status).toBe(400);
    expect(r.json.error?.message).toMatch(/недоступен/);
    expect((await act(c, { action: 'answer', stepId: 'salary', value: { from: 500, to: 100 } })).status).toBe(400);
    expect((await act(c, { action: 'answer', stepId: 'needSalary', value: { from: 1, to: 2 } })).status).toBe(409);
    expect((await act(c, { action: 'answer', stepId: 'experience', value: 'senior' })).status).toBe(400);
    expect((await act(c, { action: 'answer', stepId: 'experienceSummary', value: 'x'.repeat(1001) })).status).toBe(400);
    expect((await act(c, { action: 'answer', stepId: 'candidateIndustries', value: Array(13).fill('Образование') })).status).toBe(400);
    expect((await act(c, { action: 'bogus' })).status).toBe(400);
  });

  it('восстановление: после «настроить позже» и повторного входа — тот же шаг, онбординг не завершён', async () => {
    const c = await asCandidate('u1');
    await act(c, { action: 'answer', stepId: 'goal', value: 'job_search' });
    const later = await act(c, { action: 'later' });
    expect(later.json.next).toBe('/consultant');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } })).onboardedAt).toBeNull();
    const v = await view(c);
    expect(v.current.id).toBe('specialization');
    expect(v.history.map((h) => h.stepId)).toEqual(['role', 'candidateConsents', 'goal']);
    expect(v.history[2]).toMatchObject({ answer: 'Ищу работу', editable: true });
  });

  it('«настроить позже» у кандидата — пауза в ленте /consultant: переживает перезагрузку, снимается возвратом к шагу', async () => {
    const c = await asCandidate('u1');
    // First intake advances continuously; only an explicit pause switches to chat.
    expect((await view(c)).later).toBe(false);
    await act(c, { action: 'later' });
    const paused = await view(c);
    expect(paused.later).toBe(true);
    expect(paused.current.id).toBe('goal');
    // «Вернуться к знакомству» — goto на текущий шаг: пауза снята, шаг тот же.
    const back = await act(c, { action: 'goto', stepId: 'goal' });
    expect(back.json.later).toBe(false);
    expect(back.json.current.id).toBe('goal');
    // Resuming the current step continues the full questionnaire, including later skips.
    const answered = await act(c, { action: 'answer', stepId: 'goal', value: 'job_search' });
    expect(answered.json.later).toBe(false);
    expect(answered.json.current.id).toBe('specialization');
    const skipped = await act(c, { action: 'skip', stepId: 'documents' });
    expect(skipped.json.later).toBe(false);
    // Обязательный шаг идёт сразу за своим: после направления — подкатегория, без возврата в чат.
    await act(c, { action: 'goto', stepId: 'specialization' });
    const spec = await act(c, { action: 'answer', stepId: 'specialization', value: 'backend' });
    expect(spec.json.current.id).toBe('subcategory');
    expect(spec.json.later).toBe(false);
  });

  it('открытие другого поля после паузы остаётся отдельной правкой с возвратом в чат', async () => {
    const c = await asCandidate('u1');
    await act(c, { action: 'later' });
    const edit = await act(c, { action: 'goto', stepId: 'experience' });
    expect(edit.json.later).toBe(false);
    const answered = await act(c, { action: 'answer', stepId: 'experience', value: 'oneToThree' });
    expect(answered.json.later).toBe(true);
    expect(answered.json.current.id).toBe('experienceSummary');
    // Now the feed's resume opens that exact saved step and removes the one-field flag.
    await act(c, { action: 'goto', stepId: 'experienceSummary' });
    const resumed = await act(c, { action: 'skip', stepId: 'experienceSummary' });
    expect(resumed.json.later).toBe(false);
    expect(resumed.json.current.id).toBe('candidateIndustries');
    expect((await prisma.onboardingState.findUniqueOrThrow({ where: { userId: 'u1' } })).meta).not.toHaveProperty('manualProfileEdit');
  });

  it('«настроить позже» до роли — на главную', async () => {
    expect((await act(pending('u1'), { action: 'later' })).json.next).toBe('/');
  });

  it('goto: вернуться к пропущенному из итога и ответить', async () => {
    const c = await asCandidate('u1');
    for (const id of ['goal', 'documents', 'fsp', 'specialization', 'experience', 'experienceSummary', 'candidateIndustries', 'grade', 'stack', 'formats', 'salary', 'candidateContact', 'fspParticipation']) {
      await act(c, { action: 'skip', stepId: id });
    }
    const sum = await view(c);
    expect(sum.current.kind).toBe('summary');
    expect(sum.summary!.skipped).toHaveLength(13);
    expect(sum.summary!.warnings.join(' ')).toMatch(/направления/);
    const back = await act(c, { action: 'goto', stepId: 'grade' });
    expect(back.json.current.id).toBe('grade');
    const done = await act(c, { action: 'answer', stepId: 'grade', value: 'junior' });
    expect(done.json.current.kind).toBe('summary');
    expect((await act(c, { action: 'goto', stepId: 'consent' })).status).toBe(409);
  });

  it('завершение: completeOnboarding ставит onboardedAt и ведёт по роли', async () => {
    const c = await asCandidate('u1');
    const r = await complete(jsonRequest('/x', 'POST', {}, c));
    expect(await r.json()).toEqual({ onboarded: true, next: '/consultant' });
    expect((await view(c)).onboarded).toBe(true);
  });

  it('работодатель: компания по названию, ИНН с контрольной суммой, потребность → Vacancy на каждый грейд', async () => {
    let c = pending('u1');
    await act(c, { action: 'answer', stepId: 'consent', value: { version: CONSENT_VERSION } });
    const r1 = await act(c, { action: 'answer', stepId: 'role', value: 'employer' });
    expect(cookieFrom(r1.res)).toBeUndefined(); // роль ещё pending: компания — на следующем шаге
    expect(r1.json.current.id).toBe('companyName');
    expect((await act(c, { action: 'skip', stepId: 'companyName' })).status).toBe(409);
    const r2 = await act(c, { action: 'answer', stepId: 'companyName', value: 'ООО Ромашка' });
    c = cookieFrom(r2.res)!;
    const { employerProfileId } = parseSession(c.slice(4))!;
    const companyId = (await prisma.employerProfile.findUniqueOrThrow({ where: { id: employerProfileId! } })).companyId;
    // ADR 0005: сразу после компании — оферта и обязательство по данным (отдельные галочки)
    const rc = await act(c, { action: 'answer', stepId: 'employerConsents', value: ['employer_offer', 'employer_data_obligation'] });
    expect(rc.status).toBe(200);
    expect((await prisma.consent.findMany({ where: { userId: 'u1', kind: { in: ['employer_offer', 'employer_data_obligation'] } } })).length).toBe(2);

    expect((await act(c, { action: 'answer', stepId: 'inn', value: '7707083894' })).status).toBe(400);
    await act(c, { action: 'answer', stepId: 'inn', value: '7707083893' });
    await act(c, { action: 'answer', stepId: 'industry', value: 'Финтех' });
    await act(c, { action: 'answer', stepId: 'about', value: 'Платёжный сервис' });
    await act(c, { action: 'answer', stepId: 'contact', value: 'hr@romashka.test' });
    expect(await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).toMatchObject({
      name: 'ООО Ромашка',
      inn: '7707083893',
      industry: 'Финтех',
      description: 'Платёжный сервис',
      contact: 'hr@romashka.test',
      isDemo: false,
    });

    await act(c, { action: 'answer', stepId: 'needSpecialization', value: 'backend' });
    await act(c, { action: 'answer', stepId: 'needSubcategory', value: 'backend.integrations' });
    await act(c, { action: 'answer', stepId: 'needGrades', value: ['junior', 'middle'] });
    await act(c, { action: 'answer', stepId: 'needStack', value: ['Kafka', 'Go'] });
    await act(c, { action: 'answer', stepId: 'needTeam', value: 'Платёжный шлюз' });
    expect(await prisma.vacancy.count({ where: { companyId } })).toBe(0); // вилки ещё нет
    const fin = await act(c, { action: 'answer', stepId: 'needSalary', value: { from: 150, to: 300 } });
    expect(fin.json.current.kind).toBe('summary');
    expect(fin.json.summary!.warnings).toEqual([]);
    const vac = await prisma.vacancy.findMany({ where: { companyId }, orderBy: { grade: 'asc' } });
    expect(vac.map((v) => [v.grade, v.salaryFrom, v.salaryTo, v.teamDescription])).toEqual([
      ['junior', 150_000, 300_000, 'Платёжный шлюз'],
      ['middle', 150_000, 300_000, 'Платёжный шлюз'],
    ]);
    expect(vac[1]!.stack).toEqual(['Kafka', 'Go']);
    expect(vac.map((v) => v.subcategoryId)).toEqual(['backend.integrations', 'backend.integrations']);
    const needIds = (vac[1]!.needs as { catalogId: string }[]).map((n) => n.catalogId);
    expect(needIds.slice(0, 2).sort()).toEqual(['be.lang-core', 'be.message-queue']); // Go и Kafka — первыми

    // правка: остался один грейд — вторая вакансия удаляется (приглашений нет), id первой не меняется
    await act(c, { action: 'goto', stepId: 'needGrades' });
    await act(c, { action: 'answer', stepId: 'needGrades', value: ['middle'] });
    const after = await prisma.vacancy.findMany({ where: { companyId } });
    expect(after.map((v) => v.id)).toEqual([vac[1]!.id]);

    const r = await complete(jsonRequest('/x', 'POST', {}, c));
    expect((await r.json()).next).toBe('/consultant'); // дом работодателя — лента помощника (решение владельца 10.10);
  });

  it('CSRF: чужой Origin — 403', async () => {
    const req = new Request('http://localhost/api/onboarding', {
      method: 'POST',
      headers: { cookie: pending('u1'), origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'later' }),
    });
    expect((await POST(req)).status).toBe(403);
  });
});
