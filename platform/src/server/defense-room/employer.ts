import { prisma } from '../db';
import type { EmployerContext } from '../employer/context';
import { AppError, errors } from '../errors';
import type { LlmProvider } from '../llm/types';
import type { SessionPrincipal } from '../session';
import { employerMayAccess, redactSnapshot, resolveViewer, type Viewer } from './access';
import { publish } from './bus';
import { buildSnapshot, employerItem, ICE_SERVERS, resumeAi } from './session';
import { appendEntries, asVerdict, isAiMuted, loadPlan, savePlan, tryLockPlan, unlockPlan } from './store';
import type { CallSnapshot, DefenseFlag, TranscriptEntry } from './types';

/**
 * Работодатель в защите проекта: подключиться к живой сессии, замьютить ИИ, сказать реплику,
 * оставить вопрос в очереди. Всё — только при принятом приглашении (access.ts).
 */

export const EMPLOYER_QUESTION_LIMITS = { minChars: 5, maxChars: 1000, maxQueuedPerCandidate: 10, maxSayChars: 1000 } as const;

type EmployerViewer = Extract<Viewer, { role: 'employer' }>;

async function employerViewer(principal: SessionPrincipal | null, sessionId: string) {
  const { viewer, session } = await resolveViewer(principal, sessionId);
  if (viewer.role !== 'employer') throw errors.forbidden('Доступно только работодателю');
  return { viewer, session };
}

async function activeParticipant(sessionId: string, userId: string) {
  return prisma.callParticipant.findFirst({ where: { callSessionId: sessionId, userId, leftAt: null } });
}

export interface JoinResult {
  participantId: string;
  webrtc: { iceServers: { urls: string }[] };
  snapshot: CallSnapshot;
}

export async function joinCall(principal: SessionPrincipal | null, sessionId: string): Promise<JoinResult> {
  const { viewer, session } = await employerViewer(principal, sessionId);
  if (session.status !== 'active') throw errors.conflict('Защита уже завершена - доступен транскрипт');
  let p = await activeParticipant(sessionId, viewer.userId);
  if (!p) {
    // Одна компания в эфире: иначе компании услышат и увидят друг друга.
    const others = await prisma.callParticipant.findMany({ where: { callSessionId: sessionId, leftAt: null }, select: { userId: true } });
    if (others.length) {
      const sameCompany = await prisma.employerProfile.count({ where: { userId: { in: others.map((o) => o.userId) }, companyId: viewer.companyId } });
      if (sameCompany !== others.length) throw new AppError('room_busy', 'К этой защите сейчас подключена другая компания', 409);
    }
    p = await prisma.callParticipant.create({ data: { callSessionId: sessionId, userId: viewer.userId, role: 'employer' } });
    publish(sessionId, { type: 'participant', userId: viewer.userId, role: 'employer', action: 'joined', companyId: viewer.companyId, companyName: viewer.companyName });
  }
  return { participantId: p.id, webrtc: { iceServers: ICE_SERVERS }, snapshot: redactSnapshot(await buildSnapshot(sessionId), viewer) };
}

export async function leaveCall(principal: SessionPrincipal | null, sessionId: string, llm: LlmProvider): Promise<{ left: boolean }> {
  const { viewer } = await employerViewer(principal, sessionId);
  const p = await activeParticipant(sessionId, viewer.userId);
  if (!p) return { left: false };
  await prisma.callParticipant.update({ where: { id: p.id }, data: { leftAt: new Date() } });
  publish(sessionId, { type: 'participant', userId: viewer.userId, role: 'employer', action: 'left', companyId: viewer.companyId, companyName: viewer.companyName });
  if (p.aiMuted) {
    publish(sessionId, { type: 'mute', aiMuted: await isAiMuted(sessionId), userId: viewer.userId });
    await resumeAi(sessionId, llm);
  }
  return { left: true };
}

async function requireJoined(viewer: EmployerViewer, sessionId: string, status: string) {
  if (status !== 'active') throw errors.conflict('Защита уже завершена');
  const p = await activeParticipant(sessionId, viewer.userId);
  if (!p) throw errors.conflict('Сначала подключись к защите');
  return p;
}

