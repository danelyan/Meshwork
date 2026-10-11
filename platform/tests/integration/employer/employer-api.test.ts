import { GET as listInvites, POST as invite } from '@/app/api/employer/invitations/route';
import { GET as search } from '@/app/api/employer/search/route';
import { GET as matches } from '@/app/api/employer/vacancies/[id]/matches/route';
import { GET as getVac, PATCH as patchVac, PUT as putVac } from '@/app/api/employer/vacancies/[id]/route';
import { GET as listVac, POST as createVac } from '@/app/api/employer/vacancies/route';
import { POST as respond } from '@/app/api/invitations/[id]/route';
import { GET as myInvites } from '@/app/api/invitations/route';
import { GET as getPrivacy, POST as setPrivacy } from '@/app/api/profile/privacy/route';
import { createInvitation } from '@/server/employer/invitations';
import { signUserSession } from '@/server/session';

import { seedAuth, DEMO_EMPLOYER } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { DEMO_POOL, seedEmployer } from '../../../prisma/seed/employer';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';
import { DISCLOSURE_VERSION, grantEmployerConsents, linkCandidateUsers } from '../../helpers/consents';

const EMP = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: DEMO_EMPLOYER.profileId })}`;
const OTHER = `cid=${signUserSession({ userId: 'u-other', role: 'employer', employerProfileId: 'p-other' })}`;
const candCookie = (candidateId: string, userId = `u-${candidateId}`) => `cid=${signUserSession({ userId, role: 'candidate', candidateId })}`;
const PAY = DEMO_POOL[0]!; // backend middle, платежи, ФСП
const PAY_VAC = 'demo-vac-be-m-1'; // Северный Поток

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const VAC_BODY = {
  title: 'Backend платежей',
  specialization: 'backend',
  subcategoryId: 'backend.integrations',
  grade: 'middle',
  salaryFrom: 200000,
  salaryTo: 260000,
  teamDescription: 'Платёжная команда',
  stack: ['Go', 'Kafka'],
  needs: [{ catalogId: 'be.idempotency', weight: 3 }, { catalogId: 'be.transactions', weight: 3 }],
};

async function sendInvite(candidateId = PAY.id, cookie = EMP, extra: Record<string, unknown> = {}) {
  return invite(jsonRequest('/api/employer/invitations', 'POST', { candidateId, vacancyId: PAY_VAC, message: 'Платёжная команда, Go и Kafka', salaryFrom: 230000, salaryTo: 230000, ...extra }, cookie));
}

describe('кабинет работодателя (БД)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    // Сессии в тестах ссылаются на аккаунты: кука на несуществующего пользователя = гость (session_stale).
    // Роль аккаунта совпадает с ролью куки (ADR 0004: иначе кука протухшая).
    await prisma.user.createMany({
      data: [{ id: 'u-other', name: 'u-other', role: 'employer' as const }, ...DEMO_POOL.map((c) => ({ id: `u-${c.id}`, name: c.id, role: 'candidate' as const }))],
      skipDuplicates: true,
    });
  });
  beforeEach(async () => {
    await prisma.invitation.deleteMany();
    await prisma.vacancy.deleteMany();
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
    await prisma.company.upsert({ where: { id: 'co-other' }, update: {}, create: { id: 'co-other', name: 'Другая', isDemo: false } });
    await prisma.user.upsert({ where: { id: 'u-other' }, update: {}, create: { id: 'u-other', name: 'Чужой', role: 'employer' } });
    await prisma.employerProfile.upsert({ where: { userId: 'u-other' }, update: {}, create: { id: 'p-other', userId: 'u-other', companyId: 'co-other' } });
    await prisma.candidate.updateMany({ data: { hiddenFromEmployers: false } });
    await linkCandidateUsers(DEMO_POOL.map((c) => c.id)); // Г5 (ADR 0005) пишется на аккаунт кандидата
    // чужой работодатель принял оферту: проверяем изоляцию компаний (404), а не гейт согласий (409)
    await prisma.consent.deleteMany({ where: { userId: 'u-other' } });
    await grantEmployerConsents(['u-other']);
  });
  afterAll(() => prisma.$disconnect());

  it('потребности: список своей компании, создание, правка, архив; чужая – 404; кандидат – 403; без входа – 401', async () => {
    const list = await (await listVac(jsonRequest('/x', 'GET', undefined, EMP))).json();
    expect(list.company.name).toBe('Северный Поток');
    expect(list.vacancies.map((v: { id: string }) => v.id).sort()).toEqual(['demo-vac-be-j-1', 'demo-vac-be-m-1', 'demo-vac-fe-j-2']);
    expect(list.vacancies.find((v: { id: string }) => v.id === PAY_VAC).stack).toEqual(['Go', 'PostgreSQL', 'Kafka']);

    const created = await createVac(jsonRequest('/x', 'POST', VAC_BODY, EMP));
    expect(created.status).toBe(201);
    const v = await created.json();
    expect(v).toMatchObject({ title: 'Backend платежей', teamDescription: 'Платёжная команда', stack: ['Go', 'Kafka'], archived: false });

    const put = await putVac(jsonRequest('/x', 'PUT', { ...VAC_BODY, title: 'Новое имя' }, EMP), params({ id: v.id }));
    expect((await put.json()).title).toBe('Новое имя');
    const arch = await patchVac(jsonRequest('/x', 'PATCH', { archived: true }, EMP), params({ id: v.id }));
    expect((await arch.json()).archived).toBe(true);

    expect((await getVac(jsonRequest('/x', 'GET', undefined, OTHER), params({ id: v.id }))).status).toBe(404);
    expect((await putVac(jsonRequest('/x', 'PUT', VAC_BODY, OTHER), params({ id: v.id }))).status).toBe(404);
    expect((await listVac(jsonRequest('/x', 'GET', undefined, candCookie(PAY.id)))).status).toBe(403);
    expect((await listVac(jsonRequest('/x', 'GET'))).status).toBe(401);
  });

  it('потребность: требование не из каталога или другой специализации – 400; перевёрнутая вилка – 400', async () => {
    const bad = await createVac(jsonRequest('/x', 'POST', { ...VAC_BODY, needs: [{ catalogId: 'fe.a11y', weight: 2 }] }, EMP));
    expect(bad.status).toBe(400);
    const nope = await createVac(jsonRequest('/x', 'POST', { ...VAC_BODY, needs: [{ catalogId: 'none.x', weight: 2 }] }, EMP));
    expect(nope.status).toBe(400);
    const fork = await createVac(jsonRequest('/x', 'POST', { ...VAC_BODY, salaryTo: 1 }, EMP));
    expect(fork.status).toBe(400);
  });

  it('подборка: ранжирована, с обоснованием; контактов и имени нет до принятия (R-E-07)', async () => {
    const res = await matches(jsonRequest(`/api/employer/vacancies/${PAY_VAC}/matches`, 'GET', undefined, EMP), params({ id: PAY_VAC }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].candidateId).toBe(PAY.id);
    expect(body.items[0].explanation.summary).toMatch(/^Закрывает 6 из 6 требований/);
    expect(body.items[0].explanation.fsp).toMatch(/^есть подтверждённые достижения/);
    expect(body.items[0].candidate.contacts).toBeNull();
    const raw = JSON.stringify(body);
    for (const p of DEMO_POOL) {
      expect(raw).not.toContain(`${p.id}@example.test`);
      expect(raw).not.toContain(p.name);
    }
    // цитаты резюме наружу не уходят
    expect(raw).not.toContain('Go, PostgreSQL, Kafka:');
    // тип источника – да (R-E-07), но без ссылок, ссылок на репозитории и цитат
    const claims = body.items[0].candidate.claims as { level: string; sourceType: string | null }[];
    const artifact = claims.filter((c) => c.level === 'artifact');
    expect(artifact.length).toBeGreaterThan(0);
    expect(artifact.every((c) => c.sourceType === 'github')).toBe(true);
    expect(claims.filter((c) => c.level === 'third_party').every((c) => c.sourceType === 'codeforces')).toBe(true);
    expect(claims.filter((c) => c.level === 'self_reported').every((c) => c.sourceType === null)).toBe(true);
    for (const key of ['sourceRef', 'sourceKind', '"quote"', '"wording"', 'github:demo', 'codeforces:demo', 'cv-demo.pdf']) expect(raw).not.toContain(key);
  });

  it('подборка скрывает кандидата с нулевым покрытием; поиск по банку – нет (решение владельца 09.10); без категории – только в расширенном пуле (M05)', async () => {
    await prisma.candidate.create({
      data: { id: 'zero-cov', name: 'Нулевой', email: 'zero-cov@example.test', specialization: 'backend', fspState: 'not_linked', consentAt: new Date() },
    });
    await prisma.claim.create({
      data: {
        candidateId: 'zero-cov', catalogId: 'be.sql-indexes', statement: 'Индексы', level: 'self_reported', quote: 'Go, Kafka',
        sourceRef: 'cv.pdf#p1:l1', sourceKind: 'resume', confidence: 'high', limits: '', suggestedProof: [], status: 'confirmed', confirmedAt: new Date(),
      },
    });
    const created = await (await createVac(jsonRequest('/api/employer/vacancies', 'POST', VAC_BODY, EMP))).json();
    const vacId = created.id ?? created.vacancy?.id;
    const m = await (await matches(jsonRequest(`/x/${vacId}/matches`, 'GET', undefined, EMP), params({ id: vacId }))).json();
    expect(m.items.map((i: { candidateId: string }) => i.candidateId)).not.toContain('zero-cov');
    // без закрытых требований в подборке только кандидаты с совпавшей категорией из теста (Q-36)
    expect(m.items.every((i: { covered: number; categoryMatch: boolean }) => i.covered >= 1 || i.categoryMatch)).toBe(true);
    // основной режим – только подтверждённые категории: кандидата без теста в банке нет; pool=all показывает его с пометкой
    const main = await (await search(jsonRequest('/api/employer/search?spec=backend&stack=Go', 'GET', undefined, EMP))).json();
    expect(main.items.map((i: { candidateId: string }) => i.candidateId)).not.toContain('zero-cov');
    expect(main.items.every((i: { candidate: { category: unknown } }) => i.candidate.category !== null)).toBe(true);
    const bank = await (await search(jsonRequest('/api/employer/search?spec=backend&stack=Go&pool=all', 'GET', undefined, EMP))).json();
    expect(bank.items.map((i: { candidateId: string }) => i.candidateId)).toContain('zero-cov');
    const zero = bank.items.find((i: { candidateId: string }) => i.candidateId === 'zero-cov');
    expect(zero.candidate.category).toBeNull();
    expect(zero.explanation.category).toBe('без категории из теста - расширенный пул');
    expect(bank.filters).toEqual({ specialization: 'backend', stack: ['Go'], expandPool: true });
    // прежний category=1 – no-op: совпадает с режимом по умолчанию
    const legacy = await (await search(jsonRequest('/api/employer/search?spec=backend&stack=Go&category=1', 'GET', undefined, EMP))).json();
    expect(legacy.items.map((i: { candidateId: string }) => i.candidateId)).toEqual(main.items.map((i: { candidateId: string }) => i.candidateId));
    await prisma.candidate.delete({ where: { id: 'zero-cov' } }); // не мешать соседним тестам
  });

  it('подборка: кандидат только с категорией из теста виден, чужая специализация – нет, порядок трёх типов (Q-36)', async () => {
    const mk = (id: string, extra: Record<string, unknown> = {}) =>
      prisma.candidate.create({ data: { id, name: id, email: `${id}@example.test`, specialization: 'backend', fspState: 'not_linked', consentAt: new Date(), ...extra } });
    const claim = (candidateId: string) =>
      prisma.claim.create({
        data: {
          candidateId, catalogId: 'be.idempotency', statement: 'Идемпотентность', level: 'self_reported', quote: 'Go',
          sourceRef: 'cv.pdf#p1:l1', sourceKind: 'resume', confidence: 'high', limits: '', suggestedProof: [], status: 'confirmed', confirmedAt: new Date(),
        },
      });
    await mk('q36-cat-only');
    await prisma.candidateCategory.create({ data: { candidateId: 'q36-cat-only', specialization: 'backend', grade: 'middle' } });
    await mk('q36-cat-fe', { specialization: 'frontend' });
    await prisma.candidateCategory.create({ data: { candidateId: 'q36-cat-fe', specialization: 'frontend', grade: 'middle' } });
    await mk('q36-both');
    await prisma.candidateCategory.create({ data: { candidateId: 'q36-both', specialization: 'backend', grade: 'middle' } });
    await claim('q36-both');
    await mk('q36-claims');
    await claim('q36-claims');
    const created = await (await createVac(jsonRequest('/api/employer/vacancies', 'POST', { ...VAC_BODY, stack: [], needs: [{ catalogId: 'be.idempotency', weight: 3 }, { catalogId: 'be.transactions', weight: 3 }] }, EMP))).json();
    const vacId = created.id ?? created.vacancy?.id;
    // q36-claims без категории: в основном режиме его нет, подсказка предлагает расширить пул; в расширенном – ниже q36-both
    const main = await (await matches(jsonRequest(`/x/${vacId}/matches`, 'GET', undefined, EMP), params({ id: vacId }))).json();
    expect(main.items.map((i: { candidateId: string }) => i.candidateId)).not.toContain('q36-claims');
    expect(main.hints.find((h: { kind: string }) => h.kind === 'expandPool')).toMatchObject({ gain: expect.any(Number), filters: { expandPool: true } });
    const m = await (await matches(jsonRequest(`/x/${vacId}/matches?pool=all`, 'GET', undefined, EMP), params({ id: vacId }))).json();
    const ids: string[] = m.items.map((i: { candidateId: string }) => i.candidateId);
    expect(ids).toContain('q36-cat-only');
    expect(ids).not.toContain('q36-cat-fe');
    expect(ids.indexOf('q36-both')).toBeLessThan(ids.indexOf('q36-claims'));
    expect(ids.indexOf('q36-both')).toBeLessThan(ids.indexOf('q36-cat-only'));
    const only = m.items.find((i: { candidateId: string }) => i.candidateId === 'q36-cat-only');
    expect(only.covered).toBe(0);
    expect(only.explanation.summary).toContain('подтверждена тестом; требования потребности не доказаны утверждениями');
    await prisma.candidate.deleteMany({ where: { id: { startsWith: 'q36-' } } });
  });

  it('фильтры – query (R-M-04): ФСП, стек, грейд категории; чужая потребность – 404', async () => {
    const url = (q: string) => jsonRequest(`/api/employer/vacancies/${PAY_VAC}/matches?${q}`, 'GET', undefined, EMP);
    const fsp = await (await matches(url('fsp=1'), params({ id: PAY_VAC }))).json();
    expect(fsp.items.every((i: { candidate: { fsp: { hasAchievements: boolean } } }) => i.candidate.fsp.hasAchievements)).toBe(true);
    const stack = await (await matches(url('stack=Kafka'), params({ id: PAY_VAC }))).json();
    expect(stack.items.map((i: { candidateId: string }) => i.candidateId)).toEqual([PAY.id]);
    const fe = (q: string) => jsonRequest(`/x?${q}`, 'GET', undefined, EMP);
    const all = await (await matches(fe('pool=all'), params({ id: 'demo-vac-fe-j-2' }))).json();
    expect(all.items.map((i: { candidateId: string }) => i.candidateId)).toContain('demo-pool-fe-j-2'); // без категории – расширенный пул
    const grade = await (await matches(fe('grade=junior'), params({ id: 'demo-vac-fe-j-2' }))).json();
    expect(grade.items.map((i: { candidateId: string }) => i.candidateId)).toEqual(['demo-pool-fe-j-1']);
    // кандидаты другой специализации в выдачу по потребности не попадают (балл ≤ 0)
    expect(all.items.every((i: { candidate: { specialization: string } }) => i.candidate.specialization === 'frontend')).toBe(true);
    expect((await matches(jsonRequest('/x', 'GET', undefined, OTHER), params({ id: PAY_VAC }))).status).toBe(404);
  });

  it('поиск по банку (R-E-04) без потребности; скрытый кандидат (R-C-13) не виден ни там, ни там', async () => {
    const main = await (await search(jsonRequest('/api/employer/search?spec=frontend', 'GET', undefined, EMP))).json();
    expect(main.vacancy).toBeNull();
    expect(main.items.length).toBe(2); // только с категорией из теста (M05)
    const all = await (await search(jsonRequest('/api/employer/search?spec=frontend&pool=all', 'GET', undefined, EMP))).json();
    expect(all.items.length).toBe(4);
    const fe = DEMO_POOL.find((p) => p.id === 'demo-pool-fe-j-2')!;
    expect((await setPrivacy(jsonRequest('/x', 'POST', { hiddenFromEmployers: true }, candCookie(fe.id)))).status).toBe(200);
    expect((await (await getPrivacy(jsonRequest('/x', 'GET', undefined, candCookie(fe.id)))).json()).hiddenFromEmployers).toBe(true);
    const after = await (await search(jsonRequest('/api/employer/search?spec=frontend&pool=all', 'GET', undefined, EMP))).json();
    expect(after.items.map((i: { candidateId: string }) => i.candidateId)).not.toContain(fe.id);
    expect((await sendInvite(fe.id)).status).toBe(404);
  });

  it('приглашение → кандидат видит своё → принял → работодатель видит контакты', async () => {
    const res = await sendInvite();
    expect(res.status).toBe(201);
    const { id } = await res.json();

    // кандидат: только свои; открытие отмечает просмотр
    const mine = await (await myInvites(jsonRequest('/api/invitations?view=1', 'GET', undefined, candCookie(PAY.id)))).json();
    expect(mine.invitations).toHaveLength(1);
    expect(mine.invitations[0]).toMatchObject({ id, status: 'viewed', salaryFrom: 230000, salaryTo: 230000, company: { name: 'Северный Поток' } });
    const other = await (await myInvites(jsonRequest('/api/invitations', 'GET', undefined, candCookie('demo-pool-be-j-1')))).json();
    expect(other.invitations).toEqual([]);

    // до принятия контактов нет
    let tracked = await (await listInvites(jsonRequest('/x', 'GET', undefined, EMP))).json();
    expect(tracked.invitations[0].candidate.contacts).toBeNull();
    expect(tracked.invitations[0].status).toBe('viewed');
    expect(JSON.stringify(tracked)).not.toContain(`${PAY.id}@example.test`);
    expect(JSON.stringify(tracked)).not.toContain('candidate.be-m-pay@example.com');

    // чужой кандидат не может ответить: 404; работодатель – 403
    expect((await respond(jsonRequest('/x', 'POST', { action: 'accept' }, candCookie('demo-pool-be-j-1')), params({ id }))).status).toBe(404);
    expect((await respond(jsonRequest('/x', 'POST', { action: 'accept' }, EMP), params({ id }))).status).toBe(403);

    const ok = await respond(jsonRequest('/x', 'POST', { action: 'accept', disclosureVersion: DISCLOSURE_VERSION }, candCookie(PAY.id)), params({ id }));
    expect(await ok.json()).toEqual({ id, status: 'accepted' });
    expect((await respond(jsonRequest('/x', 'POST', { action: 'decline' }, candCookie(PAY.id)), params({ id }))).status).toBe(409);

    tracked = await (await listInvites(jsonRequest('/x', 'GET', undefined, EMP))).json();
    expect(tracked.invitations[0].candidate.contacts).toEqual({ name: PAY.name, contact: 'candidate.be-m-pay@example.com' });
    const m = await (await matches(jsonRequest('/x', 'GET', undefined, EMP), params({ id: PAY_VAC }))).json();
    expect(m.items[0].candidate.displayName).toBe(PAY.name);
    // другой компании контакты не открылись
    const s = await (await search(jsonRequest('/x', 'GET', undefined, OTHER))).json();
    expect(JSON.stringify(s)).not.toContain(`${PAY.id}@example.test`);
    expect(JSON.stringify(s)).not.toContain('candidate.be-m-pay@example.com');
    expect((await (await listInvites(jsonRequest('/x', 'GET', undefined, OTHER))).json()).invitations).toEqual([]);
  });

  it('без привязки к потребности (R-E-05); зарплата обязательна; чужая потребность – 404; дубль открытого – 409', async () => {
    const free = await sendInvite(PAY.id, EMP, { vacancyId: null });
    expect(free.status).toBe(201);
    const mine = await (await myInvites(jsonRequest('/x', 'GET', undefined, candCookie(PAY.id)))).json();
    expect(mine.invitations[0].vacancy).toBeNull();
    expect(mine.invitations[0].company.name).toBe('Северный Поток');
    expect((await sendInvite(PAY.id)).status).toBe(409);
    expect((await sendInvite('demo-pool-be-j-1', EMP, { salaryFrom: undefined })).status).toBe(400);
    expect((await sendInvite('demo-pool-be-j-1', OTHER)).status).toBe(404);
    expect((await sendInvite('nope')).status).toBe(404);
  });

  it('ранг в подборке (E-08, метрика): сохраняется matchRank/matchSource; вне 1..1000 или чужой источник – 400; без ранга – null', async () => {
    expect((await sendInvite(PAY.id, EMP, { matchRank: 0 })).status).toBe(400);
    expect((await sendInvite(PAY.id, EMP, { matchRank: 1001 })).status).toBe(400);
    expect((await sendInvite(PAY.id, EMP, { matchRank: 2.5 })).status).toBe(400);
    expect((await sendInvite(PAY.id, EMP, { matchSource: 'hack' })).status).toBe(400);
    const ranked = await (await sendInvite(PAY.id, EMP, { matchRank: 2, matchSource: 'matching' })).json();
    expect(await prisma.invitation.findUniqueOrThrow({ where: { id: ranked.id }, select: { matchRank: true, matchSource: true } })).toEqual({ matchRank: 2, matchSource: 'matching' });
    const plain = await (await sendInvite('demo-pool-be-j-1')).json();
    expect(await prisma.invitation.findUniqueOrThrow({ where: { id: plain.id }, select: { matchRank: true, matchSource: true } })).toEqual({ matchRank: null, matchSource: null });
  });

  it('лимит приглашений компании за сутки – 429', async () => {
    const ctx = { companyId: DEMO_EMPLOYER.companyId, employerProfileId: DEMO_EMPLOYER.profileId };
    const ids = DEMO_POOL.slice(0, 3).map((p) => p.id);
    await createInvitation(ctx, { candidateId: ids[0]!, message: 'Платёжная команда', salaryFrom: 1, salaryTo: 1 }, 2);
    await createInvitation(ctx, { candidateId: ids[1]!, message: 'Платёжная команда', salaryFrom: 1, salaryTo: 1 }, 2);
    await expect(createInvitation(ctx, { candidateId: ids[2]!, message: 'Платёжная команда', salaryFrom: 1, salaryTo: 1 }, 2)).rejects.toMatchObject({ status: 429 });
    // параллельные запросы не обходят счётчик (advisory lock)
    await prisma.invitation.deleteMany();
    const results = await Promise.allSettled(ids.map((candidateId) => createInvitation(ctx, { candidateId, message: 'Платёжная команда', salaryFrom: 1, salaryTo: 1 }, 2)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await prisma.invitation.count()).toBe(2);
  });
});
