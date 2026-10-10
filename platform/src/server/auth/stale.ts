import { prisma } from '@/server/db';
import { type SessionPrincipal, parseSession, passwordVersionOf, readCookie, SESSION_COOKIE } from '@/server/session';

/**
 * Подпись куки валидна, но аккаунта (формат `u.…`) или кандидата (старая демо-кука) уже нет в БД:
 * пересид, «Очистить аккаунт» в другом окне, другая БД с тем же SESSION_SECRET, смена пароля
 * (версия пароля в куке не совпала), смена активной роли на другом устройстве (роль в куке ≠ `User.role`, ADR 0004:
 * иначе страница решала бы по куке, а онбординг и сервисы — по БД, и ответы писались бы в чужую роль).
 * Такую куку считаем гостевой: повторный вход выдаст куку с текущей ролью.
 */
export async function sessionExists(p: SessionPrincipal): Promise<boolean> {
  if (p.userId) {
    const user = await prisma.user.findUnique({ where: { id: p.userId }, select: { passwordHash: true, role: true } });
    // Пароль сменили (сброс) — кука со старой версией пароля больше не действует; роль сменили — тоже.
    return user !== null && user.role === p.role && passwordVersionOf(user.passwordHash) === (p.passwordVersion ?? '');
  }
  if (p.candidateId) return (await prisma.candidate.findUnique({ where: { id: p.candidateId }, select: { id: true } })) !== null;
  return false;
}

/** Кука подписана верно, но субъекта в БД нет. Нет куки/подделка/истёк срок — не «протухла», а просто гость. */
export async function isSessionStale(req: Request): Promise<boolean> {
  const p = parseSession(readCookie(req, SESSION_COOKIE));
  return p !== null && !(await sessionExists(p));
}
