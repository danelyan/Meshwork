import 'server-only';

import { hasActiveConsent } from '@/server/consent/service';
import { eraseOwnAccount } from '@/server/auth/erase-account';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

import { audit, requireReason } from '../audit';
import type { StaffContext } from '../session';

import { SHOW_DEMO_SETTING, cooldownResetAt, isBlockedNow, isHiddenByModerator, showDemoInMatching } from './state';

/**
 * Действия фазы 3 E-08 над пользователями, компаниями и кандидатами. Каждое изменение — с причиной и строкой журнала
 * в той же транзакции. В журнал (`before`/`after`) идут id, флаги и сроки — без ФИО, почты и телефона.
 */

const BLOCK_SELECT = { blockedAt: true, blockedUntil: true, blockedReason: true, blockedById: true } as const;

function parseUntil(until: string | null | undefined, now: Date): Date | null {
  if (!until) return null;
  const d = new Date(until);
  if (Number.isNaN(d.getTime())) throw errors.badRequest('Некорректный срок блокировки');
  if (d <= now) throw errors.badRequest('Срок блокировки должен быть в будущем');
  return d;
}

// ---------------------------------------------------------------------------
// Блокировка пользователя: вход закрыт, сессии отозваны (`sessionVersionOf` + `sessionExists`)
// ---------------------------------------------------------------------------

export async function blockUser(actor: StaffContext, userId: string, input: { reason: string | null | undefined; until?: string | null }) {
  const reason = requireReason(input.reason);
  const now = new Date();
  const until = parseUntil(input.until, now);
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isDemo: true, accounts: { select: { provider: true } }, ...BLOCK_SELECT } });
    if (!before) throw errors.notFound('Пользователь не найден');
    // Общий демо-аккаунт сида — вход жюри на стенде; его блокировка сломала бы демонстрацию для всех.
    if (before.isDemo && !before.accounts.some((a) => a.provider === 'demo')) throw errors.conflict('Общий демо-аккаунт не блокируется');
    const after = await tx.user.update({ where: { id: userId }, data: { blockedAt: now, blockedUntil: until, blockedReason: reason, blockedById: actor.staffId }, select: BLOCK_SELECT });
    await audit({ actor, action: 'block_user', target: { type: 'user', id: userId }, reason, before: pickBlock(before), after }, tx);
    return after;
  });
}

/** Снять блокировку: `blockedUntil = now`. `blockedAt` остаётся эпохой отзыва — старые куки не оживают. */
export async function unblockUser(actor: StaffContext, userId: string, input: { reason: string | null | undefined }) {
  const reason = requireReason(input.reason);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: BLOCK_SELECT });
    if (!before) throw errors.notFound('Пользователь не найден');
    if (!isBlockedNow(before, now)) throw errors.conflict('Пользователь не заблокирован');
    const after = await tx.user.update({ where: { id: userId }, data: { blockedUntil: now }, select: BLOCK_SELECT });
    await audit({ actor, action: 'unblock_user', target: { type: 'user', id: userId }, reason, before, after }, tx);
    return after;
  });
}

// ---------------------------------------------------------------------------
// Блокировка компании: приглашения не отправляются (assertCompanyNotBlocked в createInvitation), вакансии скрыты
// ---------------------------------------------------------------------------

export async function blockCompany(actor: StaffContext, companyId: string, input: { reason: string | null | undefined; until?: string | null }) {
  const reason = requireReason(input.reason);
  const now = new Date();
  const until = parseUntil(input.until, now);
  return prisma.$transaction(async (tx) => {
    const before = await tx.company.findUnique({ where: { id: companyId }, select: BLOCK_SELECT });
    if (!before) throw errors.notFound('Компания не найдена');
    const after = await tx.company.update({ where: { id: companyId }, data: { blockedAt: now, blockedUntil: until, blockedReason: reason, blockedById: actor.staffId }, select: BLOCK_SELECT });
    await audit({ actor, action: 'block_company', target: { type: 'company', id: companyId }, reason, before, after }, tx);
    return after;
  });
}

export async function unblockCompany(actor: StaffContext, companyId: string, input: { reason: string | null | undefined }) {
  const reason = requireReason(input.reason);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const before = await tx.company.findUnique({ where: { id: companyId }, select: BLOCK_SELECT });
    if (!before) throw errors.notFound('Компания не найдена');
    if (!isBlockedNow(before, now)) throw errors.conflict('Компания не заблокирована');
    const after = await tx.company.update({ where: { id: companyId }, data: { blockedUntil: now }, select: BLOCK_SELECT });
    await audit({ actor, action: 'block_company.unblocked', target: { type: 'company', id: companyId }, reason, before, after }, tx);
    return after;
  });
}

function pickBlock(x: { blockedAt: Date | null; blockedUntil: Date | null; blockedReason: string | null; blockedById: string | null }) {
  return { blockedAt: x.blockedAt, blockedUntil: x.blockedUntil, blockedReason: x.blockedReason, blockedById: x.blockedById };
}

// ---------------------------------------------------------------------------
// Скрыть / вернуть кандидата в поиске
// ---------------------------------------------------------------------------

