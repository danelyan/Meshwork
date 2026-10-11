// ADR 0008 «Что работодатель видит и когда»: до accepted из защит виден только вердикт ИИ-защиты; живая защита
// видна только компании, по чьему приглашению прошла (X), и не видна чужой (Y) – ни в подборке, ни в карточке,
// ни через ассистента, ни в списке защит, ни в комнате. Порядок выдачи от живой защиты не зависит.
import { GET as matches } from '@/app/api/employer/vacancies/[id]/matches/route';
import { employerTools } from '@/server/agent/employer/tools';
import type { EmployerToolContext } from '@/server/agent/employer/types';
import { resolveCallAccess } from '@/server/call/access';
import { getCallForViewer, getRecording, getVideo } from '@/server/call/service';
import { listEmployerCalls } from '@/server/defense-room';
import { resolveViewer } from '@/server/defense-room/access';
import { createInvitation } from '@/server/employer/invitations';
import type { Explanation } from '@/server/employer/ranking';
import { loadStageEvidence } from '@/server/employer/stages-load';
import { signUserSession } from '@/server/session';

import { DEMO_EMPLOYER, seedAuth } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { seedEmployer } from '../../../prisma/seed/employer';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { discloseAccepted, grantEmployerConsents } from '../../helpers/consents';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const Y = { employerProfileId: DEMO_EMPLOYER.profileId, companyId: DEMO_EMPLOYER.companyId, companyName: 'Северный Поток', companyDescription: null };
const X = { employerProfileId: 'ep-dv-x', companyId: 'co-dv-x', companyName: 'Икс', companyDescription: null };
const EMP_Y = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: Y.employerProfileId })}`;
const NEED_Y = 'demo-vac-be-j-1'; // backend junior, Северный Поток
const CAND = 'dv-cand';
const LIVE_SECRET = 'ВЫВОД ЖИВОЙ ЗАЩИТЫ С X';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const verdict = (total: number, flags: string[], summary: string, at: string) => ({
  scores: null, total, passed: total >= 5, runs: [total], flags, summary, quotes: [], projectScore: 1, answered: 4,
  employerQuestions: { asked: 0, answered: 0 }, thresholdVersion: 't', evaluatedAt: at,
});

type Item = { candidateId: string; score: number; rank: number; explanation: Explanation };
async function matchItem(): Promise<Item> {
  const res = await matches(jsonRequest('/x', 'GET', undefined, EMP_Y), params({ id: NEED_Y }));
  expect(res.status).toBe(200);
  return ((await res.json()).items as Item[]).find((i) => i.candidateId === CAND)!;
}

describe('видимость защит работодателю (ADR 0008)', () => {
  let subId = '';
  let aiId = '';
  let liveId = '';
  let scoreBefore = 0;

  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
    await grantEmployerConsents([DEMO_EMPLOYER.userId]);
    await prisma.candidate.create({ data: { id: CAND, name: 'Имя Кандидата', email: 'dv@example.test', specialization: 'backend', consentAt: new Date() } });
    await prisma.candidateCategory.create({ data: { candidateId: CAND, specialization: 'backend', grade: 'junior', subcategoryId: 'backend.web-api' } });
    const cat = await prisma.claimCatalog.findUniqueOrThrow({ where: { id: 'be.rest-design' } });
    await prisma.claim.create({
      data: { candidateId: CAND, catalogId: cat.id, statement: cat.statement, level: 'self_reported', quote: 'REST API', sourceRef: 'cv.pdf#p1', sourceKind: 'resume', limits: '', suggestedProof: [], status: 'confirmed' },
    });
    // Компания X: своя вакансия, задание и сабмит кандидата под него.
    await prisma.company.create({ data: { id: X.companyId, name: X.companyName, isDemo: false } });
    await prisma.user.create({ data: { id: 'u-dv-x', name: 'HR X', role: 'employer' } });
    await prisma.employerProfile.create({ data: { id: X.employerProfileId, userId: 'u-dv-x', companyId: X.companyId } });
    await grantEmployerConsents(['u-dv-x']);
    await prisma.vacancy.create({
      data: { id: 'v-dv-x', companyId: X.companyId, title: 'X', specialization: 'backend', grade: 'junior', salaryFrom: 1, salaryTo: 2, needs: [{ catalogId: 'be.rest-design', weight: 1 }], subcategoryId: 'backend.web-api' },
    });
    const tpl = await prisma.projectTemplate.create({
      data: { id: 'tpl-dv', subcategoryId: 'backend.web-api', specialization: 'backend', grade: 'junior', title: 'T', contractMd: '', dirRef: 'd', hiddenTestsRef: 'h', visibleTestsRef: 'v', image: 'i', timeBudgetMin: 60 },
    });
    const task = await prisma.projectTask.create({
      data: { vacancyId: 'v-dv-x', templateId: tpl.id, specialization: 'backend', grade: 'junior', subcategoryId: 'backend.web-api', specJson: {}, rubricJson: { criteria: [] }, requiredCatalogIds: [] },
    });
    subId = (await prisma.projectSubmission.create({ data: { projectTaskId: task.id, candidateId: CAND, repoUrl: 'https://github.com/dv/solution', status: 'submitted' } })).id;

    // ИИ-защита (старше) и живая защита по приглашению X (свежее): раньше в выдачу шла самая свежая – живая.
    aiId = (await prisma.callSession.create({
      data: { candidateId: CAND, kind: 'defense', aiDefense: true, status: 'finished', finishedAt: new Date('2026-10-05T10:00:00Z'), projectSubmissionId: subId, policyVersion: 'v', transcriptJson: [], verdictJson: verdict(3, ['short_defense'], 'ИИ', '2026-10-05T10:00:00.000Z') },
    })).id;
    scoreBefore = (await matchItem()).score;
    liveId = (await prisma.callSession.create({
      data: { candidateId: CAND, kind: 'defense', aiDefense: false, status: 'finished', finishedAt: new Date('2026-10-10T10:00:00Z'), projectSubmissionId: subId, policyVersion: 'v', transcriptJson: [], verdictJson: verdict(7, ['strong_project_weak_defense'], LIVE_SECRET, '2026-10-10T10:00:00.000Z') },
    })).id;
  });
  afterAll(() => prisma.$disconnect());

  it('Y в подборке видит только ИИ-защиту; балл и место не зависят от живой защиты X', async () => {
    const item = await matchItem();
    expect(item.explanation.defense).toMatchObject({ score: 3, ai: true, flags: ['short_defense'] });
    expect(item.explanation.summary).toMatch(/защита: 3 из 8/i);
    expect(JSON.stringify(item)).not.toMatch(/7 из 8|strong_project_weak_defense|ВЫВОД ЖИВОЙ/);
    expect(item.score).toBe(scoreBefore);
  });

  it('загрузчик ступеней: Y и общий срез – ИИ-защита, X – своя живая (свежее)', async () => {
    expect((await loadStageEvidence([CAND], Y.companyId)).get(CAND)?.calls?.defense).toMatchObject({ score: 3, ai: true });
    expect((await loadStageEvidence([CAND])).get(CAND)?.calls?.defense).toMatchObject({ score: 3, ai: true });
    const own = (await loadStageEvidence([CAND], X.companyId)).get(CAND)?.calls?.defense;
    expect(own).toMatchObject({ score: 7, flags: ['strong_project_weak_defense'] });
    expect(own).not.toHaveProperty('ai');
  });

  it('ассистент Y: в карточке и пояснении нет живой защиты X', async () => {
    const ctx: EmployerToolContext = { ...Y, conversationId: 'c', emit: () => {}, llm: {} as EmployerToolContext['llm'] };
    const tool = (n: string) => employerTools.find((t) => t.name === n)!;
    const explain = await tool('explain_candidate').handler(ctx, { candidateId: CAND, vacancyId: NEED_Y });
    const match = await tool('match_for_need').handler(ctx, { vacancyId: NEED_Y, limit: 50 });
    const search = await tool('search_candidates').handler(ctx, { limit: 50 });
    expect(JSON.stringify(explain)).toMatch(/защита: 3 из 8/i);
    for (const out of [explain, match, search]) expect(JSON.stringify(out)).not.toMatch(/7 из 8|ВЫВОД ЖИВОЙ/);
  });

  it('после accepted у Y: по-прежнему только ИИ-защита – в подборке, в списке защит и в комнате', async () => {
    const inv = await createInvitation(Y, { candidateId: CAND, vacancyId: NEED_Y, message: 'Приглашаем на собеседование', salaryFrom: 100000, salaryTo: 120000 });
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: 'accepted' } });
    await discloseAccepted();

    expect((await matchItem()).explanation.defense).toMatchObject({ score: 3, ai: true });
    const calls = await listEmployerCalls(Y);
    expect(calls.map((c) => c.id)).toEqual([aiId]);

    const principalY = { userId: DEMO_EMPLOYER.userId, role: 'employer' as const, candidateId: null, employerProfileId: Y.employerProfileId };
    await expect(resolveViewer(principalY, liveId)).rejects.toMatchObject({ status: 404 });
    await expect(resolveViewer(principalY, aiId)).resolves.toMatchObject({ viewer: { role: 'employer', companyId: Y.companyId } });
    // Созвон, запись и видео чужой живой защиты по /api/call/* - тоже 404, даже при accepted и раскрытии.
    await expect(getCallForViewer(principalY, liveId)).rejects.toMatchObject({ status: 404 });
    await expect(getRecording(principalY, liveId)).rejects.toMatchObject({ status: 404 });
    await expect(getVideo(principalY, liveId, '000')).rejects.toMatchObject({ status: 404 });
    await expect(resolveCallAccess(principalY, { id: aiId, candidateId: CAND, kind: 'defense', status: 'finished' })).resolves.toMatchObject({ access: 'full', recording: true });
  });

  it('X после своего accepted видит свою живую защиту в списке и в комнате', async () => {
    const inv = await prisma.invitation.create({ data: { companyId: X.companyId, employerProfileId: X.employerProfileId, candidateId: CAND, vacancyId: 'v-dv-x', status: 'accepted', message: 'Приглашаем', salaryFrom: 1, salaryTo: 2 } });
    expect(inv.id).toBeTruthy();
    await discloseAccepted();
    const calls = await listEmployerCalls(X);
    expect(calls.map((c) => c.id).sort()).toEqual([aiId, liveId].sort());
    expect(calls.find((c) => c.id === liveId)).toMatchObject({ total: 7 });
    const principalX = { userId: 'u-dv-x', role: 'employer' as const, candidateId: null, employerProfileId: X.employerProfileId };
    await expect(resolveViewer(principalX, liveId)).resolves.toMatchObject({ viewer: { companyId: X.companyId } });
  });

  it('защита без сабмита (ответы на вопросы): видна компаниям, чьи вопросы в ней отвечены, и не видна остальным', async () => {
    await prisma.candidate.create({ data: { id: 'dv-q', name: 'Q', email: 'dvq@example.test', specialization: 'backend', consentAt: new Date() } });
    const s = await prisma.callSession.create({
      data: { candidateId: 'dv-q', kind: 'defense', status: 'finished', finishedAt: new Date(), policyVersion: 'v', transcriptJson: [], verdictJson: verdict(6, [], 'q', '2026-10-11T10:00:00.000Z') },
    });
    await prisma.employerQuestion.create({ data: { companyId: X.companyId, candidateId: 'dv-q', text: 'Почему так?', status: 'answered', answeredInCallSessionId: s.id } });
    expect((await loadStageEvidence(['dv-q'], X.companyId)).get('dv-q')?.calls?.defense).toMatchObject({ score: 6 });
    expect((await loadStageEvidence(['dv-q'], Y.companyId)).get('dv-q')?.calls?.defense).toBeUndefined();
    expect((await loadStageEvidence(['dv-q'])).get('dv-q')?.calls?.defense).toBeUndefined();
  });
});
