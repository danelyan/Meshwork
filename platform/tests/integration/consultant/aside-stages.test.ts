// Полоса этапов знакомства (stages в данных колонки) считается по фактам из БД: грейд со слов не закрывает тест,
// привязка ФСП ID без материалов не закрывает «Резюме и опыт», ответы про опыт читаются и без ленты знакомства.
import { loadCandidateAside, loadEmployerAside } from '@/server/consultant/aside';

import { prisma, resetDb } from '../../helpers/db';

const C = 'cand-stages';
const U = 'u-cand-stages';
const states = (a: Awaited<ReturnType<typeof loadCandidateAside>>) => Object.fromEntries((a.stages?.items ?? []).map((s) => [s.id, s.state]));
const stage = (a: Awaited<ReturnType<typeof loadCandidateAside>>, id: string) => a.stages?.items.find((s) => s.id === id);

describe('loadCandidateAside: полоса этапов знакомства', () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.candidate.create({ data: { id: C, email: `${C}@example.test`, name: C } });
    await prisma.user.create({ data: { id: U, name: 'Аня', role: 'candidate', candidateId: C, onboardedAt: new Date() } });
  });
  afterAll(() => prisma.$disconnect());

  it('пустой профиль: пять этапов, первый — «сейчас», заполнено 0 из 8', async () => {
    const a = await loadCandidateAside(C, undefined);
    expect(a.stages?.title).toBe('Знакомство с Кирой');
    expect(states(a)).toEqual({ specialization: 'now', grade: 'next', materials: 'next', terms: 'next', test: 'next' });
    expect([a.stages?.done, a.stages?.total]).toEqual([0, 8]);
  });

  it('грейд со слов и условия закрывают свои этапы, но не тест; привязка ФСП ID — не материал об опыте', async () => {
    await prisma.candidate.update({ where: { id: C }, data: { specialization: 'backend' } });
    await prisma.candidateProfile.create({ data: { candidateId: C, claimedGrade: 'middle', workFormats: ['remote'], salaryExpected: 200000 } });
    await prisma.source.create({ data: { candidateId: C, kind: 'fsp', origin: 'fsp-id:1', snapshot: {}, ownershipVerified: true } });
    const a = await loadCandidateAside(C, undefined);
    expect(states(a)).toEqual({ specialization: 'done', grade: 'done', materials: 'now', terms: 'done', test: 'next' });
    expect(stage(a, 'specialization')?.note).toBe('Backend');
    expect(stage(a, 'grade')?.note).toBe('Middle · со слов');
    expect(stage(a, 'test')?.note).toBe('подтверждает грейд');
  });

  it('ответ про опыт из знакомства засчитан и после того, как лента знакомства закрыта', async () => {
    await prisma.onboardingState.create({ data: { userId: U, answers: { experience: 'oneToThree' } } });
    const a = await loadCandidateAside(C, undefined);
    expect(stage(a, 'materials')?.state).toBe('done');
  });

  it('ссылка на GitHub — материал об опыте; категория из теста закрывает этап «Тест»', async () => {
    await prisma.source.create({ data: { candidateId: C, kind: 'github', origin: 'https://github.com/example', snapshot: {} } });
    await prisma.candidateCategory.create({ data: { candidateId: C, specialization: 'backend', grade: 'middle' } });
    const a = await loadCandidateAside(C, undefined);
    expect(stage(a, 'materials')?.state).toBe('done');
    expect(stage(a, 'test')).toMatchObject({ state: 'done', note: 'Backend · Middle' });
    expect(stage(a, 'grade')).toMatchObject({ state: 'done', note: 'по тесту' });
  });
});

describe('loadEmployerAside: полоса этапов знакомства', () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.company.create({ data: { id: 'co-st', name: 'Гранит Софт', industry: 'Финтех' } });
    await prisma.user.create({ data: { id: 'u-emp-st', name: 'HR', role: 'employer', email: 'hr-st@example.com', onboardedAt: new Date() } });
    await prisma.employerProfile.create({ data: { id: 'ep-st', userId: 'u-emp-st', companyId: 'co-st' } });
  });

  it('компания и отрасль есть, контакта и вакансий нет: «сейчас» — контакты; заполненность — по этапам', async () => {
    const a = await loadEmployerAside('ep-st', undefined);
    expect(a.stages?.title).toBe('Знакомство с компанией');
    expect(a.stages?.items.map((s) => [s.id, s.state])).toEqual([['company', 'done'], ['industry', 'done'], ['contact', 'now'], ['need', 'next'], ['selection', 'next']]);
    expect([a.stages?.done, a.stages?.total]).toEqual([2, 5]);
  });

  it('контакт и активная вакансия: «сейчас» — подборка', async () => {
    await prisma.company.update({ where: { id: 'co-st' }, data: { contact: 'hr@example.com' } });
    await prisma.vacancy.create({ data: { id: 'vac-st', companyId: 'co-st', title: 'Backend', specialization: 'backend', grade: 'middle', salaryFrom: 200000, salaryTo: 250000, needs: [] } });
    const a = await loadEmployerAside('ep-st', undefined);
    expect(a.stages?.items.find((s) => s.id === 'need')).toMatchObject({ state: 'done', note: 'активных: 1' });
    expect(a.stages?.items.find((s) => s.id === 'selection')?.state).toBe('now');
  });
});
