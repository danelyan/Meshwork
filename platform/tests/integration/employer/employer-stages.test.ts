// Подборка под потребность с учётом ступеней ADR 0003 (lane employer-card): проект под ЭТУ потребность поднимает
// кандидата, созвон и защита видны без цитат, пояснения рубрики маскируются до принятого приглашения.
import { POST as needProject } from '@/app/api/employer/needs/[id]/project/route';
import { GET as matches } from '@/app/api/employer/vacancies/[id]/matches/route';
import type { Explanation } from '@/server/employer/ranking';
import { loadDefenseRooms, loadStageEvidence } from '@/server/employer/stages-load';
import { createInvitation } from '@/server/employer/invitations';
import { signUserSession } from '@/server/session';

import { DEMO_EMPLOYER, seedAuth } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { seedEmployer } from '../../../prisma/seed/employer';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';
import { discloseAccepted } from '../../helpers/consents';

const EMP = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: DEMO_EMPLOYER.profileId })}`;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const NEED = 'demo-vac-be-j-1'; // backend junior, Северный Поток
const SECRET_QUOTE = 'СЕКРЕТНАЯ ЦИТАТА ИЗ ТРАНСКРИПТА';
const PROFILE = { employerProfileId: DEMO_EMPLOYER.profileId, companyId: 'demo-co-northstream' };

async function makeCandidate(id: string) {
  await prisma.candidate.create({ data: { id, name: `Имя ${id}`, email: `${id}@example.test`, specialization: 'backend', consentAt: new Date() } });
  await prisma.candidateCategory.create({ data: { candidateId: id, specialization: 'backend', grade: 'junior', subcategoryId: 'backend.web-api' } });
  // Одинаковое подтверждённое утверждение у всех: различать должны только ступени.
  const cat = await prisma.claimCatalog.findUniqueOrThrow({ where: { id: 'be.rest-design' } });
  await prisma.claim.create({
    data: {
      candidateId: id,
      catalogId: cat.id,
      statement: cat.statement,
      level: 'self_reported',
      quote: 'REST API',
      sourceRef: 'cv.pdf#p1',
      sourceKind: 'resume',
      limits: '',
      suggestedProof: [],
      status: 'confirmed',
    },
  });
}

async function checkedSubmission(candidateId: string, taskId: string, score: number, evidence: string) {
  return prisma.projectSubmission.create({
    data: {
      projectTaskId: taskId,
      candidateId,
      repoUrl: `https://github.com/${candidateId}/solution`,
      status: 'checked',
      checkedAt: new Date(),
      resultJson: {
        tests: { passed: Math.round(score * 5), total: 5, score },
        visibleTests: [],
        hiddenTests: [],
        lint: { status: 'skipped', note: '' },
        rubric: {
          source: 'fallback',
          injectionSuspected: false,
          results: [{ id: 'req:be.rest-design', text: 'REST-дизайн', source: 'required', passed: true, evidence, file: 'src/api.ts' }],
        },
        platformOwnedViolations: [],
        runner: { mode: 'stub' },
      },
    },
  });
}

async function items() {
  const res = await matches(jsonRequest('/x', 'GET', undefined, EMP), params({ id: NEED }));
  expect(res.status).toBe(200);
  return (await res.json()).items as { candidateId: string; score: number; rank: number; explanation: Explanation & { project: NonNullable<Explanation['project']> }; defenseRoom?: { sessionId: string; status: string } | null; candidate: { contacts: unknown } }[];
}

