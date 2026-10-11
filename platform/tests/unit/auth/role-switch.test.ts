import { type RoleSwitchState, planRoleSwitch, swapRoleOnboarding } from '@/server/auth/role-plan';
import { AppError } from '@/server/errors';
import { parseSession, requireCandidate, requireEmployer, signUserSession } from '@/server/session';

// ADR 0004: переключение роли – чистое решение (что сделать, отметки знакомства) и кука после переключения.

const base: RoleSwitchState = {
  role: 'candidate',
  onboardedAt: new Date('2026-10-10T10:00:00Z'),
  onboardedRoles: [],
  hasCandidate: true,
  hasEmployer: false,
  sharedDemo: false,
};

function statusOf(fn: () => unknown): number {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return (err as AppError).status;
  }
  throw new Error('ожидалась ошибка');
}

describe('planRoleSwitch', () => {
  it('та же роль – ничего не меняем (идемпотентно)', () => {
    expect(planRoleSwitch(base, 'candidate')).toEqual({ kind: 'same' });
    expect(planRoleSwitch({ ...base, role: 'employer', hasEmployer: true }, 'employer')).toEqual({ kind: 'same' });
  });

  it('кандидат → работодатель без профиля: создать, знакомство работодателя с нуля, кандидат помечен завершённым', () => {
    expect(planRoleSwitch(base, 'employer', { companyName: 'ООО Ромашка' })).toEqual({
      kind: 'create',
      onboardedRoles: ['candidate'],
      targetOnboarded: false,
    });
  });

  it('работодатель → кандидат без профиля: создать; название компании не нужно', () => {
    const s: RoleSwitchState = { ...base, role: 'employer', hasCandidate: false, hasEmployer: true };
    expect(planRoleSwitch(s, 'candidate')).toEqual({ kind: 'create', onboardedRoles: ['employer'], targetOnboarded: false });
  });

  it('оба профиля: переключить в обе стороны, отметка знакомства цели берётся из списка', () => {
    const both: RoleSwitchState = { ...base, hasEmployer: true, onboardedRoles: ['employer'] };
    expect(planRoleSwitch(both, 'employer')).toEqual({ kind: 'activate', onboardedRoles: ['candidate', 'employer'], targetOnboarded: true });
    const back: RoleSwitchState = { ...both, role: 'employer', onboardedRoles: ['candidate'] };
    expect(planRoleSwitch(back, 'candidate')).toEqual({ kind: 'activate', onboardedRoles: ['candidate', 'employer'], targetOnboarded: true });
  });

  it('знакомство активной роли не завершено (или сброшено) – уходя, снимаем её отметку', () => {
    const s: RoleSwitchState = { ...base, onboardedAt: null, hasEmployer: true, onboardedRoles: ['candidate'] };
    expect(planRoleSwitch(s, 'employer')).toEqual({ kind: 'activate', onboardedRoles: [], targetOnboarded: false });
  });

  it('ошибки: роль не выбрана – 409; общий демо без второй роли – 403; работодатель без компании – 400', () => {
    expect(statusOf(() => planRoleSwitch({ ...base, role: 'pending', hasCandidate: false }, 'candidate'))).toBe(409);
    expect(statusOf(() => planRoleSwitch({ ...base, sharedDemo: true }, 'employer', { companyName: 'ООО' }))).toBe(403);
    expect(statusOf(() => planRoleSwitch(base, 'employer', { companyName: '   ' }))).toBe(400);
  });

  it('общий демо с уже существующим вторым профилем переключается (создавать нечего)', () => {
    expect(planRoleSwitch({ ...base, sharedDemo: true, hasEmployer: true }, 'employer').kind).toBe('activate');
  });
});

describe('кука после переключения: только профиль активной роли', () => {
  const SECRET = 'x'.repeat(40);
  const NOW = 1_800_000_000;
  const req = (t: string) => new Request('http://localhost/api/x', { headers: { cookie: `cid=${t}` } });

  it('учётка с двумя профилями, активен работодатель: id кандидата из куки недоступен', () => {
    const t = signUserSession({ userId: 'u1', role: 'employer', candidateId: 'c1', employerProfileId: 'e1' }, SECRET, NOW);
    expect(parseSession(t, SECRET, NOW + 1)).toEqual({ userId: 'u1', role: 'employer', candidateId: null, employerProfileId: 'e1' });
  });

  it('активен кандидат: id работодателя из куки недоступен', () => {
    const t = signUserSession({ userId: 'u1', role: 'candidate', candidateId: 'c1', employerProfileId: 'e1' }, SECRET, NOW);
    expect(parseSession(t, SECRET, NOW + 1)).toEqual({ userId: 'u1', role: 'candidate', candidateId: 'c1', employerProfileId: null });
  });

  it('гварды API следуют активной роли', () => {
    const emp = signUserSession({ userId: 'u1', role: 'employer', candidateId: 'c1', employerProfileId: 'e1' });
    expect(requireEmployer(req(emp))).toEqual({ userId: 'u1', employerProfileId: 'e1' });
    expect(statusOf(() => requireCandidate(req(emp)))).toBe(403);
  });
});

describe('swapRoleOnboarding: шаг, пауза и итог – свои у каждой роли', () => {
  const st = { stepId: 'summary', lines: { goal: 'цель', summary: 'итог кандидата' }, meta: { later: true, vacancies: {} } };

  it('новая роль: прежняя прячется в byRole, новая начинает с первого шага без паузы и итога', () => {
    const next = swapRoleOnboarding(st, 'candidate', 'employer', { fresh: true, doneRoles: ['candidate'] });
    expect(next.stepId).toBeNull();
    expect(next.lines).toEqual({ goal: 'цель' });
    expect(next.meta).toEqual({
      vacancies: {},
      doneRoles: ['candidate'],
      byRole: { candidate: { stepId: 'summary', later: true, summary: 'итог кандидата' } },
    });
  });

  it('возврат: у каждой роли свой итог и своя пауза', () => {
    const emp = swapRoleOnboarding(st, 'candidate', 'employer', { fresh: true, doneRoles: ['candidate'] });
    const empDone = { ...emp, stepId: 'inn', lines: { ...emp.lines, summary: 'итог работодателя' } };
    const back = swapRoleOnboarding(empDone, 'employer', 'candidate', { fresh: false, doneRoles: ['candidate'] });
    expect(back.stepId).toBe('summary');
    expect(back.lines.summary).toBe('итог кандидата');
    expect(back.meta.later).toBe(true);
    expect(back.meta.byRole).toEqual({ employer: { stepId: 'inn', summary: 'итог работодателя' } });
    const again = swapRoleOnboarding(back, 'candidate', 'employer', { fresh: false, doneRoles: ['candidate'] });
    expect(again.lines.summary).toBe('итог работодателя');
    expect(again.meta.later).toBeUndefined();
    expect(again.stepId).toBe('inn');
  });

  it('роль без сохранённого состояния – с первого шага', () => {
    const next = swapRoleOnboarding({ stepId: 'goal', lines: {}, meta: {} }, 'candidate', 'employer', { fresh: false, doneRoles: [] });
    expect(next.stepId).toBeNull();
  });
});
