import 'server-only';

import type { ObjectionStatus, ObjectionSubject, Prisma } from '@prisma/client';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { objectionDueAt } from '@/server/consent/objections';
import { pseudonym } from '@/server/employer/privacy';

import { audit, requireReason } from '../audit';
import type { StaffContext } from '../session';

import { objectionAnswerMail, sendAfterDecision } from './mails';

/**
 * Возражения кандидатов против автоматической оценки (152-ФЗ, ст. 16; срок ответа 30 дней) — очередь поддержки.
 * Решения: ответить; назначить пересмотр (повтор оценки другим сотрудником: возражение остаётся открытым, итоговый
 * ответ даёт только другой сотрудник); аннулировать попытку теста с объяснением. Категорию вручную не ставим
 * (R-C-06, принцип 2 E-08): аннулирование только снимает результат попытки.
 * Отметка «назначен пересмотр» хранится в журнале (`answer_objection.review`): своего поля в схеме нет.
 */

export type ObjectionDecision = 'answer' | 'review' | 'annul';

export interface SubjectPreview {
  kind: string;
  found: boolean;
  lines: string[];
  /** Попытка теста, которую можно аннулировать (только grade_test). */
  attemptId: string | null;
}

export interface ObjectionQueueItem {
  id: string;
  candidate: string;
  subject: ObjectionSubject;
  subjectId: string;
  text: string;
  status: ObjectionStatus;
  answer: string | null;
  createdAt: string;
  dueAt: string;
  /** Часы до срока (отрицательные — просрочено). */
  hoursLeft: number;
  review: { assignedById: string | null; assignedAt: string; note: string | null } | null;
  preview: SubjectPreview;
}