describe('подборка со ступенями ADR 0003 (БД)', () => {
  let taskId = '';
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
    await prisma.candidate.deleteMany({ where: { id: { startsWith: 'demo-pool' } } });
    for (const id of ['ec-proj', 'ec-plain', 'ec-other']) await makeCandidate(id);
    const res = await needProject(jsonRequest('/x', 'POST', { requiredCatalogIds: ['be.rest-design'] }, EMP), params({ id: NEED }));
    expect(res.status).toBe(201);
    taskId = (await res.json()).id;
  });
  afterAll(() => prisma.$disconnect());

  it('кандидат с проверенным сабмитом под эту потребность выше такого же без него; проект под чужую потребность баллов не даёт', async () => {
    const before = await items();
    const base = before.find((i) => i.candidateId === 'ec-plain')!.score;
    expect(before.find((i) => i.candidateId === 'ec-proj')!.score).toBe(base);

    // Старая сдача того же задания с низким баллом не должна перекрыть свежую (distinct по заданию берёт последнюю проверенную).
    const old = await checkedSubmission('ec-proj', taskId, 0.2, 'старая сдача');
    await prisma.projectSubmission.update({ where: { id: old.id }, data: { checkedAt: new Date('2026-10-01T00:00:00Z') } });
    await checkedSubmission('ec-proj', taskId, 1, 'Ключ хранится; автор ivan@example.com');
    // Проект ec-other сдан под задание ДРУГОЙ потребности (другая компания).
    await prisma.company.create({ data: { id: 'co-x', name: 'Другая', isDemo: false } });
    await prisma.vacancy.create({ data: { id: 'v-x', companyId: 'co-x', title: 'X', specialization: 'backend', grade: 'junior', salaryFrom: 1, salaryTo: 2, needs: [{ catalogId: 'be.rest-design', weight: 1 }], subcategoryId: 'backend.web-api' } });
    const tpl = await prisma.projectTask.findUniqueOrThrow({ where: { id: taskId } });
    const other = await prisma.projectTask.create({
      data: { vacancyId: 'v-x', templateId: tpl.templateId, specialization: 'backend', grade: 'junior', subcategoryId: 'backend.web-api', specJson: tpl.specJson as object, rubricJson: { criteria: [] }, requiredCatalogIds: [] },
    });
    await checkedSubmission('ec-other', other.id, 1, 'тайна чужой потребности');

    const after = await items();
    const proj = after.find((i) => i.candidateId === 'ec-proj')!;
    const plain = after.find((i) => i.candidateId === 'ec-plain')!;
    const foreign = after.find((i) => i.candidateId === 'ec-other')!;
    expect(proj.score).toBeGreaterThan(plain.score);
    expect(proj.rank).toBeLessThan(plain.rank);
    expect(proj.explanation.project.own!.score).toBe(1);
    expect(foreign.score).toBe(plain.score);
    // Чужой проект — только подкатегория и балл, без критериев и вакансии.
    expect(foreign.explanation.project.own).toBeNull();
    expect(foreign.explanation.project.others).toHaveLength(1);
    expect(JSON.stringify(foreign.explanation)).not.toMatch(/тайна чужой|v-x|co-x/);
  });

  it('до принятого приглашения доказательства рубрики маскируются, цитат созвона нет; после — e-mail виден, есть комната защиты', async () => {
    await prisma.callSession.create({
      data: {
        candidateId: 'ec-proj',
        kind: 'qualifying',
        status: 'finished',
        finishedAt: new Date(),
        policyVersion: 'v',
        transcriptJson: [],
        verdictJson: {
          kind: 'qualifying',
          depthMap: [{ topic: 'REST', catalogId: 'be.rest-design', claimed: true, claimStatement: SECRET_QUOTE, probed: 2, maxLevel: 2, confirmed: true, scores: { depth: 2, why: 2, boundary: 1, completion: 1 }, total: 6, quote: SECRET_QUOTE, runs: [] }],
          runs: 3, validRuns: 3, upgradedCatalogIds: [], summary: 's', evaluatedAt: '2026-10-10T10:00:00.000Z', thresholdVersion: 't', disclaimer: 'd',
        },
      },
    });
    const sub = await prisma.projectSubmission.findFirstOrThrow({ where: { candidateId: 'ec-proj' } });
    await prisma.callSession.create({
      data: {
        candidateId: 'ec-proj',
        kind: 'defense',
        status: 'finished',
        finishedAt: new Date(),
        projectSubmissionId: sub.id,
        policyVersion: 'v',
        transcriptJson: [],
        verdictJson: { scores: null, total: 3, passed: false, runs: [3], flags: ['strong_project_weak_defense'], summary: 's', quotes: [SECRET_QUOTE], projectScore: 1, answered: 4, employerQuestions: { asked: 0, answered: 0 }, thresholdVersion: 't', evaluatedAt: '2026-10-10T11:00:00.000Z' },
      },
    });

    const withStages = await items();
    const raw = JSON.stringify(withStages);
    expect(raw).not.toContain(SECRET_QUOTE);
    const proj = withStages.find((i) => i.candidateId === 'ec-proj')!;
    expect(proj.explanation.depthMap).toMatchObject({ confirmed: 1, matchedNeed: 1 });
    expect(proj.explanation.defense).toMatchObject({ score: 3, flags: ['strong_project_weak_defense'] });
    expect(proj.explanation.project.own!.criteria[0]!.evidence).not.toContain('ivan@example.com');
    expect(proj.candidate.contacts).toBeNull();
    expect(proj.defenseRoom ?? null).toBeNull();

    // Кандидат принимает приглашение; создана ожидающая защита по его сабмиту.
    const inv = await createInvitation(PROFILE, { candidateId: 'ec-proj', vacancyId: NEED, message: 'Приглашаем на защиту проекта', salaryFrom: 100000, salaryTo: 120000 });
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: 'accepted' } });
    await discloseAccepted(); // Г5 (ADR 0005)
    const pending = await prisma.callSession.create({ data: { candidateId: 'ec-proj', kind: 'defense', status: 'pending', projectSubmissionId: sub.id, policyVersion: 'v', transcriptJson: [] } });
    // Ожидающая защита по сабмиту другой компании кнопкой не становится.
    const foreignSub = await prisma.projectSubmission.findFirstOrThrow({ where: { candidateId: 'ec-other' } });
    await prisma.callSession.create({ data: { candidateId: 'ec-proj', kind: 'defense', status: 'pending', projectSubmissionId: foreignSub.id, policyVersion: 'v', transcriptJson: [] } });

    const accepted = (await items()).find((i) => i.candidateId === 'ec-proj')!;
    expect(accepted.candidate.contacts).not.toBeNull();
    expect(accepted.explanation.project.own!.criteria[0]!.evidence).toContain('ivan@example.com');
    expect(accepted.defenseRoom).toEqual({ sessionId: pending.id, status: 'pending' });
  });

  it('loadDefenseRooms: только своя компания и сессии без сабмита; идущая важнее ожидающей', async () => {
    await prisma.candidate.deleteMany({ where: { id: 'ec-room' } });
    await makeCandidate('ec-room');
    const own = await checkedSubmission('ec-room', taskId, 0.5, 'x');
    const other = await prisma.projectTask.findFirstOrThrow({ where: { vacancyId: 'v-x' } });
    const foreign = await checkedSubmission('ec-room', other.id, 0.5, 'y');
    const mk = (status: 'pending' | 'active' | 'finished', projectSubmissionId: string | null) =>
      prisma.callSession.create({ data: { candidateId: 'ec-room', kind: 'defense', status, projectSubmissionId, policyVersion: 'v', transcriptJson: [] } });
    await mk('active', foreign.id); // чужая компания: не показываем, хотя идёт
    await mk('finished', own.id);
    expect((await loadDefenseRooms(PROFILE.companyId, ['ec-room'])).size).toBe(0);
    const pending = await mk('pending', own.id);
    expect((await loadDefenseRooms(PROFILE.companyId, ['ec-room'])).get('ec-room')).toEqual({ sessionId: pending.id, status: 'pending' });
    const active = await mk('active', null);
    expect((await loadDefenseRooms(PROFILE.companyId, ['ec-room'])).get('ec-room')).toEqual({ sessionId: active.id, status: 'active' });
    expect((await loadDefenseRooms(PROFILE.companyId, [])).size).toBe(0);
  });

  it('пустой последний вердикт и результат не затеняют старый валидный', async () => {
    await prisma.candidate.deleteMany({ where: { id: 'ec-shadow' } });
    await makeCandidate('ec-shadow');
    await prisma.callSession.create({
      data: {
        candidateId: 'ec-shadow', kind: 'qualifying', status: 'finished', finishedAt: new Date('2026-10-01T00:00:00Z'), policyVersion: 'v', transcriptJson: [],
        verdictJson: { kind: 'qualifying', depthMap: [{ topic: 'REST', catalogId: 'be.rest-design', claimed: true, probed: 1, confirmed: true, total: 6 }], evaluatedAt: 'old' },
      },
    });
    await prisma.callSession.create({ data: { candidateId: 'ec-shadow', kind: 'qualifying', status: 'finished', finishedAt: new Date(), policyVersion: 'v', transcriptJson: [] } });
    const good = await checkedSubmission('ec-shadow', taskId, 0.7, 'ok');
    await prisma.projectSubmission.update({ where: { id: good.id }, data: { checkedAt: new Date('2026-10-01T00:00:00Z') } });
    await prisma.projectSubmission.create({ data: { projectTaskId: taskId, candidateId: 'ec-shadow', repoUrl: 'https://github.com/x/y', status: 'checked', checkedAt: new Date() } });
    const ev = (await loadStageEvidence(['ec-shadow'])).get('ec-shadow')!;
    expect(ev.calls?.qualifying?.confirmedTopics).toEqual(['REST']);
    expect(ev.projects).toHaveLength(1);
    expect(ev.projects![0]!.score).toBe(0.7);
  });
});
