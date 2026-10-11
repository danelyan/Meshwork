import type { Prisma, PrismaClient } from '@prisma/client';

import { CALL_RECORDING_CONSENT_VERSION, CONSENT_TEXTS } from '../../src/server/consent/texts';
import { CALL_DISCLAIMER } from '../../src/server/call/drivers';
import { POLICY_VERSION } from '../../src/server/test/policy';

import { CANDIDATE_PERSONAS } from '../../src/server/demo/personas';
import { type DemoProfile, seedPoolProfiles } from './employer';

/**
 * Сид курированных демо-персон (src/server/demo/personas.ts): недостающие состояния пути
 * соискателя и вторая демо-компания. Всё реальными записями (утверждения, категория, попытка теста,
 * созвон с вердиктом, приглашения), а не флагами. Идемпотентен: фиксированные id, upsert;
 * утверждения и категория персон пересоздаются. Вызывать после seedRecommend и seedAuth.
 * Все люди и компании вымышлены.
 */

/** Компания второй демо-работодателя: уже есть в seedRecommend, вакансия demo-vac-be-j-2 (Backend Junior, 80–120 тыс.). */
export const GRANIT = { userId: 'demo-employer-granit', profileId: 'demo-employer-granit-p', companyId: 'demo-co-granit', vacancyId: 'demo-vac-be-j-2' };

const NOW = () => new Date();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Стек и утверждения под вакансию «Гранит Софт»: backend Junior (по needs demo-vac-be-j-2). */
const BE_J_CLAIMS: DemoProfile['claims'] = [
  ['be.framework', 'artifact'], ['be.api-validation', 'artifact'], ['be.authn-impl', 'self_reported'],
  ['be.config-secrets', 'self_reported'], ['common.http', 'artifact'], ['common.debugging', 'self_reported'], ['be.lang-core', 'artifact'],
];

export const PERSONA_PROFILES: DemoProfile[] = [
  {
    id: 'demo-tested', name: 'Демо: Ксения Андреева', specialization: 'frontend', subcategoryId: 'frontend.ui-app', fspState: 'no_achievements',
    category: { specialization: 'frontend', subcategoryId: 'frontend.ui-app', grade: 'junior' }, contact: 'ksenia.andreeva@example.com', stack: ['HTML', 'CSS', 'JavaScript', 'React'],
    claims: [['fe.html-semantic', 'artifact'], ['fe.css-layout', 'artifact'], ['fe.responsive', 'artifact'], ['fe.js-core', 'self_reported'],
      ['fe.components', 'self_reported'], ['fe.forms', 'self_reported'], ['common.git', 'artifact']],
  },
  {
    id: 'demo-strong', name: 'Демо: Леонид Исаев', specialization: 'frontend', subcategoryId: 'frontend.ui-app', fspState: 'linked',
    category: { specialization: 'frontend', subcategoryId: 'frontend.ui-app', grade: 'middle' }, contact: 'leonid.isaev@example.com', stack: ['TypeScript', 'React', 'Redux', 'Playwright'],
    claims: [['fe.ts-typing', 'platform'], ['fe.state-mgmt', 'platform'], ['fe.server-state', 'artifact'], ['fe.web-perf', 'third_party'],
      ['fe.component-tests', 'artifact'], ['fe.a11y', 'platform'], ['fe.render-lifecycle', 'platform'], ['fe.api-client', 'artifact'], ['common.git', 'artifact']],
  },
  {
    id: 'demo-invited', name: 'Демо: Марина Котова', specialization: 'backend', subcategoryId: 'backend.web-api', fspState: 'not_linked',
    category: { specialization: 'backend', subcategoryId: 'backend.web-api', grade: 'junior' }, contact: 'marina.kotova@example.com', stack: ['Node.js', 'NestJS', 'PostgreSQL'], claims: BE_J_CLAIMS,
  },
  {
    id: 'demo-hired', name: 'Демо: Алёна Мироненко', specialization: 'backend', subcategoryId: 'backend.web-api', fspState: 'linked',
    category: { specialization: 'backend', subcategoryId: 'backend.web-api', grade: 'junior' }, contact: 'alena.mironenko@example.com', stack: ['Node.js', 'NestJS', 'PostgreSQL'], claims: BE_J_CLAIMS,
  },
  {
    id: 'demo-accepted', name: 'Демо: Роман Зайцев', specialization: 'backend', subcategoryId: 'backend.web-api', fspState: 'linked',
    category: { specialization: 'backend', subcategoryId: 'backend.web-api', grade: 'junior' }, contact: '@roman_zaitsev_demo', stack: ['Node.js', 'NestJS', 'Redis'], claims: BE_J_CLAIMS,
  },
];

