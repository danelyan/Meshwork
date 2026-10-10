// Готовность к созвону («созвон только когда есть о чём говорить», решение владельца 11.10):
// qualifying — есть утверждения о навыках; interview — есть категория из теста; повтор того же вида —
// не раньше чем через сутки после последнего завершённого созвона с вердиктом. defense не затрагивается.
import { prisma } from '../db';
import { AppError } from '../errors';
import type { CallKind } from './types';

export const CALL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const NOT_READY_QUALIFYING = 'Сначала расскажи о себе или загрузи резюме - будет о чём поговорить';
export const NOT_READY_INTERVIEW = 'ИИнтервью откроется после теста';

export interface CallReadiness {
  ready: boolean;
  reason?: string;
  /** ISO: когда откроется повторный созвон (только для паузы). */
  retryAt?: string;
}

/** Есть о чём говорить: qualifying — утверждения (не отклонённые), interview — категория из теста. */
export async function contentReadiness(candidateId: string, kind: CallKind): Promise<CallReadiness> {
  if (kind === 'qualifying') {
    const n = await prisma.claim.count({ where: { candidateId, status: { not: 'rejected' } } });
    return n > 0 ? { ready: true } : { ready: false, reason: NOT_READY_QUALIFYING };
  }
  if (kind === 'interview') {
    const n = await prisma.candidateCategory.count({ where: { candidateId, source: 'test' } });
    return n > 0 ? { ready: true } : { ready: false, reason: NOT_READY_INTERVIEW };
  }
  return { ready: true };
}

export function cooldownText(retryAt: Date, now = Date.now()): string {
  const hours = Math.max(1, Math.ceil((retryAt.getTime() - now) / 3_600_000));
  return `Повторный созвон - через ${hours} ч`;
}

/** Пауза после последнего завершённого созвона этого вида (с вердиктом); демо-кандидаты освобождены. */
export async function cooldownReadiness(candidateId: string, kind: CallKind, now = Date.now()): Promise<CallReadiness> {
  if (kind === 'defense') return { ready: true };
  const cand = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { isDemo: true } });
  if (cand?.isDemo) return { ready: true };
  const rows = await prisma.callSession.findMany({
    where: { candidateId, kind, status: 'finished', finishedAt: { not: null } },
    orderBy: { finishedAt: 'desc' },
    take: 5,
    select: { finishedAt: true, verdictJson: true },
  });
  const last = rows.find((r) => r.verdictJson !== null);
  if (!last?.finishedAt) return { ready: true };
  const retry = new Date(last.finishedAt.getTime() + CALL_COOLDOWN_MS);
  if (retry.getTime() <= now) return { ready: true };
  return { ready: false, reason: cooldownText(retry, now), retryAt: retry.toISOString() };
}

/** Итог для UI и GET /api/call: активный созвон продолжается без проверок. */
export async function callReadiness(candidateId: string, kind: CallKind, now = Date.now()): Promise<CallReadiness> {
  if (kind === 'defense') return { ready: true };
  const active = await prisma.callSession.findFirst({ where: { candidateId, kind, status: 'active' }, select: { id: true } });
  if (active) return { ready: true };
  const content = await contentReadiness(candidateId, kind);
  if (!content.ready) return content;
  return cooldownReadiness(candidateId, kind, now);
}

/** Для assertCanStart драйверов: нет темы для разговора → 409 call_not_ready. */
export async function assertContentReady(candidateId: string, kind: CallKind): Promise<void> {
  const r = await contentReadiness(candidateId, kind);
  if (!r.ready) throw new AppError('call_not_ready', r.reason ?? 'Созвон пока недоступен', 409, { reason: r.reason });
}

/** Общая пауза (service.startCall, после проверки активного созвона). */
export async function assertCooldownPassed(candidateId: string, kind: CallKind): Promise<void> {
  const r = await cooldownReadiness(candidateId, kind);
  if (!r.ready) throw new AppError('call_cooldown', r.reason ?? 'Повторный созвон пока недоступен', 409, { reason: r.reason, retryAt: r.retryAt });
}
