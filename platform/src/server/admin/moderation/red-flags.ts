import 'server-only';

import type { Prisma, RedFlagReviewStatus, RedFlagTarget } from '@prisma/client';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { detectRedFlags, type RedFlag } from '@/server/employer/antifraud';

import { audit, requireReason } from '../audit';
import type { StaffContext } from '../session';

import { redFlagWarningMail, sendAfterDecision } from './mails';

/**
 * Очередь красных флагов (E-08, фаза 2; R-X-01). detectRedFlags отправку и сохранение не блокирует; сработавший флаг
 * ставит приглашение или вакансию в очередь «посмотреть» (RedFlagReview, уникальность по target – идемпотентно).
 * `vague_text` (меньше 8 слов) в очередь не ставит: это шум, а не признак обмана.
 * Решения: ok – норм; hidden – скрыть вакансию от кандидатов (для приглашения нельзя); warned – предупредить компанию
 * письмом. Скрытие хранится в статусе ревью (поля «скрыта» у Vacancy в схеме нет): hiddenVacancyIds().
 */

const QUEUED = (f: RedFlag) => f.code !== 'vague_text';

type Flag = Pick<RedFlag, 'code' | 'severity' | 'reason'>;

/**
 * Поставить в очередь (системно, без журнала персонала). Нет флагов – ничего. Уже есть открытое ревью – обновить флаги.
 * Есть закрытое (ok/warned) и появились новые коды – открыть заново; hidden остаётся hidden до решения модератора.
 */
export async function queueRedFlags(targetType: RedFlagTarget, targetId: string, all: readonly RedFlag[]): Promise<void> {
  const flags: Flag[] = all.filter(QUEUED).map(({ code, severity, reason }) => ({ code, severity, reason }));
  if (!flags.length) return;
  const json = flags as unknown as Prisma.InputJsonValue;
  const existing = await prisma.redFlagReview.findUnique({ where: { targetType_targetId: { targetType, targetId } } });
  if (!existing) {
    await prisma.redFlagReview.upsert({ where: { targetType_targetId: { targetType, targetId } }, create: { targetType, targetId, flags: json }, update: {} });
    return;
  }
  const prev = new Set(((existing.flags ?? []) as unknown as Flag[]).map((f) => f.code));
  const fresh = flags.some((f) => !prev.has(f.code));
  if (existing.status === 'open') await prisma.redFlagReview.update({ where: { id: existing.id }, data: { flags: json } });
  else if (fresh && existing.status !== 'hidden') await prisma.redFlagReview.update({ where: { id: existing.id }, data: { flags: json, status: 'open', resolvedById: null, resolvedAt: null, resolution: null } });
}

/** Хук после сохранения: сбой очереди не роняет отправку приглашения или сохранение вакансии. */
export async function queueRedFlagsSafely(targetType: RedFlagTarget, targetId: string, flags: readonly RedFlag[]): Promise<void> {
  try {
    await queueRedFlags(targetType, targetId, flags);
  } catch (err) {
    console.warn(`[red-flags] ${targetType}:${targetId} не поставлен в очередь: ${(err as Error).message}`);
  }
}

/** Флаги приглашения – те же тексты, что видит кандидат (listCandidateInvitations). */
export async function queueInvitationRedFlags(invitationId: string): Promise<void> {
  const inv = await prisma.invitation.findUnique({ where: { id: invitationId }, select: { message: true, salaryFrom: true, salaryTo: true, vacancy: { select: { title: true, teamDescription: true } } } });
  if (!inv) return;
  await queueRedFlagsSafely('invitation', invitationId, detectRedFlags({ texts: [inv.message, inv.vacancy?.title, inv.vacancy?.teamDescription], salaryFrom: inv.salaryFrom, salaryTo: inv.salaryTo }));
}

/** Флаги вакансии – как в форме вакансии (VacancyForm): заголовок, команда, описание, вилка. */
export async function queueVacancyRedFlags(vacancyId: string): Promise<void> {
  const v = await prisma.vacancy.findUnique({ where: { id: vacancyId }, select: { title: true, teamDescription: true, description: true, salaryFrom: true, salaryTo: true } });
  if (!v) return;
  await queueRedFlagsSafely('vacancy', vacancyId, detectRedFlags({ texts: [v.title, v.teamDescription, v.description], salaryFrom: v.salaryFrom, salaryTo: v.salaryTo }));
}