/**
 * Скрыть — `hiddenFromEmployers = true` и строка `hide_candidate.hidden`: пока она последняя, сам кандидат профиль
 * не вернёт (`setPrivacy`, согласие Г4). Вернуть — строка `hide_candidate.shown` и видимость по выбору самого
 * кандидата: есть действующее согласие Г4 (или профиль без аккаунта, демо-пул) — виден, нет — остаётся скрыт.
 */
export async function setCandidateHidden(actor: StaffContext, candidateId: string, input: { hidden: boolean; reason: string | null | undefined }) {
  const reason = requireReason(input.reason);
  const cand = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { hiddenFromEmployers: true, user: { select: { id: true } } } });
  if (!cand) throw errors.notFound('Кандидат не найден');
  const byModerator = await isHiddenByModerator(candidateId);
  if (input.hidden && byModerator) throw errors.conflict('Профиль уже скрыт модератором');
  if (!input.hidden && !byModerator) throw errors.conflict('Профиль не скрыт модератором');
  const visibleByOwnChoice = cand.user ? await hasActiveConsent(cand.user.id, 'employer_visibility') : true;
  const hiddenFromEmployers = input.hidden ? true : !visibleByOwnChoice;
  return prisma.$transaction(async (tx) => {
    await tx.candidate.update({ where: { id: candidateId }, data: { hiddenFromEmployers } });
    await audit(
      { actor, action: input.hidden ? 'hide_candidate.hidden' : 'hide_candidate.shown', target: { type: 'candidate', id: candidateId }, reason, before: { hiddenFromEmployers: cand.hiddenFromEmployers, hiddenByModerator: byModerator }, after: { hiddenFromEmployers, hiddenByModerator: input.hidden } },
      tx,
    );
    return { hiddenFromEmployers, hiddenByModerator: input.hidden };
  });
}

// ---------------------------------------------------------------------------
// Сброс кулдауна теста (R-C-09)
// ---------------------------------------------------------------------------

export async function cooldownState(candidateId: string) {
  const cand = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } });
  if (!cand) throw errors.notFound('Кандидат не найден');
  const [category, lastAttempt, resetAt] = await Promise.all([
    prisma.candidateCategory.findFirst({ where: { candidateId }, orderBy: { confirmedAt: 'desc' }, select: { specialization: true, grade: true, confirmedAt: true } }),
    prisma.testAttempt.findFirst({ where: { candidateId, kind: 'grade', finishedAt: { not: null } }, orderBy: { finishedAt: 'desc' }, select: { grade: true, status: true, finishedAt: true } }),
    cooldownResetAt(candidateId),
  ]);
  return { category, lastAttempt, resetAt };
}

/**
 * Сброс — одна строка журнала `reset_cooldown`: `checkEligibility` не учитывает интервалы, начатые до неё
 * (смена грейда от подтверждения категории, пересдача от прошлой попытки). Категорию и попытки не трогает.
 */
export async function resetCooldown(actor: StaffContext, candidateId: string, input: { reason: string | null | undefined }) {
  const reason = requireReason(input.reason);
  const before = await cooldownState(candidateId);
  const row = await audit({ actor, action: 'reset_cooldown', target: { type: 'candidate', id: candidateId }, reason, before, after: { category: 'не меняется' } });
  const saved = await prisma.adminAuditLog.findUniqueOrThrow({ where: { id: row.id }, select: { createdAt: true } });
  return { resetAt: saved.createdAt };
}

// ---------------------------------------------------------------------------
// Удаление по запросу субъекта ПДн
// ---------------------------------------------------------------------------

/**
 * Удаление через `eraseOwnAccount` (тот же код, что «Удалить аккаунт» у самого человека). Двойное подтверждение:
 * в UI — диалог, на сервере — `confirm` обязан совпасть с id. Журнал — в транзакции удаления: факт и id,
 * без ПДн. Общий демо-аккаунт сида и активный созвон — отказ из `eraseOwnAccount`.
 */
export async function eraseAccountByStaff(actor: StaffContext, userId: string, input: { confirm: string; reason: string | null | undefined }) {
  const reason = requireReason(input.reason);
  if (input.confirm !== userId) throw errors.badRequest('Подтвердите удаление: введите id пользователя');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isDemo: true, candidateId: true, employerProfile: { select: { companyId: true } } } });
  if (!user) throw errors.notFound('Пользователь не найден');
  const before = { role: user.role, isDemo: user.isDemo, candidateId: user.candidateId, companyId: user.employerProfile?.companyId ?? null };
  await eraseOwnAccount(userId, {
    inTransaction: async (tx) => {
      await audit({ actor, action: 'erase_account', target: { type: 'user', id: userId }, reason, before, after: { erased: true } }, tx);
    },
  });
  return { erased: true };
}

// ---------------------------------------------------------------------------
// Демо-данные
// ---------------------------------------------------------------------------

/** Явные маркеры e2e: вакансии `E2E …` (e2e/employer.spec.ts), компания из e2e/role-switch.spec.ts. */
export const E2E_VACANCY_PREFIX = 'E2E ';
export const E2E_COMPANY_NAMES = ['ООО Переключатель'];

