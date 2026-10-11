// Полный путь ступени 2 (ADR 0003 + «Дополнение 10.10»): потребность → задание → лента → взять → сдача →
// runner (stub) → результат → список работодателя → приглашение на защиту. LLM — stub, runner — stub.
import { inflateRawSync } from 'node:zlib';

import { POST as inviteDefense } from '@/app/api/employer/project-submissions/[id]/invite-to-defense/route';
import { GET as employerSubs } from '@/app/api/employer/project-submissions/route';
import { GET as getNeedProject, POST as needProject } from '@/app/api/employer/needs/[id]/project/route';
import { GET as templatesRoute } from '@/app/api/employer/project-templates/route';
import { GET as getSubmission } from '@/app/api/project-submissions/[id]/route';
import { GET as getTask } from '@/app/api/project-tasks/[id]/route';
import { GET as skeleton } from '@/app/api/project-tasks/[id]/skeleton.zip/route';
import { POST as submit } from '@/app/api/project-tasks/[id]/submissions/route';
import { POST as take } from '@/app/api/project-tasks/[id]/take/route';
import { GET as feed } from '@/app/api/project-tasks/feed/route';
import { CALL_RECORDING_CONSENT_VERSION } from '@/server/call/consent';
import { startDefenseRoom } from '@/server/defense-room';
import { demoRepoSnapshot } from '@/server/defense-room/fixtures/demo-repo';
import { requestProjectDefense } from '@/server/defense-room/pending';
import { getLlm } from '@/server/llm';
import { setDefenseHook, type DefenseRequest } from '@/server/project/defense-hook';
import { createStubRunner, setProjectRunner } from '@/server/project/runner-client';
import { PROJECT_MAX_ACTIVE } from '@/server/project/schemas';
import { upsertProjectTask } from '@/server/project/service';
import { signUserSession } from '@/server/session';

import { DEMO_EMPLOYER, seedAuth } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { seedEmployer } from '../../../prisma/seed/employer';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';
import { discloseAccepted, grantConsents, grantEmployerConsents } from '../../helpers/consents';

