import type { Prisma } from '@prisma/client';

import { prisma } from '../db';
import { AppError, errors } from '../errors';
import { publish } from './bus';
import type { DefenseMode, DefenseRoomVerdict, PlanItem, TranscriptEntry } from './types';

/**
 * Хранение состояния звонка: транскрипт (CallSession.transcriptJson, дописывается под блокировкой
 * строки – реплики приходят из разных маршрутов одновременно), план (DefenseRoomPlan) и блокировка
 * хода ИИ (один ход за раз, протухает через PLAN_LOCK_MS).
 */

export const PLAN_LOCK_MS = 90_000;

export type NewEntry = Omit<TranscriptEntry, 'index' | 'at' | 'tMs'>;

export interface SourceInfo {
  mode: DefenseMode;
  repoUrl: string | null;
  commitSha: string | null;
  projectTitle: string;
  generator: 'llm' | 'fallback' | 'none';
  files: number;
  fragments: number;
  truncated?: { treeEntries: number; files: number };
  /** Версия правил защиты (DEFENSE_POLICY_VERSION); CallSession.policyVersion – версия согласия на запись, как у лейна call. */
  policyVersion?: string;
}

export interface PlanRow {
  items: PlanItem[];
  cursor: number;
  source: SourceInfo;
}

export function asTranscript(json: unknown): TranscriptEntry[] {
  return Array.isArray(json) ? (json as TranscriptEntry[]) : [];
}

/** Дописать реплики в транскрипт под `FOR UPDATE` и разослать их подписчикам как `utterance`. */
export async function appendEntries(sessionId: string, entries: NewEntry[], opts: { done?: boolean } = {}): Promise<TranscriptEntry[]> {
  if (!entries.length) return [];
  const added = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ transcriptJson: unknown; startedAt: Date; status: string }[]>`
      SELECT "transcriptJson", "startedAt", "status"::text AS "status" FROM "CallSession" WHERE id = ${sessionId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw errors.notFound('Сессия не найдена');
    if (row.status !== 'active') throw errors.conflict('Сессия уже завершена');
    const transcript = asTranscript(row.transcriptJson);
    const now = new Date();
    let index = transcript.length ? transcript[transcript.length - 1]!.index + 1 : 0;
    const out: TranscriptEntry[] = entries.map((e) => ({ ...e, index: index++, at: now.toISOString(), tMs: Math.max(0, now.getTime() - row.startedAt.getTime()) }));
    await tx.callSession.update({
      where: { id: sessionId },
      data: { transcriptJson: [...transcript, ...out] as unknown as Prisma.InputJsonValue },
    });
    return out;
  });
  added.forEach((entry, i) => publish(sessionId, { type: 'utterance', entry, ...(opts.done && i === added.length - 1 ? { done: true } : {}) }));
  return added;
}

export async function loadPlan(sessionId: string): Promise<PlanRow> {
  const p = await prisma.defenseRoomPlan.findUnique({ where: { callSessionId: sessionId } });
  if (!p) throw errors.notFound('План защиты не найден');
  return { items: p.itemsJson as unknown as PlanItem[], cursor: p.cursor, source: p.sourceJson as unknown as SourceInfo };
}

export async function savePlan(sessionId: string, plan: Pick<PlanRow, 'items' | 'cursor'>): Promise<void> {
  await prisma.defenseRoomPlan.update({
    where: { callSessionId: sessionId },
    data: { itemsJson: plan.items as unknown as Prisma.InputJsonValue, cursor: plan.cursor },
  });
}

/** Взять ход: второй параллельный ход (двойной клик, ответ во время размьюта) получает 409. */
export async function lockPlan(sessionId: string): Promise<void> {
  const res = await prisma.defenseRoomPlan.updateMany({
    where: { callSessionId: sessionId, OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - PLAN_LOCK_MS) } }] },
    data: { lockedAt: new Date() },
  });
  if (res.count !== 1) throw new AppError('busy', 'Интервьюер ещё отвечает - подожди секунду', 409);
}

export async function tryLockPlan(sessionId: string): Promise<boolean> {
  try {
    await lockPlan(sessionId);
    return true;
  } catch {
    return false;
  }
}

export async function unlockPlan(sessionId: string): Promise<void> {
  await prisma.defenseRoomPlan.updateMany({ where: { callSessionId: sessionId }, data: { lockedAt: null } });
}

/** ИИ молчит, если его замьютил хотя бы один подключённый работодатель. */
export async function isAiMuted(sessionId: string): Promise<boolean> {
  const n = await prisma.callParticipant.count({ where: { callSessionId: sessionId, leftAt: null, aiMuted: true } });
  return n > 0;
}

export function asVerdict(json: unknown): DefenseRoomVerdict | null {
  return json && typeof json === 'object' ? (json as DefenseRoomVerdict) : null;
}