/** Гостевой аккаунт «Новый пользователь» с /demo: isDemo и свой вход `demo`. */
const GUEST_USER = { isDemo: true, accounts: { some: { provider: 'demo' } } } as const;

export async function listDemo() {
  const [users, companies, showDemo, junk] = await Promise.all([
    prisma.user.findMany({
      where: { isDemo: true },
      select: { id: true, role: true, name: true, createdAt: true, blockedAt: true, blockedUntil: true, accounts: { select: { provider: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    }),
    prisma.company.findMany({ where: { isDemo: true }, select: { id: true, name: true, _count: { select: { vacancies: true } } }, orderBy: { name: 'asc' }, take: 300 }),
    showDemoInMatching(),
    findJunk(),
  ]);
  return {
    showDemo,
    // Имя — только у общих демо-персон сида (вымышленные). Гость мог ввести своё — показываем псевдоним.
    users: users.map((u) => {
      const guest = u.accounts.some((a) => a.provider === 'demo');
      return { id: u.id, role: u.role, kind: guest ? ('guest' as const) : ('shared' as const), label: guest ? `Гость ${u.id.slice(-6)}` : u.name, createdAt: u.createdAt, blocked: isBlockedNow(u) };
    }),
    companies: companies.map((c) => ({ id: c.id, name: c.name, vacancies: c._count.vacancies })),
    junk,
  };
}

/** Мусор e2e: вакансии `E2E …` демо-компаний и компании-маркеры, где все представители — гостевые аккаунты. */
export async function findJunk() {
  const [vacancies, companies] = await Promise.all([
    prisma.vacancy.findMany({ where: { title: { startsWith: E2E_VACANCY_PREFIX }, company: { isDemo: true } }, select: { id: true, title: true, company: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.company.findMany({
      where: {
        OR: [{ name: { in: E2E_COMPANY_NAMES } }, { name: { startsWith: E2E_VACANCY_PREFIX } }],
        employers: { some: {}, every: { user: GUEST_USER } },
      },
      select: { id: true, name: true, employers: { select: { userId: true } } },
    }),
  ]);
  return {
    vacancies: vacancies.map((v) => ({ id: v.id, title: v.title, company: v.company.name })),
    companies: companies.map((c) => ({ id: c.id, name: c.name, guestUserIds: c.employers.map((e) => e.userId) })),
  };
}

/**
 * Удалить мусор e2e. Удаляется только пересечение «что показали владельцу» (`vacancyIds`, `companyIds`) и «что
 * сейчас подходит под маркеры» — лишнего не заденет даже устаревший экран. Компании-маркеры уходят вместе с их
 * гостевыми аккаунтами через `eraseOwnAccount` (каскад как у самоудаления).
 */
export async function cleanupJunk(actor: StaffContext, input: { reason: string | null | undefined; vacancyIds: string[]; companyIds: string[] }) {
  const reason = requireReason(input.reason);
  const junk = await findJunk();
  const vacancyIds = junk.vacancies.map((v) => v.id).filter((id) => input.vacancyIds.includes(id));
  const companies = junk.companies.filter((c) => input.companyIds.includes(c.id));
  if (vacancyIds.length) {
    await prisma.$transaction(async (tx) => {
      const r = await tx.vacancy.deleteMany({ where: { id: { in: vacancyIds }, title: { startsWith: E2E_VACANCY_PREFIX }, company: { isDemo: true } } });
      await audit({ actor, action: 'manage_demo.cleanup_vacancies', target: null, reason, after: { vacancyIds, deleted: r.count } }, tx);
    });
  }
  let erasedUsers = 0;
  for (const c of companies) {
    for (const userId of c.guestUserIds) {
      await eraseOwnAccount(userId, {
        inTransaction: async (tx) => {
          await audit({ actor, action: 'manage_demo.erase_guest', target: { type: 'user', id: userId }, reason, after: { companyId: c.id, erased: true } }, tx);
        },
      });
      erasedUsers += 1;
    }
  }
  return { vacancies: vacancyIds.length, companies: companies.length, users: erasedUsers };
}

/** Переключатель «показывать демо-кандидатов в подборке и поиске» (PlatformSetting + версия + журнал). */
export async function setShowDemo(actor: StaffContext, input: { value: boolean; reason: string | null | undefined }) {
  const reason = requireReason(input.reason);
  return prisma.$transaction(async (tx) => {
    const before = await showDemoInMatching(tx);
    await tx.platformSetting.upsert({ where: { key: SHOW_DEMO_SETTING }, create: { key: SHOW_DEMO_SETTING, value: input.value, updatedById: actor.staffId }, update: { value: input.value, updatedById: actor.staffId } });
    await tx.platformSettingVersion.create({ data: { key: SHOW_DEMO_SETTING, value: input.value, updatedById: actor.staffId, reason } });
    await audit({ actor, action: 'manage_demo.show_in_matching', target: { type: 'setting', id: SHOW_DEMO_SETTING }, reason, before: { value: before }, after: { value: input.value } }, tx);
    return { showDemo: input.value };
  });
}
