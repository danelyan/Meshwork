// Согласия для тестовых фикстур (ADR 0005): тест, созвон и защита требуют Г3; поиск и приглашения – оферты
// работодателя; контакты после accepted – раскрытия Г5 по приглашению.
import type { ConsentKind } from '@prisma/client';

import { CONSENT_TEXTS } from '@/server/consent/texts';

import { prisma } from './db';

/** Аккаунт кандидата: существующий по candidateId, иначе новый `u-<candidateId>`. */
async function userOfCandidate(candidateId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { candidateId }, select: { id: true } });
  if (u) return u.id;
  const id = `u-${candidateId}`;
  const existing = await prisma.user.findUnique({ where: { id }, select: { candidateId: true } });
  if (existing) {
    await prisma.user.update({ where: { id }, data: { candidateId } });
    return id;
  }
  return (await prisma.user.create({ data: { id, name: candidateId, role: 'candidate', candidateId }, select: { id: true } })).id;
}

export async function grantConsents(userId: string, kinds: readonly ConsentKind[]): Promise<void> {
  await prisma.consent.createMany({ data: kinds.map((kind) => ({ userId, kind, version: CONSENT_TEXTS[kind].version })) });
}

/** Г3 (+ запись созвона по умолчанию) кандидатам; аккаунт создаётся, если его не было. */
export async function grantCandidateConsents(candidateIds: readonly string[], kinds: readonly ConsentKind[] = ['ai_assessment', 'call_recording']): Promise<void> {
  for (const id of candidateIds) await grantConsents(await userOfCandidate(id), kinds);
}

/** Оферта и обязательство по данным – работодателям (по userId). */
export async function grantEmployerConsents(userIds: readonly string[]): Promise<void> {
  for (const id of userIds) await grantConsents(id, ['employer_offer', 'employer_data_obligation']);
}

/** Раскрытие (Г5) по всем принятым приглашениям, у которых его ещё нет – как будто кандидат принял через API. */
export async function discloseAccepted(): Promise<void> {
  const invs = await prisma.invitation.findMany({ where: { status: 'accepted' }, select: { id: true, candidateId: true } });
  for (const inv of invs) {
    const userId = await userOfCandidate(inv.candidateId);
    const has = await prisma.consent.findMany({ where: { userId, kind: 'identity_disclosure', revokedAt: null }, select: { context: true } });
    if (has.some((c) => (c.context as { invitationId?: string } | null)?.invitationId === inv.id)) continue;
    await prisma.consent.create({ data: { userId, kind: 'identity_disclosure', version: CONSENT_TEXTS.identity_disclosure.version, context: { invitationId: inv.id } } });
  }
}

export const DISCLOSURE_VERSION = CONSENT_TEXTS.identity_disclosure.version;

/** Связать кандидатов с аккаунтами `u-<candidateId>` (созданными или новыми): Г5 пишется на аккаунт кандидата. */
export async function linkCandidateUsers(candidateIds: readonly string[]): Promise<void> {
  for (const id of candidateIds) await userOfCandidate(id);
}