const fmt = (d: Date | null | undefined) => (d ? d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—');

type Db = Prisma.TransactionClient | typeof prisma;

/** Попытка, давшая категорию: по совпадению времени выдачи (связи attemptId в CandidateCategory нет). */
async function attemptForSubject(db: Db, candidateId: string, subjectId: string) {
  const direct = await db.testAttempt.findFirst({ where: { id: subjectId, candidateId } });
  if (direct) return direct;
  const cat = await db.candidateCategory.findFirst({ where: { id: subjectId, candidateId } });
  if (!cat) return null;
  return db.testAttempt.findFirst({ where: { candidateId, specialization: cat.specialization, OR: [{ finishedAt: cat.confirmedAt }, { juniorConfirmedAt: cat.confirmedAt }] } });
}

async function preview(candidateId: string, subject: ObjectionSubject, subjectId: string): Promise<SubjectPreview> {
  if (subject === 'grade_test') {
    const a = await attemptForSubject(prisma, candidateId, subjectId);
    if (!a) return { kind: 'Тест на грейд', found: false, lines: ['Попытка не найдена'], attemptId: null };
    const integrity = (a.integrity ?? null) as { level?: string; annulled?: unknown } | null;
    return {
      kind: 'Тест на грейд',
      found: true,
      attemptId: a.id,
      lines: [
        `${a.specialization} · заявлен ${a.grade} · статус ${a.status}${integrity?.annulled ? ' (аннулирована)' : ''}`,
        `θ ${a.theta?.toFixed(2) ?? '—'} · SE ${a.se?.toFixed(2) ?? '—'} · P(грейд) ${a.pPass?.toFixed(2) ?? '—'}`,
        `Индекс честности: ${integrity?.level ?? '—'} · завершена ${fmt(a.finishedAt)}`,
      ],
    };
  }
  const call = await prisma.callSession.findFirst({ where: { id: subjectId, candidateId }, select: { kind: true, status: true, startedAt: true, finishedAt: true, verdictJson: true } });
  if (call) {
    const verdict = call.verdictJson ? JSON.stringify(call.verdictJson).slice(0, 400) : 'вердикта нет';
    return { kind: subject === 'defense' ? 'Защита (созвон)' : 'Созвон', found: true, attemptId: null, lines: [`${call.kind} · ${call.status} · ${fmt(call.startedAt)} → ${fmt(call.finishedAt)}`, `Вердикт: ${verdict}`] };
  }
  const def = await prisma.defenseSession.findFirst({ where: { id: subjectId, candidateId }, select: { status: true, createdAt: true, completedAt: true, verdict: true } });
  if (def) {
    return { kind: 'Защита утверждения', found: true, attemptId: null, lines: [`${def.status} · ${fmt(def.createdAt)} → ${fmt(def.completedAt)}`, `Вердикт: ${def.verdict ? JSON.stringify(def.verdict).slice(0, 400) : 'нет'}`] };
  }
  return { kind: subject, found: false, lines: ['Предмет не найден'], attemptId: null };
}

async function reviewMarks(ids: string[]): Promise<Map<string, ObjectionQueueItem['review']>> {
  const rows = await prisma.adminAuditLog.findMany({ where: { targetType: 'objection', targetId: { in: ids }, action: 'answer_objection.review' }, orderBy: { createdAt: 'asc' }, select: { targetId: true, actorId: true, createdAt: true, reason: true } });
  const m = new Map<string, ObjectionQueueItem['review']>();
  for (const r of rows) if (r.targetId) m.set(r.targetId, { assignedById: r.actorId, assignedAt: r.createdAt.toISOString(), note: r.reason });
  return m;
}

/** Очередь: открытые — по сроку (раньше срок — выше); остальные — новые сверху. */
export async function listObjectionQueue(status: ObjectionStatus | 'all' = 'open', now = new Date()): Promise<ObjectionQueueItem[]> {
  const rows = await prisma.assessmentObjection.findMany({ where: status === 'all' ? {} : { status }, orderBy: { createdAt: status === 'open' ? 'asc' : 'desc' }, take: 100 });
  const marks = await reviewMarks(rows.map((r) => r.id));
  const out: ObjectionQueueItem[] = [];
  for (const r of rows) {
    const due = objectionDueAt(r.createdAt);
    out.push({
      id: r.id,
      candidate: pseudonym(r.candidateId),
      subject: r.subject,
      subjectId: r.subjectId,
      text: r.text,
      status: r.status,
      answer: r.answer,
      createdAt: r.createdAt.toISOString(),
      dueAt: due.toISOString(),
      hoursLeft: Math.floor((due.getTime() - now.getTime()) / 3_600_000),
      review: marks.get(r.id) ?? null,
      preview: await preview(r.candidateId, r.subject, r.subjectId),
    });
  }
  // createdAt + 30 дней монотонно по createdAt, но явная сортировка по сроку держит контракт при смене правила срока.
  if (status === 'open') out.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return out;
}

export interface ObjectionDecisionResult {
  id: string;
  decision: ObjectionDecision;
  status: ObjectionStatus;
  annulledAttemptId?: string;
  removedCategories?: number;
}

/**
 * Решение по возражению (право `answer_objection`). `text` — ответ кандидату (answer, annul) или заметка для пересмотра
 * (review); обязателен. Закрытое — 409. После назначенного пересмотра итог (answer/annul) даёт только другой сотрудник — 409.
 */
export async function decideObjection(staff: StaffContext, id: string, decision: ObjectionDecision, rawText: string): Promise<ObjectionDecisionResult> {
  const text = requireReason(rawText);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`objection:${id}`}))`;
    const before = await tx.assessmentObjection.findUnique({ where: { id } });
    if (!before) throw errors.notFound('Возражение не найдено');
    if (before.status !== 'open') throw errors.conflict('На возражение уже ответили');
    const mark = await tx.adminAuditLog.findFirst({ where: { targetType: 'objection', targetId: id, action: 'answer_objection.review' }, orderBy: { createdAt: 'desc' }, select: { actorId: true } });

    if (decision === 'review') {
      if (mark) throw errors.conflict('Пересмотр уже назначен');
      await audit({ actor: staff, action: 'answer_objection.review', target: { type: 'objection', id }, reason: text, before, after: { status: 'open', reviewAssigned: true } }, tx);
      return { id, decision, status: before.status } satisfies ObjectionDecisionResult;
    }
    if (mark && mark.actorId === staff.staffId) throw errors.conflict('Пересмотр назначили вы - итоговый ответ даёт другой сотрудник');

    let annul: { attemptId: string; removed: number } | null = null;
    if (decision === 'annul') {
      if (before.subject !== 'grade_test') throw errors.conflict('Аннулировать можно только попытку теста на грейд');
      const attempt = await attemptForSubject(tx, before.candidateId, before.subjectId);
      if (!attempt) throw errors.conflict('Попытка теста по этому возражению не найдена');
      if (attempt.status === 'active') throw errors.conflict('Попытка ещё идёт');
      const integ = (attempt.integrity ?? {}) as Record<string, unknown>;
      if (integ.annulled) throw errors.conflict('Попытка уже аннулирована');
      const confirmedBy = typeof integ.confirmedBy === 'string' ? await tx.testAttempt.findFirst({ where: { id: integ.confirmedBy, candidateId: before.candidateId }, select: { finishedAt: true } }) : null;
      const stamps = [attempt.finishedAt, attempt.juniorConfirmedAt, confirmedBy?.finishedAt].filter((d): d is Date => !!d);
      const categories = stamps.length
        ? await tx.candidateCategory.findMany({ where: { candidateId: before.candidateId, specialization: attempt.specialization, source: 'test', confirmedAt: { in: stamps } } })
        : [];
      if (categories.length) await tx.candidateCategory.deleteMany({ where: { id: { in: categories.map((c) => c.id) } } });
      const now = new Date();
      const integrity = { ...integ, annulled: { at: now.toISOString(), byStaffId: staff.staffId, reason: text, previousStatus: attempt.status, objectionId: id } };
      const attemptAfter = await tx.testAttempt.update({ where: { id: attempt.id }, data: { status: 'abandoned', integrity: integrity as Prisma.InputJsonValue }, select: { id: true, status: true } });
      await audit(
        { actor: staff, action: 'answer_objection.annul_attempt', target: { type: 'candidate', id: before.candidateId }, reason: text, before: { attempt: { id: attempt.id, status: attempt.status }, categories }, after: { attempt: attemptAfter, removedCategoryIds: categories.map((c) => c.id) } },
        tx,
      );
      annul = { attemptId: attempt.id, removed: categories.length };
    }
    const after = await tx.assessmentObjection.update({ where: { id }, data: { status: 'answered', answer: text, answeredAt: new Date(), answeredById: staff.staffId } });
    await audit({ actor: staff, action: `answer_objection.${decision}`, target: { type: 'objection', id }, reason: text, before, after: { ...after, annulledAttemptId: annul?.attemptId ?? null } }, tx);
    return { id, decision, status: after.status, ...(annul ? { annulledAttemptId: annul.attemptId, removedCategories: annul.removed } : {}), candidateId: before.candidateId };
  });
  if (decision !== 'review' && 'candidateId' in result) {
    const c = await prisma.candidate.findUnique({ where: { id: result.candidateId as string }, select: { email: true } });
    await sendAfterDecision('objection_answer', c?.email, (to) => objectionAnswerMail(to, { answer: text, annulled: decision === 'annul' }));
    const r = result as ObjectionDecisionResult & { candidateId: string };
    return { id: r.id, decision: r.decision, status: r.status, ...(r.annulledAttemptId ? { annulledAttemptId: r.annulledAttemptId, removedCategories: r.removedCategories } : {}) };
  }
  return result;
}
