// Возражения против автоматической оценки (ст. 16 152-ФЗ, ADR 0005). Кандидат оспаривает категорию из теста,
// оценку созвона или защиты; срок ответа — OBJECTION_ANSWER_DAYS дней. Работодатель возражений не видит:
// их нет ни в одной выдаче работодателю. Ответ — оператор через dev-панель (/api/dev/objections).
import type { ObjectionSubject } from '@prisma/client';

import { prisma } from '../db';
import { errors } from '../errors';

import { OBJECTION_ANSWER_DAYS } from './texts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ObjectionView {
  id: string;
  subject: ObjectionSubject;
  subjectId: string;
  text: string;
  status: 'open' | 'answered';
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
  /** Крайний срок ответа: createdAt + 30 дней. */
  dueAt: string;
}

export function objectionDueAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + OBJECTION_ANSWER_DAYS * DAY_MS);
}

type Row = { id: string; subject: ObjectionSubject; subjectId: string; text: string; status: 'open' | 'answered'; answer: string | null; createdAt: Date; answeredAt: Date | null };

const view = (r: Row): ObjectionView => ({
  id: r.id,
  subject: r.subject,
  subjectId: r.subjectId,
  text: r.text,
  status: r.status,
  answer: r.answer,
  createdAt: r.createdAt.toISOString(),
  answeredAt: r.answeredAt?.toISOString() ?? null,
  dueAt: objectionDueAt(r.createdAt).toISOString(),
});

/** Оспариваемый результат принадлежит кандидату (иначе 404). */
async function assertOwnSubject(candidateId: string, subject: ObjectionSubject, subjectId: string): Promise<void> {
  const own = { id: subjectId, candidateId };
  let n = 0;
  if (subject === 'grade_test') n = (await prisma.testAttempt.count({ where: own })) + (await prisma.candidateCategory.count({ where: own }));
  if (subject === 'call') n = await prisma.callSession.count({ where: { ...own, kind: { not: 'defense' } } });
  if (subject === 'defense') n = (await prisma.defenseSession.count({ where: own })) + (await prisma.callSession.count({ where: { ...own, kind: 'defense' } }));
  if (n === 0) throw errors.notFound('Результат не найден');
}

/** Оспорить оценку. Повтор по тому же результату, пока прошлое возражение открыто, — 409. */
export async function createObjection(candidateId: string, input: { subject: ObjectionSubject; subjectId: string; text: string }): Promise<ObjectionView> {
  await assertOwnSubject(candidateId, input.subject, input.subjectId);
  const open = await prisma.assessmentObjection.count({ where: { candidateId, subject: input.subject, subjectId: input.subjectId, status: 'open' } });
  if (open > 0) throw errors.conflict('Возражение по этому результату уже рассматривается');
  return view(await prisma.assessmentObjection.create({ data: { candidateId, ...input } }));
}

export async function listObjections(candidateId: string): Promise<ObjectionView[]> {
  return (await prisma.assessmentObjection.findMany({ where: { candidateId }, orderBy: { createdAt: 'desc' } })).map(view);
}

/** Для оператора (dev-панель): все открытые, старые первыми. */
export async function listOpenObjections(): Promise<(ObjectionView & { candidateId: string })[]> {
  const rows = await prisma.assessmentObjection.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'asc' }, take: 100 });
  return rows.map((r) => ({ ...view(r), candidateId: r.candidateId }));
}

export async function answerObjection(id: string, answer: string): Promise<ObjectionView> {
  const r = await prisma.assessmentObjection.updateMany({ where: { id, status: 'open' }, data: { status: 'answered', answer, answeredAt: new Date() } });
  if (r.count === 0) throw errors.conflict('Возражение не найдено или уже с ответом');
  return view((await prisma.assessmentObjection.findUnique({ where: { id } }))!);
}
