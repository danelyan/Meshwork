import { Prisma, type User } from '@prisma/client';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { passwordVersionOf, type UserSessionInput } from '@/server/session';

import { assertConsentVersion, ensureConsent, hasCurrentConsent } from './consent';

type UserWithProfiles = User & { employerProfile: { id: string } | null };

const withProfiles = { employerProfile: { select: { id: true } } } as const;

/** Поля куки сессии для аккаунта. */
export function sessionInputFor(user: UserWithProfiles): UserSessionInput {
  return {
    userId: user.id,
    role: user.role,
    candidateId: user.candidateId,
    employerProfileId: user.employerProfile?.id ?? null,
    passwordVersion: passwordVersionOf(user.passwordHash),
  };
}

/** Куда вести после входа: незавершённый онбординг → /onboarding, иначе кабинет роли. */
export function homePathFor(user: Pick<User, 'role' | 'onboardedAt'>): string {
  if (!user.onboardedAt || user.role === 'pending') return '/onboarding';
  return user.role === 'employer' ? '/employer' : '/consultant';
}

export interface ExternalProfile {
  provider: 'yandex';
  providerAccountId: string;
  name: string;
  /** null — провайдер почту не отдал (нет права или скрыта). */
  email: string | null;
}

/**
 * Найти или создать аккаунт по внешнему входу (provider + providerAccountId).
 * По почте аккаунты не склеиваем: иначе чужой аккаунт с той же почтой у другого
 * провайдера получил бы доступ. Гонка двух одновременных первых входов —
 * уникальный индекс + повторное чтение.
 */
export async function upsertExternalUser(p: ExternalProfile): Promise<UserWithProfiles> {
  const key = { provider_providerAccountId: { provider: p.provider, providerAccountId: p.providerAccountId } };
  const existing = await prisma.authAccount.findUnique({ where: key, select: { userId: true } });
  if (existing) {
    await prisma.authAccount.update({ where: key, data: { lastLoginAt: new Date() } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: existing.userId }, include: withProfiles });
    // Почту дополняем, если раньше её не было; имя не перетираем — его мог поправить сам человек.
    if (!user.email && p.email) {
      return prisma.user.update({ where: { id: user.id }, data: { email: p.email }, include: withProfiles });
    }
    return user;
  }
  try {
    return await prisma.user.create({
      data: {
        name: p.name,
        email: p.email,
        accounts: { create: { provider: p.provider, providerAccountId: p.providerAccountId } },
      },
      include: withProfiles,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const again = await prisma.authAccount.findUniqueOrThrow({ where: key, select: { userId: true } });
      return prisma.user.findUniqueOrThrow({ where: { id: again.userId }, include: withProfiles });
    }
    throw err;
  }
}

export type RoleChoice = { role: 'candidate' } | { role: 'employer'; companyName: string };

/**
 * Выбор роли в онбординге — один раз (pending → candidate | employer).
 * Кандидату создаёт Candidate (email обязателен и уникален в Candidate: если
 * почты нет или она занята — служебный адрес `user-<id>@users.invalid`).
 * Работодателю — новую Company (isDemo = false) и EmployerProfile. Присоединиться
 * к чужой компании нельзя: верификации компаний в MVP нет (R-D-05).
 * После вызова перевыпусти куку: `userSessionCookie(sessionInputFor(user))`.
 */
export async function chooseRole(userId: string, choice: RoleChoice): Promise<UserWithProfiles> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw errors.notFound('Аккаунт не найден');
    if (user.role !== 'pending') throw errors.conflict('Роль уже выбрана');
    if (choice.role === 'candidate') {
      const taken = user.email ? await tx.candidate.findUnique({ where: { email: user.email }, select: { id: true } }) : null;
      const email = user.email && !taken ? user.email : `user-${user.id}@users.invalid`;
      const consent = await tx.consent.findFirst({ where: { userId }, orderBy: { acceptedAt: 'desc' } });
      const candidate = await tx.candidate.create({ data: { name: user.name, email, consentAt: consent?.acceptedAt ?? null } });
      return tx.user.update({
        where: { id: userId },
        data: { role: 'candidate', candidateId: candidate.id },
        include: withProfiles,
      });
    }
    const company = await tx.company.create({ data: { name: choice.companyName, isDemo: false } });
    await tx.employerProfile.create({ data: { userId, companyId: company.id } });
    return tx.user.update({ where: { id: userId }, data: { role: 'employer' }, include: withProfiles });
  });
}

/**
 * Завершить онбординг. Условия: роль выбрана и есть согласие на текущую версию
 * текста (обработка ПДн без согласия недопустима, R-C-14). Идемпотентна.
 */
export async function markOnboarded(userId: string): Promise<UserWithProfiles> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: withProfiles });
  if (!user) throw errors.notFound('Аккаунт не найден');
  if (user.role === 'pending') throw errors.conflict('Сначала выберите роль');
  if (!(await hasCurrentConsent(userId))) throw errors.conflict('Нужно согласие на обработку данных');
  if (user.onboardedAt) return user;
  return prisma.user.update({ where: { id: userId }, data: { onboardedAt: new Date() }, include: withProfiles });
}

/**
 * Аккаунт для демо-кандидата (создаётся при первом демо-входе): роль candidate,
 * онбординг считается пройденным — жюри сразу попадает в кабинет.
 */
export async function ensureDemoCandidateUser(candidate: { id: string; name: string; email: string }) {
  const user = await prisma.user.upsert({
    where: { candidateId: candidate.id },
    update: {},
    create: {
      name: candidate.name,
      email: candidate.email,
      role: 'candidate',
      isDemo: true,
      onboardedAt: new Date(),
      candidateId: candidate.id,
    },
    include: withProfiles,
  });
  // Готовые демо-кандидаты считаются согласившимися (сид ставит Candidate.consentAt) — пишем и Consent.
  await ensureConsent(user.id);
  return user;
}

/**
 * Новый демо-гость: pending без `onboardedAt`, чтобы пройти весь онбординг-чат (только
 * DEMO_LOGIN, решает вызывающий). Согласие — галкой «Новый пользователь» на /demo, версия
 * приходит сюда и пишется вместе с аккаунтом. Создаётся при каждом нажатии; сид их не трогает.
 */
export async function createFreshDemoUser(consentVersion: string | null | undefined) {
  // Без галки согласия пользователь не создаётся (решение владельца 09.10: согласие — при регистрации).
  const version = assertConsentVersion(consentVersion);
  const n = await prisma.authAccount.count({ where: { provider: 'demo' } });
  return prisma.user.create({
    data: {
      name: `Демо-гость ${n + 1}`,
      isDemo: true,
      accounts: { create: { provider: 'demo', providerAccountId: crypto.randomUUID() } },
      consents: { create: { version } },
    },
    include: withProfiles,
  });
}

/**
 * Начать онбординг демо-аккаунта заново: сбрасывает состояние чата (`OnboardingState`) и
 * `onboardedAt`. Ответы профиля, роль и согласие не трогает.
 */
export async function resetDemoOnboarding(userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, isDemo: true }, select: { id: true } });
  if (!user) throw errors.notFound('Демо-аккаунт не найден');
  await prisma.onboardingState.deleteMany({ where: { userId } });
  await ensureConsent(userId); // демо-аккаунты считаются согласившимися: чат начинается с роли
  return prisma.user.update({ where: { id: userId }, data: { onboardedAt: null }, include: withProfiles });
}

export async function loadUser(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, include: withProfiles });
}
