import { prisma } from '@/server/db';
import { type SessionPrincipal, parseSession, readCookie, SESSION_COOKIE } from '@/server/session';

/**
 * Подпись куки валидна, но аккаунта (формат `u.…`) или кандидата (старая демо-кука) уже нет в БД:
 * пересид, «Очистить аккаунт» в другом окне, другая БД с тем же SESSION_SECRET. Такую куку считаем гостевой.
 */
export async function sessionExists(p: SessionPrincipal): Promise<boolean> {
  if (p.userId) return (await prisma.user.findUnique({ where: { id: p.userId }, select: { id: true } })) !== null;
  if (p.candidateId) return (await prisma.candidate.findUnique({ where: { id: p.candidateId }, select: { id: true } })) !== null;
  return false;
}

/** Кука подписана верно, но субъекта в БД нет. Нет куки/подделка/истёк срок — не «протухла», а просто гость. */
export async function isSessionStale(req: Request): Promise<boolean> {
  const p = parseSession(readCookie(req, SESSION_COOKIE));
  return p !== null && !(await sessionExists(p));
}