/** «ИИ молчит / говорит». Размьют: если последним говорил кандидат, ИИ продолжает по плану. */
export async function muteAi(principal: SessionPrincipal | null, sessionId: string, muted: boolean, llm: LlmProvider): Promise<{ muted: boolean; aiText: string | null }> {
  const { viewer, session } = await employerViewer(principal, sessionId);
  const p = await requireJoined(viewer, sessionId, session.status);
  await prisma.callParticipant.update({ where: { id: p.id }, data: { aiMuted: muted } });
  publish(sessionId, { type: 'mute', aiMuted: await isAiMuted(sessionId), userId: viewer.userId });
  const resumed = muted ? null : await resumeAi(sessionId, llm);
  return { muted, aiText: resumed?.text ?? null };
}

/** Реплика работодателя в транскрипт; кандидат слышит её вторым голосом TTS (или вживую, если поднялось P2P-аудио). */
export async function employerSay(principal: SessionPrincipal | null, sessionId: string, rawText: string): Promise<{ entry: TranscriptEntry }> {
  const { viewer, session } = await employerViewer(principal, sessionId);
  await requireJoined(viewer, sessionId, session.status);
  const text = rawText.trim();
  if (!text) throw errors.badRequest('Пустая реплика');
  if (text.length > EMPLOYER_QUESTION_LIMITS.maxSayChars) throw errors.payloadTooLarge(`Реплика длиннее ${EMPLOYER_QUESTION_LIMITS.maxSayChars} символов`);
  const [entry] = await appendEntries(sessionId, [{ role: 'employer', text, userId: viewer.userId, defense: { speaker: viewer.companyName, companyId: viewer.companyId } }]);
  return { entry: entry! };
}

// ---------------------------------------------------------------------------
// Асинхронные вопросы (очередь)
// ---------------------------------------------------------------------------
export interface EmployerQuestionView {
  id: string;
  text: string;
  status: 'queued' | 'asked' | 'answered';
  askedAt: string;
  projectSubmissionId: string | null;
  answeredInCallSessionId: string | null;
  /** Ответ кандидата из транскрипта (после answered). */
  answer: string | null;
}

export async function createEmployerQuestion(
  ctx: EmployerContext,
  input: { candidateId: string; text: string; projectSubmissionId?: string },
): Promise<EmployerQuestionView> {
  if (!(await employerMayAccess(ctx.companyId, input.candidateId))) throw errors.notFound('Кандидат не найден');
  const text = input.text.trim();
  if (text.length < EMPLOYER_QUESTION_LIMITS.minChars) throw errors.badRequest('Вопрос слишком короткий');
  const queued = await prisma.employerQuestion.count({ where: { companyId: ctx.companyId, candidateId: input.candidateId, status: { in: ['queued', 'asked'] } } });
  if (queued >= EMPLOYER_QUESTION_LIMITS.maxQueuedPerCandidate) {
    throw errors.rateLimited(`В очереди уже ${queued} вопросов этому кандидату - дождись ответов`);
  }
  if (input.projectSubmissionId) {
    const sub = await prisma.projectSubmission.findUnique({ where: { id: input.projectSubmissionId }, select: { candidateId: true } });
    if (!sub || sub.candidateId !== input.candidateId) throw errors.notFound('Сабмит не найден');
  }
  const q = await prisma.employerQuestion.create({
    data: { companyId: ctx.companyId, candidateId: input.candidateId, projectSubmissionId: input.projectSubmissionId ?? null, text },
  });
  await attachToLiveSession(q, ctx.companyName);
  return toView(q, null);
}