/** Профиль «Что я о тебе знаю» для готовых персон: анкета, чтобы кабинет не был пустым. */
const QUESTIONNAIRE: Record<string, { claimedGrade: 'junior' | 'middle'; salaryMin: number; salaryExpected: number; city: string }> = {
  'demo-tested': { claimedGrade: 'junior', salaryMin: 70000, salaryExpected: 100000, city: 'Казань' },
  'demo-strong': { claimedGrade: 'middle', salaryMin: 200000, salaryExpected: 260000, city: 'Москва' },
  'demo-invited': { claimedGrade: 'junior', salaryMin: 80000, salaryExpected: 110000, city: 'Екатеринбург' },
  'demo-hired': { claimedGrade: 'junior', salaryMin: 90000, salaryExpected: 120000, city: 'Самара' },
  'demo-accepted': { claimedGrade: 'junior', salaryMin: 80000, salaryExpected: 115000, city: 'Новосибирск' },
};

async function seedQuestionnaire(prisma: PrismaClient, p: DemoProfile): Promise<void> {
  const q = QUESTIONNAIRE[p.id];
  if (!q) return;
  const data = { goal: 'job_search' as const, claimedGrade: q.claimedGrade, stack: p.stack, workFormats: ['remote' as const, 'hybrid' as const], salaryMin: q.salaryMin, salaryExpected: q.salaryExpected, city: q.city };
  await prisma.candidateProfile.upsert({ where: { candidateId: p.id }, update: data, create: { candidateId: p.id, ...data } });
}

/** Попытка теста, которой выдана категория: без заданий (журнал вопросов у демо-персон не ведётся). */
async function seedPassedAttempt(prisma: PrismaClient, id: string, candidateId: string, spec: 'frontend' | 'backend', grade: 'junior' | 'middle', theta: number): Promise<void> {
  const started = daysAgo(3);
  const data = {
    candidateId, specialization: spec, grade, status: 'passed' as const, mode: 'full', seed: 4242, theta, se: 0.3, pPass: 0.93, pJunior: 0.98,
    policyVersion: POLICY_VERSION, startedAt: started, expiresAt: new Date(started.getTime() + 3_600_000), finishedAt: new Date(started.getTime() + 1_500_000),
  };
  await prisma.testAttempt.upsert({ where: { id }, update: data, create: { id, ...data } });
}