const EMP = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: DEMO_EMPLOYER.profileId })}`;
const OTHER = `cid=${signUserSession({ userId: 'u-other', role: 'employer', employerProfileId: 'p-other' })}`;
const cand = (id: string) => `cid=${signUserSession({ userId: `u-${id}`, role: 'candidate', candidateId: id })}`;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const NEED = 'demo-vac-be-j-1'; // Северный Поток, backend junior, 90–130 тыс.
const COMPANY = 'Северный Поток';

const defenseCalls: DefenseRequest[] = [];

async function makeCandidate(id: string, specialization: 'backend' | 'frontend' | null, grade: 'junior' | 'middle' | null) {
  await prisma.candidate.create({ data: { id, name: `Имя ${id}`, email: `${id}@example.test`, specialization, consentAt: new Date() } });
  await prisma.user.create({ data: { id: `u-${id}`, name: id, role: 'candidate', candidateId: id } });
  await grantConsents(`u-${id}`, ['ai_assessment']); // Г3 (ADR 0005): защиту оценивает ИИ
  if (grade && specialization) await prisma.candidateCategory.create({ data: { candidateId: id, specialization, grade } });
}

async function waitChecked(id: string, cookie: string) {
  for (let i = 0; i < 100; i++) {
    const body = await (await getSubmission(jsonRequest('/x', 'GET', undefined, cookie), params({ id }))).json();
    if (body.status === 'checked' || body.status === 'failed') return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('сдача не проверилась');
}

describe('проект под работодателя: лента и сдача (БД)', () => {
  let taskId = '';

  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
    await prisma.company.create({ data: { id: 'co-other', name: 'Другая', isDemo: false } });
    await prisma.user.create({ data: { id: 'u-other', name: 'Чужой', role: 'employer' } });
    await prisma.employerProfile.create({ data: { id: 'p-other', userId: 'u-other', companyId: 'co-other' } });
    await grantEmployerConsents(['u-other']); // ADR 0005: оферта и обязательство по данным
    await makeCandidate('p-be', 'backend', 'junior');
    await makeCandidate('p-fe', 'frontend', 'junior');
    await makeCandidate('p-lim', 'backend', 'junior');
    setProjectRunner(createStubRunner());
    setDefenseHook({
      async requestDefense(req) {
        defenseCalls.push(req);
        return requestProjectDefense(req.candidateId, req.submissionId);
      },
    });
  });
  afterAll(async () => {
    setProjectRunner(null);
    setDefenseHook(null);
    await prisma.$disconnect();
  });

  it('шаблоны: работодателю — список с подкатегориями; кандидату — 403', async () => {
    const res = await templatesRoute(jsonRequest('/api/employer/project-templates?specialization=backend', 'GET', undefined, EMP));
    const body = await res.json();
    // 13 шаблонов Backend (E-07: каждая категория); исходные шесть на месте, чужих направлений нет.
    expect(body.templates.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining(['be-integrations-middle-delivery', 'be-integrations-senior-outbox', 'be-webapi-junior-booking', 'be-webapi-junior-notes', 'be-webapi-middle-orders', 'be-webapi-senior-ratelimit']));
    expect(body.templates.every((t: { id: string }) => t.id.startsWith('be-'))).toBe(true);
    expect(body.templates[0].tests.hidden).toBeGreaterThan(body.templates[0].tests.visible);
    expect((await templatesRoute(jsonRequest('/x', 'GET', undefined, cand('p-be')))).status).toBe(403);
  });

  it('задание к потребности: условие без компании и зарплаты, рубрика из критериев и пожеланий; чужому — 404', async () => {
    const res = await needProject(
      jsonRequest('/x', 'POST', { requiredCatalogIds: ['be.idempotency', 'be.rest-design'], wishesText: `Ошибки логировать с кодом и временем. В ${COMPANY} любят тесты на граничные случаи.` }, EMP),
      params({ id: NEED }),
    );
    expect(res.status).toBe(201);
    const task = await res.json();
    taskId = task.id;
    expect(task.template.id).toBe('be-webapi-junior-booking');
    expect(task.visibility).toBe('open');
    expect(task.spec.title.length).toBeGreaterThan(3);
    expect(task.rubric.criteria.map((c: { id: string; source: string }) => `${c.source}:${c.id}`)).toEqual([
      'required:req:be.idempotency',
      'required:req:be.rest-design',
      'wish:wish:1',
      'wish:wish:2',
    ]);
    expect(JSON.stringify(task.spec)).not.toContain(COMPANY);

    expect((await needProject(jsonRequest('/x', 'POST', {}, OTHER), params({ id: NEED }))).status).toBe(404);
    expect((await needProject(jsonRequest('/x', 'POST', {}, cand('p-be')), params({ id: NEED }))).status).toBe(403);
    const bad = await needProject(jsonRequest('/x', 'POST', { requiredCatalogIds: ['fe.a11y'] }, EMP), params({ id: NEED }));
    expect(bad.status).toBe(400);
    const got = await (await getNeedProject(jsonRequest('/x', 'GET', undefined, EMP), params({ id: NEED }))).json();
    expect(got.task.id).toBe(taskId);
  });

  it('лента: задание видно backend junior без компании, потребности и зарплаты; frontend — не видно', async () => {
    const res = await feed(jsonRequest('/api/project-tasks/feed', 'GET', undefined, cand('p-be')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([taskId]);
    expect(body.limit).toEqual({ maxActive: PROJECT_MAX_ACTIVE, active: 0 });
    const item = body.items[0];
    expect(item).toMatchObject({ specialization: 'backend', subcategoryId: 'backend.web-api', grade: 'junior', timeBudgetMin: 180 });
    expect(item.visibleTests[0].path).toBe('tests/visible/booking.test.ts');
    const raw = JSON.stringify(body);
    for (const leak of [COMPANY, 'demo-co-northstream', NEED, 'companyId', 'vacancyId', 'salary', '90000', '130000', 'Backend-разработчик (Junior)']) {
      expect(raw, leak).not.toContain(leak);
    }
    const fe = await (await feed(jsonRequest('/x', 'GET', undefined, cand('p-fe')))).json();
    expect(fe.items).toEqual([]);
    expect((await feed(jsonRequest('/x', 'GET', undefined, EMP))).status).toBe(403);
  });

  it('сдача без «взять» — 409; взять идемпотентно; заготовка — zip без скрытых тестов', async () => {
    const early = await submit(jsonRequest('/x', 'POST', { repoUrl: 'https://github.com/demo/reference-solution' }, cand('p-be')), params({ id: taskId }));
    expect(early.status).toBe(409);
    const t1 = await (await take(jsonRequest('/x', 'POST', undefined, cand('p-be')), params({ id: taskId }))).json();
    const t2 = await (await take(jsonRequest('/x', 'POST', undefined, cand('p-be')), params({ id: taskId }))).json();
    expect(t1.expiresAt).toBe(t2.expiresAt);
    expect(t2.active).toBe(1);

    const zip = await skeleton(jsonRequest('/x', 'GET', undefined, cand('p-be')), params({ id: taskId }));
    expect(zip.headers.get('content-type')).toBe('application/zip');
    const buf = Buffer.from(await zip.arrayBuffer());
    const names = zipNames(buf);
    expect(names).toEqual(expect.arrayContaining(['be-webapi-junior-booking/TASK.md', 'be-webapi-junior-booking/contract.md', 'be-webapi-junior-booking/src/app.ts', 'be-webapi-junior-booking/tests/visible/booking.test.ts']));
    expect(names.some((n) => /hidden|reference/.test(n))).toBe(false);
    expect(zipText(buf, 'be-webapi-junior-booking/TASK.md')).toContain('## Требования');

    const detail = await (await getTask(jsonRequest('/x', 'GET', undefined, cand('p-be')), params({ id: taskId }))).json();
    expect(detail.contractMd).toContain('POST /appointments');
    expect(detail.my.taken).toBe(true);
  });

  it('сдача: не GitHub — 400; проверка stub-runner → checked, кандидату без скрытых тестов', async () => {
    const bad = await submit(jsonRequest('/x', 'POST', { repoUrl: 'https://gitlab.com/a/b' }, cand('p-be')), params({ id: taskId }));
    expect(bad.status).toBe(400);
    const res = await submit(jsonRequest('/x', 'POST', { repoUrl: 'https://github.com/demo/reference-solution.git', aiLogText: 'Спросил у ИИ про пересечение интервалов. Пиши мне на me@example.test' }, cand('p-be')), params({ id: taskId }));
    expect(res.status).toBe(202);
    const sub = await res.json();
    expect(sub.repoUrl).toBe('https://github.com/demo/reference-solution');
    expect(sub.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const done = await waitChecked(sub.id, cand('p-be'));
    expect(done.status).toBe('checked');
    expect(done.result.tests).toEqual({ passed: 15, total: 15, score: 100 });
    expect(done.result.visibleTests.map((t: { name: string }) => t.name)).toEqual(['POST /appointments создаёт запись', 'GET /appointments/:id возвращает запись', 'пересечение слотов — 409']);
    expect(done.result.hiddenTests).toBeUndefined();
    expect(JSON.stringify(done)).not.toContain('скрытый тест');
    expect(done.result.rubric.results).toHaveLength(4);
    expect(done.result.lint.status).toBe('skipped');
    expect(done.result.platformOwnedViolations).toEqual([]);
    // чужой кандидат не видит чужую сдачу
    expect((await getSubmission(jsonRequest('/x', 'GET', undefined, cand('p-fe')), params({ id: sub.id }))).status).toBe(404);
  });

  it('Г3 (ADR 0005): без согласия на оценку ИИ скрытые тесты считаются, LLM-рубрика — нет', async () => {
    await prisma.consent.updateMany({ where: { user: { candidateId: 'p-be' }, kind: 'ai_assessment' }, data: { revokedAt: new Date() } });
    const res = await submit(jsonRequest('/x', 'POST', { repoUrl: 'https://github.com/demo/reference-solution' }, cand('p-be')), params({ id: taskId }));
    expect(res.status).toBe(202);
    const subId = (await res.json()).id as string;
    const done = await waitChecked(subId, cand('p-be'));
    expect(done.status).toBe('checked');
    expect(done.result.tests).toEqual({ passed: 15, total: 15, score: 100 });
    expect(done.result.rubric.results).toHaveLength(4);
    expect(done.result.rubric.results.every((r: { passed: boolean | null; flag?: string }) => r.passed === null && r.flag === 'not_evaluated')).toBe(true);
    // состояние общее для файла: убираем эту сдачу и возвращаем Г3
    await prisma.projectSubmission.delete({ where: { id: subId } });
    await grantConsents('u-p-be', ['ai_assessment']);
  });

  it('работодатель: сдачи под псевдонимом, без ссылки на репозиторий, с таблицей критериев и скрытыми тестами', async () => {
    const res = await employerSubs(jsonRequest(`/api/employer/project-submissions?needId=${NEED}`, 'GET', undefined, EMP));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.candidate.displayName).toMatch(/^Кандидат #[0-9A-F]{6}$/);
    expect(item.candidate.category).toBe('Backend · Junior');
    expect(item.repoUrl).toBeNull();
    expect(item.result.hiddenTests).toHaveLength(15);
    expect(item.result.rubric.results.map((r: { id: string }) => r.id)).toEqual(['req:be.idempotency', 'req:be.rest-design', 'wish:1', 'wish:2']);
    expect(item.aiLogText).not.toContain('me@example.test');
    expect(JSON.stringify(body)).not.toContain('Имя p-be');
    const other = await employerSubs(jsonRequest(`/x?needId=${NEED}`, 'GET', undefined, OTHER));
    expect(other.status).toBe(404);
  });

  it('пригласить на защиту: приглашение с вилкой + сессия защиты; повторно — 409; перегенерация задания — 409', async () => {
    const list = await (await employerSubs(jsonRequest(`/x?needId=${NEED}`, 'GET', undefined, EMP))).json();
    const subId = list.items[0].id;
    const body = { message: 'Разберём ваш проект записи на приём', salaryFrom: 100000, salaryTo: 120000 };
    expect((await inviteDefense(jsonRequest('/x', 'POST', body, OTHER), params({ id: subId }))).status).toBe(404);
    const res = await inviteDefense(jsonRequest('/x', 'POST', body, EMP), params({ id: subId }));
    expect(res.status).toBe(201);
    const out = await res.json();
    // Ожидающая защита: CallSession kind=defense, pending, связана с сабмитом; повторный запрос — та же.
    const pending = await prisma.callSession.findUniqueOrThrow({ where: { id: out.callSessionId } });
    expect(pending).toMatchObject({ candidateId: 'p-be', kind: 'defense', status: 'pending', projectSubmissionId: subId });
    expect((await requestProjectDefense('p-be', subId)).callSessionId).toBe(out.callSessionId);
    await expect(requestProjectDefense('p-fe', subId)).rejects.toMatchObject({ status: 404 });
    const inv = await prisma.invitation.findUniqueOrThrow({ where: { id: out.invitationId } });
    expect(inv).toMatchObject({ candidateId: 'p-be', vacancyId: NEED, salaryFrom: 100000, salaryTo: 120000, companyId: DEMO_EMPLOYER.companyId });
    expect(defenseCalls).toEqual([{ submissionId: subId, candidateId: 'p-be', invitationId: out.invitationId, companyId: DEMO_EMPLOYER.companyId }]);
    expect((await inviteDefense(jsonRequest('/x', 'POST', body, EMP), params({ id: subId }))).status).toBe(409);
    const after = await (await employerSubs(jsonRequest(`/x?needId=${NEED}`, 'GET', undefined, EMP))).json();
    expect(after.items[0].defense).toEqual({ invitationId: out.invitationId, invitationStatus: 'sent' });
    // после принятия приглашения — имя и ссылка на репозиторий
    await prisma.invitation.update({ where: { id: out.invitationId }, data: { status: 'accepted' } });
    await discloseAccepted(); // Г5 (ADR 0005)
    const open = await (await employerSubs(jsonRequest(`/x?needId=${NEED}`, 'GET', undefined, EMP))).json();
    expect(open.items[0]).toMatchObject({ repoUrl: 'https://github.com/demo/reference-solution', candidate: { displayName: 'Имя p-be' } });

    const regen = await needProject(jsonRequest('/x', 'POST', {}, EMP), params({ id: NEED }));
    expect(regen.status).toBe(409);

    // Кандидат начинает защиту сам (после согласия на запись) — активируется та же сессия, не вторая.
    await prisma.consent.create({ data: { userId: 'u-p-be', kind: 'call_recording', version: CALL_RECORDING_CONSENT_VERSION } });
    const started = await startDefenseRoom('p-be', { mode: 'project', projectSubmissionId: subId }, getLlm({ candidateId: 'p-be' }), { loadSnapshot: async (url) => demoRepoSnapshot(url) });
    expect(started.sessionId).toBe(out.callSessionId);
    expect(await prisma.callSession.findUniqueOrThrow({ where: { id: out.callSessionId }, select: { status: true } })).toEqual({ status: 'active' });
    expect(await prisma.callSession.count({ where: { projectSubmissionId: subId } })).toBe(1);
    expect(await prisma.defenseRoomPlan.count({ where: { callSessionId: out.callSessionId } })).toBe(1);
  });

  it('runner упал — failed с понятной причиной; повторная сдача разрешена, после срока — с пометкой late', async () => {
    const task = await upsertProjectTask({ companyId: 'demo-co-northstream', companyName: COMPANY }, 'demo-vac-be-m-1', { requiredCatalogIds: [], wishesText: null, visibility: 'open' });
    await makeCandidate('p-mid', 'backend', 'middle');
    await take(jsonRequest('/x', 'POST', undefined, cand('p-mid')), params({ id: task.id }));
    const res = await submit(jsonRequest('/x', 'POST', { repoUrl: 'https://github.com/demo/runner-fail' }, cand('p-mid')), params({ id: task.id }));
    const done = await waitChecked((await res.json()).id, cand('p-mid'));
    expect(done.status).toBe('failed');
    expect(done.error).toMatch(/лимит времени/);
    // Срок истёк — сдать можно, работодатель видит «после срока».
    await prisma.projectAssignment.updateMany({ where: { projectTaskId: task.id, candidateId: 'p-mid' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const again = await submit(jsonRequest('/x', 'POST', { repoUrl: 'https://github.com/demo/starter-only' }, cand('p-mid')), params({ id: task.id }));
    const second = await waitChecked((await again.json()).id, cand('p-mid'));
    expect(second.result.tests).toMatchObject({ passed: 0, score: 0 });
    const list = await (await employerSubs(jsonRequest('/x?needId=demo-vac-be-m-1', 'GET', undefined, EMP))).json();
    expect(list.items.map((i: { late: boolean }) => i.late)).toEqual([true, false]);
  });

  it('открытое задание: только своё направление и грейд не выше категории; без категории — Junior; без направления — 403', async () => {
    const mid = (await prisma.projectTask.findUniqueOrThrow({ where: { vacancyId: 'demo-vac-be-m-1' } })).id;
    await makeCandidate('p-nocat', 'backend', null);
    await makeCandidate('p-nodir', null, null);
    const takeAs = async (who: string, id: string) => take(jsonRequest('/x', 'POST', undefined, cand(who)), params({ id }));
    // Junior не берёт Middle; frontend не берёт backend; без категории — только Junior; без направления — ничего.
    expect((await takeAs('p-be', mid)).status).toBe(403);
    expect((await getTask(jsonRequest('/x', 'GET', undefined, cand('p-be')), params({ id: mid }))).status).toBe(403);
    expect((await takeAs('p-fe', taskId)).status).toBe(403);
    expect((await takeAs('p-nocat', mid)).status).toBe(403);
    expect((await takeAs('p-nocat', taskId)).status).toBe(200);
    expect((await takeAs('p-nodir', taskId)).status).toBe(403);
    // Лента согласована: middle видит и Junior, и Middle; junior — без Middle; без направления — пусто.
    const ids = async (who: string) => ((await (await feed(jsonRequest('/x', 'GET', undefined, cand(who)))).json()).items as { id: string }[]).map((i) => i.id);
    expect(await ids('p-mid')).toEqual(expect.arrayContaining([mid, taskId]));
    expect(await ids('p-be')).not.toContain(mid);
    expect(await ids('p-nodir')).toEqual([]);
  });

  it('лента: своя подкатегория выше соседних того же направления; грейд не выше категории', async () => {
    // У be-m-1 шаблон по умолчанию — первая подкатегория направления (backend.web-api); добавляем Middle под интеграции.
    await prisma.vacancy.create({
      data: { id: 'demo-vac-be-m-int', companyId: 'demo-co-northstream', title: 'Интеграции (Middle)', specialization: 'backend', grade: 'middle', subcategoryId: 'backend.integrations', salaryFrom: 150000, salaryTo: 200000, needs: [], stack: ['Node.js'] },
    });
    // подкатегория берётся из потребности, если в запросе её нет
    const int = await upsertProjectTask({ companyId: 'demo-co-northstream', companyName: COMPANY }, 'demo-vac-be-m-int', { requiredCatalogIds: [], wishesText: null, visibility: 'open' });
    expect(int.template.id).toBe('be-integrations-middle-delivery');

    const makePref = async (id: string, subcategoryId: string | null) => {
      await makeCandidate(id, 'backend', 'middle');
      await prisma.candidateCategory.updateMany({ where: { candidateId: id }, data: { subcategoryId } });
    };
    await makePref('p-pref-int', 'backend.integrations');
    await makePref('p-pref-web', 'backend.web-api');
    // Подкатегория только из онбординга (категории из теста с подкатегорией нет) — тоже работает.
    await makeCandidate('p-onb-int', 'backend', 'middle');
    await prisma.candidate.update({ where: { id: 'p-onb-int' }, data: { subcategoryId: 'backend.integrations' } });

    const subs = async (who: string) => ((await (await feed(jsonRequest('/x', 'GET', undefined, cand(who)))).json()).items as { subcategoryId: string }[]).map((i) => i.subcategoryId);
    const a = await subs('p-pref-int');
    expect(a[0]).toBe('backend.integrations');
    expect(a.slice(1).every((x) => x === 'backend.web-api')).toBe(true);
    const b = await subs('p-pref-web');
    expect(b.at(-1)).toBe('backend.integrations');
    expect(b.slice(0, -1).every((x) => x === 'backend.web-api')).toBe(true);
    expect((await subs('p-onb-int'))[0]).toBe('backend.integrations');
    // Все три видят одно и то же множество (Junior и Middle своего направления) — порядок разный.
    expect([...a].sort()).toEqual([...b].sort());
  });

  it('две параллельные сдачи одного задания: одна принята, вторая — 409', async () => {
    await makeCandidate('p-par', 'backend', 'junior');
    expect((await take(jsonRequest('/x', 'POST', undefined, cand('p-par')), params({ id: taskId }))).status).toBe(200);
    const send = () => submit(jsonRequest('/x', 'POST', { repoUrl: 'https://github.com/demo/reference-solution' }, cand('p-par')), params({ id: taskId }));
    const statuses = (await Promise.all([send(), send()])).map((r) => r.status).sort();
    expect(statuses).toEqual([202, 409]);
    expect(await prisma.projectSubmission.count({ where: { candidateId: 'p-par', projectTaskId: taskId } })).toBe(1);
  });

  it(`лимит: не больше ${PROJECT_MAX_ACTIVE} взятых несданных`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < PROJECT_MAX_ACTIVE + 1; i++) {
      const v = await prisma.vacancy.create({ data: { companyId: 'demo-co-northstream', title: `Backend junior ${i}`, specialization: 'backend', grade: 'junior', salaryFrom: 1, salaryTo: 2, needs: [] } });
      ids.push((await upsertProjectTask({ companyId: 'demo-co-northstream', companyName: COMPANY }, v.id, { requiredCatalogIds: [], wishesText: null, visibility: 'open' })).id);
    }
    for (const id of ids.slice(0, PROJECT_MAX_ACTIVE)) expect((await take(jsonRequest('/x', 'POST', undefined, cand('p-lim')), params({ id }))).status).toBe(200);
    const over = await take(jsonRequest('/x', 'POST', undefined, cand('p-lim')), params({ id: ids[PROJECT_MAX_ACTIVE]! }));
    expect(over.status).toBe(429);
    expect((await over.json()).error.code).toBe('project_limit');
  });

  it('задание по приглашению: в ленте и по id — только приглашённому', async () => {
    const t = await upsertProjectTask({ companyId: 'demo-co-northstream', companyName: COMPANY }, 'demo-vac-fe-j-2', { requiredCatalogIds: [], wishesText: null, visibility: 'invited' });
    const before = await (await feed(jsonRequest('/x', 'GET', undefined, cand('p-fe')))).json();
    expect(before.items.map((i: { id: string }) => i.id)).not.toContain(t.id);
    expect((await getTask(jsonRequest('/x', 'GET', undefined, cand('p-fe')), params({ id: t.id }))).status).toBe(404);
    await prisma.invitation.create({ data: { candidateId: 'p-fe', vacancyId: 'demo-vac-fe-j-2', companyId: 'demo-co-northstream', salaryFrom: 1, salaryTo: 2 } });
    const after = await (await feed(jsonRequest('/x', 'GET', undefined, cand('p-fe')))).json();
    expect(after.items.find((i: { id: string }) => i.id === t.id)?.invited).toBe(true);
  });
  it('сдача подходом (ТЗ: «решить или предложить подход»): без кода и балла, рубрика по тексту; работодатель видит текст без контактов; защиты нет', async () => {
    await makeCandidate('p-appr', 'backend', 'junior');
    await take(jsonRequest('/x', 'POST', undefined, cand('p-appr')), params({ id: taskId }));
    const short = await submit(jsonRequest('/x', 'POST', { kind: 'approach', approachText: 'Сделаю API.' }, cand('p-appr')), params({ id: taskId }));
    expect(short.status).toBe(400);
    const text =
      'Подход: сначала опишу модель слота и записи, затем валидацию входа по контракту с понятными сообщениями об ошибках на русском. ' +
      'Пересечение интервалов проверю в отдельном модуле сравнением границ с учётом частичного наложения и покрою его юнит-тестами. ' +
      'Отмена меняет статус, а не удаляет запись; список на день фильтруется по менеджеру. Идемпотентность и REST-коды возьму из контракта. ' +
      'Связь со мной: me@example.test';
    const res = await submit(jsonRequest('/x', 'POST', { kind: 'approach', approachText: text, aiLogText: '' }, cand('p-appr')), params({ id: taskId }));
    expect(res.status).toBe(202);
    const sub = await res.json();
    expect(sub.kind).toBe('approach');
    expect(sub.repoUrl).toBe('');
    expect(sub.commitSha).toBeNull();
    const done = await waitChecked(sub.id, cand('p-appr'));
    expect(done.status).toBe('checked');
    expect(done.result.kind).toBe('approach');
    expect(done.result.tests).toEqual({ passed: 0, total: 0, score: 0 });
    expect(done.result.visibleTests).toEqual([]);
    expect(done.result.rubric.results).toHaveLength(4);
    // работодатель: формат, текст подхода без контактов, репозитория нет
    const list = await (await employerSubs(jsonRequest(`/x?needId=${NEED}`, 'GET', undefined, EMP))).json();
    const item = list.items.find((i: { id: string }) => i.id === sub.id);
    expect(item.kind).toBe('approach');
    expect(item.approachText).toContain('Пересечение интервалов');
    expect(item.approachText).not.toContain('me@example.test');
    expect(item.repoUrl).toBeNull();
    expect(item.result.hiddenTests).toEqual([]);
    // приглашение по сдаче подходом — обычное, созвон-защита не создаётся
    const before = defenseCalls.length;
    const inv = await inviteDefense(jsonRequest('/x', 'POST', { message: 'Понравился подход, обсудим детали на созвоне', salaryFrom: 100000, salaryTo: 130000 }, EMP), params({ id: sub.id }));
    expect(inv.status).toBe(201);
    expect((await inv.json()).callSessionId).toBeNull();
    expect(defenseCalls.length).toBe(before);
    await expect(startDefenseRoom('p-appr', { mode: 'project', projectSubmissionId: sub.id, ai: true }, getLlm())).rejects.toThrow(/по сдаче с кодом/);
  });
});

/** Имена файлов из central directory zip. */
function zipNames(buf: Buffer): string[] {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let off = buf.readUInt32LE(end + 16);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = buf.readUInt16LE(off + 28);
    out.push(buf.subarray(off + 46, off + 46 + len).toString('utf8'));
    off += 46 + len + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
  }
  return out;
}

function zipText(buf: Buffer, name: string): string {
  let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const size = buf.readUInt32LE(off + 18);
    const len = buf.readUInt16LE(off + 26);
    const extra = buf.readUInt16LE(off + 28);
    const n = buf.subarray(off + 30, off + 30 + len).toString('utf8');
    const data = buf.subarray(off + 30 + len + extra, off + 30 + len + extra + size);
    if (n === name) return inflateRawSync(data).toString('utf8');
    off += 30 + len + extra + size;
  }
  throw new Error(`нет ${name}`);
}
