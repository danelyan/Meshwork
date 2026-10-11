// «Твой путь» честно показывает блокер шага (согласие на оценку ИИ, скрытый профиль, проект для живой защиты, подстатус защиты).
import { journeyState } from '@/server/agent/journey';
import { AI_CONSENT_BLOCKER, HIDDEN_BLOCKER, loadCandidateAside } from '@/server/consultant/aside';
import { proposeSlots } from '@/server/live-defense';

import { grantConsents, grantEmployerConsents } from '../../helpers/consents';
import { prisma, resetDb } from '../../helpers/db';

const C = 'cand-path';
const U = 'u-cand-path';
const note = (a: Awaited<ReturnType<typeof loadCandidateAside>>, id: string) => a.steps.find((s) => s.id === id)?.note;

describe('loadCandidateAside: блокеры шага', () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.candidate.create({ data: { id: C, email: `${C}@example.test`, name: C } });
    await prisma.user.create({ data: { id: U, name: 'Аня', role: 'candidate', candidateId: C, onboardedAt: new Date() } });
  });
  afterAll(() => prisma.$disconnect());

  it('без согласий: тест — блокер «Дать согласие», нота теста и «Приглашений» — про блокеры; в journey — aiConsent/hidden', async () => {
    const j = await journeyState(C);
    expect([j.nextStep, j.aiConsent, j.hidden]).toEqual(['test', false, true]);
    const a = await loadCandidateAside(C, undefined);
    expect(a.stepBlock?.step).toBe('test');
    expect(a.stepBlock?.blocker).toEqual(AI_CONSENT_BLOCKER);
    expect(note(a, 'test')).toBe('сначала - согласие на оценку ИИ');
    expect(note(a, 'invites')).toBe('профиль скрыт');
  });

  it('согласия даны: блокера нет; флаг hiddenFromEmployers — снова «профиль скрыт»', async () => {
    await grantConsents(U, ['ai_assessment', 'employer_visibility']);
    let a = await loadCandidateAside(C, undefined);
    expect(a.stepBlock?.blocker).toBeUndefined();
    expect(note(a, 'invites')).not.toBe('профиль скрыт');
    await prisma.candidate.update({ where: { id: C }, data: { hiddenFromEmployers: true } });
    a = await loadCandidateAside(C, undefined);
    expect(note(a, 'invites')).toBe('профиль скрыт');
    expect((await journeyState(C)).hidden).toBe(true);
  });

  it('приглашение принято, проекта нет: «сейчас» — проект, компания ждёт проект; защита — после сданного проекта', async () => {
    await grantConsents(U, ['ai_assessment', 'employer_visibility']);
    await prisma.candidateCategory.create({ data: { candidateId: C, specialization: 'backend', grade: 'middle' } });
    await prisma.invitation.create({ data: { candidateId: C, status: 'accepted', salaryFrom: 200000, salaryTo: 250000 } });
    const a = await loadCandidateAside(C, undefined);
    expect(a.stepBlock).toMatchObject({ step: 'project', forLive: true });
    expect(a.steps.filter((s) => s.state === 'now').map((s) => s.id)).toEqual(['project']);
    expect(note(a, 'live_defense')).toBe('после сданного проекта компания предложит слоты');
  });

  it('живая защита: нет предложения → «компания предложит время»; слоты предложены → «выбери слот» с компанией', async () => {
    await grantConsents(U, ['ai_assessment', 'employer_visibility']);
    await prisma.candidateCategory.create({ data: { candidateId: C, specialization: 'backend', grade: 'middle' } });
    await prisma.company.create({ data: { id: 'co-a', name: 'Альфа' } });
    await prisma.user.create({ data: { id: 'u-emp-a', name: 'HR', role: 'employer', email: 'hr-a@example.com' } });
    await prisma.employerProfile.create({ data: { id: 'ep-a', userId: 'u-emp-a', companyId: 'co-a' } });
    await grantEmployerConsents(['u-emp-a']);
    await prisma.projectTemplate.create({ data: { id: 'tpl-1', subcategoryId: 'backend.integrations', specialization: 'backend', grade: 'middle', title: 'Платежи', contractMd: '#', dirRef: 'x', hiddenTestsRef: 'hidden', visibleTestsRef: 'visible', image: 'node20', timeBudgetMin: 240 } });
    await prisma.vacancy.create({ data: { id: 'vac-1', companyId: 'co-a', title: 'Backend', specialization: 'backend', grade: 'middle', salaryFrom: 200000, salaryTo: 250000, needs: [] } });
    await prisma.projectTask.create({ data: { id: 'task-1', vacancyId: 'vac-1', templateId: 'tpl-1', specialization: 'backend', grade: 'middle', specJson: {}, rubricJson: { criteria: [] } } });
    await prisma.projectSubmission.create({ data: { projectTaskId: 'task-1', candidateId: C, repoUrl: 'https://github.com/fsp-demo/p', status: 'checked', resultJson: {} } });
    const inv = await prisma.invitation.create({ data: { candidateId: C, companyId: 'co-a', employerProfileId: 'ep-a', status: 'accepted', salaryFrom: 200000, salaryTo: 250000 } });
    let a = await loadCandidateAside(C, undefined);
    expect(a.stepBlock).toMatchObject({ step: 'live_defense', live: { status: 'none', company: 'Альфа' } });
    expect(note(a, 'live_defense')).toBe('компания предложит время');
    const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
    await proposeSlots({ companyId: 'co-a', userId: 'u-emp-a' }, inv.id, { slots: [h(26), h(28)], durationMin: 30 });
    a = await loadCandidateAside(C, undefined);
    expect(a.stepBlock?.live?.status).toBe('slots_proposed');
    expect(note(a, 'live_defense')).toBe('выбери слот');
  });

  it('скрытый профиль на ожидании приглашений: блокер со ссылкой на /settings', async () => {
    await grantConsents(U, ['ai_assessment']);
    await prisma.candidateCategory.create({ data: { candidateId: C, specialization: 'backend', grade: 'middle' } });
    await prisma.invitation.create({ data: { candidateId: C, status: 'sent', salaryFrom: 200000, salaryTo: 250000 } });
    const a = await loadCandidateAside(C, undefined);
    expect(a.stepBlock?.step).toBe('invitations');
    expect(a.stepBlock?.blocker).toEqual(HIDDEN_BLOCKER);
  });
});