/** Созвон с ИИ, завершённый вердиктом: карта глубины по темам, которые поднимают утверждения до platform. */
async function seedFinishedCall(prisma: PrismaClient, id: string, candidateId: string): Promise<void> {
  const at = daysAgo(2);
  const iso = (ms: number) => new Date(at.getTime() + ms).toISOString();
  const topic = (catalogId: string, topicName: string, statement: string, quote: string) => ({
    topic: topicName, catalogId, claimed: true, claimStatement: statement, probed: 2, maxLevel: 3 as const, confirmed: true, status: 'confirmed' as const,
    agreement: { same: 3, of: 3 }, scores: { depth: 2, why: 2, boundary: 1, completion: 2 }, total: 7, quote,
    runs: [0, 1, 2].map(() => ({ depth: 2, why: 2, boundary: 1, completion: 2 })),
  });
  const depthMap = [
    topic('fe.ts-typing', 'Типизация в TypeScript', 'Использует строгую типизацию в проекте', 'Дженерики для API-клиента и сужение типов в обработчиках, strict включён.'),
    topic('fe.state-mgmt', 'Управление состоянием', 'Организует состояние приложения', 'Серверное состояние держу отдельно от UI-состояния, чтобы не дублировать кэш.'),
    topic('fe.render-lifecycle', 'Рендеринг и жизненный цикл', 'Понимает жизненный цикл рендера', 'Лишние рендеры нашёл профайлером, вынес вычисления в мемоизацию.'),
  ];
  const verdict = {
    kind: 'qualifying', depthMap, runs: 3, validRuns: 3, upgradedCatalogIds: depthMap.map((d) => d.catalogId),
    summary: 'Подтверждено 3 из 3 проверенных тем (демо-вердикт, вымышленная запись).', evaluatedAt: iso(1_200_000),
    thresholdVersion: 'demo', disclaimer: CALL_DISCLAIMER,
  };
  const transcript = [
    { index: 0, role: 'ai', text: 'Расскажи, как ты типизируешь ответы API в большом React-проекте?', at: iso(0), tMs: 0 },
    { index: 1, role: 'candidate', text: 'Дженерики для API-клиента и сужение типов в обработчиках, strict включён.', at: iso(30_000), tMs: 30_000 },
    { index: 2, role: 'ai', text: 'Как ты разделяешь серверное и клиентское состояние?', at: iso(60_000), tMs: 60_000 },
    { index: 3, role: 'candidate', text: 'Серверное состояние держу отдельно от UI-состояния, чтобы не дублировать кэш.', at: iso(95_000), tMs: 95_000 },
  ];
  const data = {
    candidateId, kind: 'qualifying' as const, status: 'finished' as const, startedAt: at, finishedAt: new Date(at.getTime() + 1_200_000),
    policyVersion: CALL_RECORDING_CONSENT_VERSION, transcriptJson: transcript as unknown as Prisma.InputJsonValue, verdictJson: verdict as unknown as Prisma.InputJsonValue,
  };
  await prisma.callSession.upsert({ where: { id }, update: data, create: { id, ...data } });
}

/** Знакомство в процессе: роль выбрана, несколько ответов даны, дальше вопросы в чате. */
async function seedIntroPersona(prisma: PrismaClient): Promise<void> {
  const id = 'demo-intro';
  const email = 'demo.intro@example.test';
  const now = NOW();
  await prisma.candidate.upsert({
    where: { id },
    update: { name: 'Демо: Павел Нестеров', email, specialization: 'backend', fspState: 'not_linked', isDemo: true },
    create: { id, name: 'Демо: Павел Нестеров', email, contact: 'pavel.nesterov@example.com', specialization: 'backend', fspState: 'not_linked', isDemo: true, consentAt: now },
  });
  const user = await prisma.user.upsert({
    where: { candidateId: id },
    update: { onboardedAt: null, role: 'candidate' },
    create: { name: 'Демо: Павел Нестеров', email, role: 'candidate', isDemo: true, onboardedAt: null, candidateId: id },
  });
  const state = {
    stepId: 'subcategory', answers: { role: 'candidate', goal: 'job_search', fsp: 'not_linked', specialization: 'backend' }, skipped: ['documents'],
  };
  await prisma.onboardingState.upsert({
    where: { userId: user.id },
    update: { stepId: state.stepId, answers: state.answers, skipped: state.skipped },
    create: { userId: user.id, stepId: state.stepId, answers: state.answers, skipped: state.skipped },
  });
  await prisma.candidateProfile.upsert({ where: { candidateId: id }, update: { goal: 'job_search' }, create: { candidateId: id, goal: 'job_search' } });
}