/** Кандидат сейчас на защите — вопрос встаёт в конец её плана (если ход свободен; иначе ждёт следующего входа). */
async function attachToLiveSession(q: { id: string; text: string; companyId: string; candidateId: string; projectSubmissionId: string | null }, companyName: string) {
  const live = await prisma.callSession.findFirst({
    where: {
      candidateId: q.candidateId,
      kind: 'defense',
      status: 'active',
      ...(q.projectSubmissionId ? { OR: [{ projectSubmissionId: q.projectSubmissionId }, { projectSubmissionId: null }] } : {}),
    },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  if (!live || !(await tryLockPlan(live.id))) return;
  try {
    const plan = await loadPlan(live.id);
    plan.items.push(employerItem({ id: q.id, text: q.text, companyId: q.companyId, companyName }));
    await savePlan(live.id, plan);
    publish(live.id, { type: 'question', questionId: q.id, companyId: q.companyId, status: 'queued' });
  } finally {
    await unlockPlan(live.id);
  }
}

function toView(
  q: { id: string; text: string; status: 'queued' | 'asked' | 'answered'; askedAt: Date; projectSubmissionId: string | null; answeredInCallSessionId: string | null },
  answer: string | null,
): EmployerQuestionView {
  return {
    id: q.id,
    text: q.text,
    status: q.status,
    askedAt: q.askedAt.toISOString(),
    projectSubmissionId: q.projectSubmissionId,
    answeredInCallSessionId: q.answeredInCallSessionId,
    answer,
  };
}

/** Ответ кандидата — реплики кандидата после вопроса ИИ с этим пунктом плана, до следующего вопроса. */
export function answerFor(transcript: TranscriptEntry[], questionId: string): string | null {
  const itemId = `e-${questionId}`;
  const out: string[] = [];
  let inside = false;
  for (const e of transcript) {
    if (e.role === 'ai') inside = e.defense?.itemId === itemId;
    else if (e.role === 'candidate' && inside) out.push(e.text);
  }
  return out.length ? out.join('\n') : null;
}

export async function listEmployerQuestions(ctx: EmployerContext, candidateId: string): Promise<EmployerQuestionView[]> {
  if (!(await employerMayAccess(ctx.companyId, candidateId))) throw errors.notFound('Кандидат не найден');
  const rows = await prisma.employerQuestion.findMany({ where: { companyId: ctx.companyId, candidateId }, orderBy: [{ askedAt: 'desc' }, { id: 'asc' }], take: 50 });
  const sessionIds = [...new Set(rows.map((r) => r.answeredInCallSessionId).filter((x): x is string => !!x))];
  const sessions = await prisma.callSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, transcriptJson: true } });
  const t = new Map(sessions.map((s) => [s.id, (s.transcriptJson as unknown as TranscriptEntry[]) ?? []]));
  return rows.map((r) => toView(r, r.answeredInCallSessionId ? answerFor(t.get(r.answeredInCallSessionId) ?? [], r.id) : null));
}

// ---------------------------------------------------------------------------
// Список защит для кабинета работодателя
// ---------------------------------------------------------------------------
export interface EmployerCallRow {
  id: string;
  candidateId: string;
  candidateName: string;
  status: 'active' | 'finished' | 'cancelled';
  mode: 'project' | 'questions';
  startedAt: string;
  finishedAt: string | null;
  total: number | null;
  flags: DefenseFlag[];
}

/** Защиты кандидатов, принявших приглашение компании: идущие сверху. */
export async function listEmployerCalls(ctx: EmployerContext): Promise<EmployerCallRow[]> {
  const accepted = await prisma.invitation.findMany({ where: { companyId: ctx.companyId, status: 'accepted' }, select: { candidateId: true } });
  const ids = [...new Set(accepted.map((a) => a.candidateId))];
  if (!ids.length) return [];
  const rows = await prisma.callSession.findMany({
    where: { candidateId: { in: ids }, kind: 'defense' },
    orderBy: [{ startedAt: 'desc' }],
    take: 100,
    select: { id: true, candidateId: true, status: true, startedAt: true, finishedAt: true, verdictJson: true, projectSubmissionId: true },
  });
  const names = new Map((await prisma.candidate.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return rows
    .map((r) => {
      const v = asVerdict(r.verdictJson);
      return {
        id: r.id,
        candidateId: r.candidateId,
        candidateName: names.get(r.candidateId) ?? 'Кандидат',
        status: r.status,
        mode: r.projectSubmissionId ? ('project' as const) : ('questions' as const),
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        total: v?.total ?? null,
        flags: v?.flags ?? [],
      };
    })
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'));
}