/** Вакансии, скрытые модератором: кандидатам не показываются. */
export async function hiddenVacancyIds(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<string[]> {
  return (await db.redFlagReview.findMany({ where: { targetType: 'vacancy', status: 'hidden' }, select: { targetId: true } })).map((r) => r.targetId);
}

export interface RedFlagQueueItem {
  id: string;
  targetType: RedFlagTarget;
  targetId: string;
  status: RedFlagReviewStatus;
  flags: Flag[];
  createdAt: string;
  resolution: string | null;
  company: { id: string; name: string } | null;
  title: string | null;
  text: string | null;
  salary: string;
}

export async function listRedFlags(status: RedFlagReviewStatus | 'all' = 'open'): Promise<RedFlagQueueItem[]> {
  const rows = await prisma.redFlagReview.findMany({ where: status === 'all' ? {} : { status }, orderBy: { createdAt: status === 'open' ? 'asc' : 'desc' }, take: 100 });
  const invIds = rows.filter((r) => r.targetType === 'invitation').map((r) => r.targetId);
  const vacIds = rows.filter((r) => r.targetType === 'vacancy').map((r) => r.targetId);
  const [invs, vacs] = await Promise.all([
    prisma.invitation.findMany({ where: { id: { in: invIds } }, select: { id: true, message: true, salaryFrom: true, salaryTo: true, company: { select: { id: true, name: true } }, vacancy: { select: { title: true } } } }),
    prisma.vacancy.findMany({ where: { id: { in: vacIds } }, select: { id: true, title: true, description: true, teamDescription: true, salaryFrom: true, salaryTo: true, company: { select: { id: true, name: true } } } }),
  ]);
  return rows.map((r) => {
    const base = { id: r.id, targetType: r.targetType, targetId: r.targetId, status: r.status, flags: (r.flags ?? []) as unknown as Flag[], createdAt: r.createdAt.toISOString(), resolution: r.resolution };
    if (r.targetType === 'invitation') {
      const i = invs.find((x) => x.id === r.targetId);
      return { ...base, company: i?.company ?? null, title: i?.vacancy?.title ?? null, text: i?.message ?? null, salary: i ? `${i.salaryFrom}–${i.salaryTo} ₽` : '–' };
    }
    const v = vacs.find((x) => x.id === r.targetId);
    return { ...base, company: v?.company ?? null, title: v?.title ?? null, text: [v?.teamDescription, v?.description].filter(Boolean).join('\n') || null, salary: v ? `${v.salaryFrom}–${v.salaryTo} ₽` : '–' };
  });
}

/** Скрыта ли вакансия модератором (статус hidden в очереди флагов). */
export async function isVacancyHidden(vacancyId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<boolean> {
  const r = await db.redFlagReview.findUnique({ where: { targetType_targetId: { targetType: 'vacancy', targetId: vacancyId } }, select: { status: true } });
  return r?.status === 'hidden';
}

/**
 * Скрыть вакансию от кандидатов (`hidden: true`) или вернуть (`false`) без красных флагов (hide_vacancy).
 * Хранится в `RedFlagReview` со статусом hidden: работодатель не обойдёт разархивированием. Возврат переводит
 * ревью в ok (флаги не стираются). Причина обязательна, журнал – в той же транзакции; повтор того же состояния – 409.
 */
export async function setVacancyHidden(staff: StaffContext, vacancyId: string, input: { hidden: boolean; reason: string | null | undefined }): Promise<{ id: string; hidden: boolean }> {
  const reason = requireReason(input.reason);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hide-vacancy:${vacancyId}`}))`;
    if (!(await tx.vacancy.findUnique({ where: { id: vacancyId }, select: { id: true } }))) throw errors.notFound('Вакансия не найдена');
    const key = { targetType_targetId: { targetType: 'vacancy' as const, targetId: vacancyId } };
    const before = await tx.redFlagReview.findUnique({ where: key });
    if (before) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`red-flag:${before.id}`}))`;
    const cur = before ? await tx.redFlagReview.findUnique({ where: key }) : null;
    const isHidden = cur?.status === 'hidden';
    if (input.hidden === isHidden) throw errors.conflict(isHidden ? 'Вакансия уже скрыта' : 'Вакансия не скрыта модератором');
    const data = { status: input.hidden ? ('hidden' as const) : ('ok' as const), resolvedById: staff.staffId, resolvedAt: new Date(), resolution: reason };
    const after = cur
      ? await tx.redFlagReview.update({ where: { id: cur.id }, data })
      : await tx.redFlagReview.create({ data: { targetType: 'vacancy', targetId: vacancyId, flags: [], ...data } });
    await audit({ actor: staff, action: input.hidden ? 'hide_vacancy.hidden' : 'hide_vacancy.shown', target: { type: 'vacancy', id: vacancyId }, reason, before: cur ?? { status: 'none' }, after }, tx);
  });
  return { id: vacancyId, hidden: input.hidden };
}

export type RedFlagDecision = 'ok' | 'hidden' | 'warned';

/** Решение по флагу: только из open (409), причина обязательна; hidden – только для вакансии (400). Письмо при warned – после COMMIT. */
export async function reviewRedFlag(staff: StaffContext, id: string, decision: RedFlagDecision, rawReason: string): Promise<{ id: string; status: RedFlagDecision }> {
  const reason = requireReason(rawReason);
  const before = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`red-flag:${id}`}))`;
    const b = await tx.redFlagReview.findUnique({ where: { id } });
    if (!b) throw errors.notFound('Запись не найдена');
    if (b.status !== 'open') throw errors.conflict('Уже рассмотрено');
    if (decision === 'hidden' && b.targetType !== 'vacancy') throw errors.badRequest('Скрыть можно только вакансию');
    const after = await tx.redFlagReview.update({ where: { id }, data: { status: decision, resolvedById: staff.staffId, resolvedAt: new Date(), resolution: reason } });
    const action = decision === 'hidden' ? 'review_red_flag.hidden' : decision === 'warned' ? 'review_red_flag.warned' : 'review_red_flag.ok';
    await audit({ actor: staff, action, target: { type: b.targetType === 'vacancy' ? 'vacancy' : 'invitation', id: b.targetId }, reason, before: b, after }, tx);
    return b;
  });
  if (decision === 'warned') {
    const companyId =
      before.targetType === 'vacancy'
        ? (await prisma.vacancy.findUnique({ where: { id: before.targetId }, select: { companyId: true } }))?.companyId
        : (await prisma.invitation.findUnique({ where: { id: before.targetId }, select: { companyId: true } }))?.companyId;
    const reps = companyId ? await prisma.employerProfile.findMany({ where: { companyId }, select: { user: { select: { email: true } } } }) : [];
    const what = before.targetType === 'vacancy' ? 'вакансию компании' : 'приглашение компании';
    await Promise.all(reps.map((r) => sendAfterDecision('red_flag_warning', r.user.email, (to) => redFlagWarningMail(to, { what, resolution: reason }))));
  }
  return { id, status: decision };
}