/** Вторая демо-компания «Гранит Софт»: представитель с принятыми офертой и обязательством по данным. */
async function seedGranitEmployer(prisma: PrismaClient): Promise<void> {
  const e = GRANIT;
  const now = NOW();
  const name = 'Демо: Олег Ермаков (HR, работодатель)';
  await prisma.user.upsert({
    where: { id: e.userId },
    update: { name, role: 'employer', isDemo: true },
    create: { id: e.userId, name, email: 'demo.employer.granit@example.test', role: 'employer', isDemo: true, onboardedAt: now },
  });
  await prisma.employerProfile.upsert({
    where: { userId: e.userId },
    update: { companyId: e.companyId },
    create: { id: e.profileId, userId: e.userId, companyId: e.companyId },
  });
  for (const kind of ['pd_processing', 'employer_offer', 'employer_data_obligation'] as const) {
    const version = CONSENT_TEXTS[kind].version;
    const has = await prisma.consent.count({ where: { userId: e.userId, kind, version, revokedAt: null } });
    if (!has) await prisma.consent.create({ data: { userId: e.userId, kind, version } });
  }
}

/** Приглашение компании «Гранит Софт» (фиксированный id — повторный сид обновляет, а не плодит). */
async function seedInvitation(prisma: PrismaClient, id: string, candidateId: string, status: 'sent' | 'accepted' | 'hired', ageDays: number): Promise<void> {
  const created = daysAgo(ageDays);
  const base = {
    vacancyId: GRANIT.vacancyId, candidateId, companyId: GRANIT.companyId, employerProfileId: GRANIT.profileId, status,
    salaryFrom: 100000, salaryTo: 130000, createdAt: created,
    message: 'Здравствуйте! Ваш профиль подходит под нашу вакансию Backend-разработчика. Расскажем о команде и задачах на коротком созвоне.',
    viewedAt: status !== 'sent' ? new Date(created.getTime() + 3_600_000) : null,
    respondedAt: status !== 'sent' ? new Date(created.getTime() + 7_200_000) : null,
    hiredAt: status === 'hired' ? new Date(created.getTime() + 5 * 86_400_000) : null,
  };
  await prisma.invitation.upsert({ where: { id }, update: base, create: { id, ...base } });
}

/**
 * Персоны этапов 3–8 показывают путь после знакомства. Общий демо-аккаунт могли сбросить («пройти онбординг заново»,
 * dev-панель) — тогда вместо этапа жюри видит знакомство с начала. Каждый сид (и деплой) возвращает их в «знакомство пройдено».
 */
async function healOnboardedPersonas(prisma: PrismaClient): Promise<void> {
  const ids = CANDIDATE_PERSONAS.filter((p) => (p.stage ?? 0) >= 3).map((p) => p.id);
  const users = await prisma.user.findMany({ where: { candidateId: { in: ids }, isDemo: true, onboardedAt: null }, select: { id: true } });
  if (users.length === 0) return;
  const userIds = users.map((u) => u.id);
  await prisma.onboardingState.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { onboardedAt: new Date() } });
}

export async function seedDemoPersonas(prisma: PrismaClient): Promise<void> {
  await seedPoolProfiles(prisma, PERSONA_PROFILES);
  for (const p of PERSONA_PROFILES) await seedQuestionnaire(prisma, p);
  await seedPassedAttempt(prisma, 'demo-attempt-tested', 'demo-tested', 'frontend', 'junior', -0.4);
  await seedPassedAttempt(prisma, 'demo-attempt-strong', 'demo-strong', 'frontend', 'middle', 0.5);
  await seedFinishedCall(prisma, 'demo-call-strong', 'demo-strong');
  await seedIntroPersona(prisma);
  await seedGranitEmployer(prisma);
  await seedInvitation(prisma, 'demo-inv-invited', 'demo-invited', 'sent', 1);
  await seedInvitation(prisma, 'demo-inv-accepted', 'demo-accepted', 'accepted', 4);
  await seedInvitation(prisma, 'demo-inv-hired', 'demo-hired', 'hired', 9);
  await healOnboardedPersonas(prisma);
  console.log(`seed(demo-personas): ${PERSONA_PROFILES.length + 1} candidates, employer Гранит Софт, 3 invitations (sent/accepted/hired)`);
}
