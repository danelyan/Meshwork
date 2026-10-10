import type { Prisma } from '@prisma/client';

import { countOf } from '@/lib/plural';

import { CALL_RECORDING_CONSENT_VERSION, callRecordingMode } from '../call/consent';
import { assertAiAssessmentConsent } from '../consent/service';
import { CALL_LIMITS } from '../call/plan';
import { prisma } from '../db';
import { getEnv } from '../env';
import { AppError, errors } from '../errors';
import type { LlmProvider } from '../llm/types';
import { publish } from './bus';
import { decideFollowUp, neutralAck } from './interviewer';
import { generateQlc, summarizeProjectResult } from './qlc';
import { loadRepoSnapshot } from './repo';
import {
  appendEntries,
  asTranscript,
  asVerdict,
  isAiMuted,
  loadPlan,
  lockPlan,
  savePlan,
  unlockPlan,
  type NewEntry,
  type SourceInfo,
} from './store';
import type { AiUtteranceMeta, CallSnapshot, DefenseEntryExt, DefenseMode, DefenseRoomVerdict, PlanItem, RepoSnapshot, TranscriptEntry } from './types';
import { evaluateDefenseRoom } from './verdict';

/**
 * Сессия защиты проекта (ступень 3 ADR 0003): CallSession.kind = defense.
 * Интервьюер ведёт по плану — вопросы по коду (QLC) и вопросы работодателя из очереди; кандидат
 * отвечает текстом (голос → /api/stt → текст); работодатель может подключиться, говорить и
 * замьютить ИИ. Завершение — слепой оценщик ×3 (verdict.ts). Уровни утверждений не меняются:
 * защита проекта даёт работодателю оценку и флаги, категорию задаёт только тест (ADR 0002).
 */

export const DEFENSE_POLICY_VERSION = 'defense-room-v1-2026-10-10';
/** Публичный STUN, без TURN (ADR 0003): за симметричным NAT аудио не поднимется — клиент уходит в текст. */
export const ICE_SERVERS: { urls: string }[] = [{ urls: 'stun:stun.l.google.com:19302' }];
export const DEFENSE_ROOM_LIMITS = {
  /** Завершённых защит одного сабмита (ПРЕДЛОЖЕНИЕ). */
  maxDefensesPerSubmission: 3,
  maxAnswerChars: 4000,
} as const;

export interface StartInput {
  mode: DefenseMode;
  projectSubmissionId?: string;
}

export interface StartDeps {
  loadSnapshot?: (repoUrl: string, commitSha: string | null) => Promise<RepoSnapshot>;
}

export interface StartResult {
  sessionId: string;
  resumed: boolean;
  webrtc: { iceServers: { urls: string }[] };
  snapshot: CallSnapshot;
}

function repoTitle(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).slice(0, 2).join('/').replace(/\.git$/, '') || url;
  } catch {
    return url;
  }
}

async function queuedQuestions(candidateId: string, projectSubmissionId: string | null) {
  const rows = await prisma.employerQuestion.findMany({
    where: {
      candidateId,
      status: 'queued',
      ...(projectSubmissionId ? { OR: [{ projectSubmissionId: null }, { projectSubmissionId }] } : {}),
    },
    orderBy: [{ askedAt: 'asc' }, { id: 'asc' }],
    take: 10,
  });
  const companies = await prisma.company.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { id: true, name: true } });
  const name = new Map(companies.map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...r, companyName: name.get(r.companyId) ?? 'компания' }));
}

export function employerItem(q: { id: string; text: string; companyId: string; companyName: string }): PlanItem {
  return { source: 'employer', id: `e-${q.id}`, employerQuestionId: q.id, companyId: q.companyId, companyName: q.companyName, question: q.text, answered: false, followUps: 0 };
}

/** Текст вопроса плана, как его произносит ИИ. */
export function itemSpeech(item: PlanItem): string {
  return item.source === 'employer' ? `Вопрос от компании «${item.companyName}»: ${item.question}` : item.question;
}

/** Пометки вопроса ИИ в форме лейна call (meta) — по ним работает и `questionTurns` лейна call. */
export function itemMeta(item: PlanItem, level: 1 | 2 | 3): AiUtteranceMeta {
  if (item.source === 'employer') return { topic: `вопрос работодателя · ${item.companyName}`, catalogId: null, level, routedBy: null, employerQuestionId: item.employerQuestionId };
  return { topic: item.ref ? `${item.type} · ${item.ref}` : item.type, catalogId: null, level: item.type === 'constraint' ? 3 : level, routedBy: null };
}

function itemEntry(item: PlanItem, prefix: string, kind: NonNullable<DefenseEntryExt['kind']>): NewEntry {
  return {
    role: 'ai',
    text: `${prefix}${itemSpeech(item)}`.trim(),
    meta: itemMeta(item, kind === 'return' ? 2 : 1),
    defense: { itemId: item.id, kind, ...(item.source === 'employer' ? { companyId: item.companyId } : {}) },
  };
}

async function markAsked(item: PlanItem | undefined, sessionId: string): Promise<void> {
  if (item?.source !== 'employer') return;
  await prisma.employerQuestion.updateMany({ where: { id: item.employerQuestionId, status: 'queued' }, data: { status: 'asked' } });
  publish(sessionId, { type: 'question', questionId: item.employerQuestionId, companyId: item.companyId, status: 'asked' });
}

// ---------------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------------
export async function startDefenseRoom(candidateId: string, input: StartInput, llm: LlmProvider, deps: StartDeps = {}): Promise<StartResult> {
  if (input.mode === 'project' && !input.projectSubmissionId) throw errors.badRequest('Нужен projectSubmissionId');
  const submissionId = input.mode === 'project' ? input.projectSubmissionId! : null;

  const submission = submissionId
    ? await prisma.projectSubmission.findUnique({
        where: { id: submissionId },
        select: { id: true, candidateId: true, repoUrl: true, commitSha: true, aiLogText: true, resultJson: true },
      })
    : null;
  if (submissionId && (!submission || submission.candidateId !== candidateId)) throw errors.notFound('Сабмит проекта не найден');
  // Защита — тоже созвон: то же отдельное согласие на запись, что у лейна call (ADR 0003, п. 4).
  // Г3 (ADR 0005): защиту оценивает ИИ. Г2: согласия на запись не было — спросить; отозвано — защита текстом.
  await assertAiAssessmentConsent(candidateId);
  if ((await callRecordingMode(candidateId)) === 'ask') {
    throw new AppError('call_consent_required', 'Перед защитой нужно согласие на запись созвона', 403, { version: CALL_RECORDING_CONSENT_VERSION });
  }

  const active = await prisma.callSession.findFirst({
    where: { candidateId, kind: 'defense', status: 'active', projectSubmissionId: submissionId },
    select: { id: true },
  });
  if (active) return { sessionId: active.id, resumed: true, webrtc: { iceServers: ICE_SERVERS }, snapshot: await buildSnapshot(active.id) };

  // Общий суточный лимит с созвонами лейна call: защита и квалифицирующий созвон считаются вместе.
  const dailyLimit = getEnv().CALL_DAILY_LIMIT;
  if (dailyLimit > 0) {
    // pending — приглашение работодателя, а не созвон: в лимит не считается.
    const recent = await prisma.callSession.count({ where: { candidateId, status: { not: 'pending' }, startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
    if (recent >= dailyLimit) throw new AppError('call_limit', `Не больше ${dailyLimit} созвонов и защит в сутки - попробуй завтра`, 429);
  }

  if (submissionId) {
    const done = await prisma.callSession.count({ where: { candidateId, kind: 'defense', status: 'finished', projectSubmissionId: submissionId } });
    if (done >= DEFENSE_ROOM_LIMITS.maxDefensesPerSubmission) {
      throw new AppError('defense_attempts_exhausted', `Проект можно защитить не больше ${DEFENSE_ROOM_LIMITS.maxDefensesPerSubmission} раз`, 429);
    }
  }

  const queue = await queuedQuestions(candidateId, submissionId);
  let items: PlanItem[];
  let source: SourceInfo;
  if (submission) {
    // Репозиторий и LLM — вне транзакции (медленно); ошибка чтения репозитория — понятный 4xx/5xx из collector.
    const snapshot = await (deps.loadSnapshot ?? loadRepoSnapshot)(submission.repoUrl, submission.commitSha);
    const qlc = await generateQlc(
      { snapshot, projectResult: summarizeProjectResult(submission.resultJson), aiLogText: submission.aiLogText },
      llm,
    );
    const code = qlc.questions.map((q): PlanItem => ({ source: 'qlc', ...q, answered: false, followUps: 0 }));
    // Первый вопрос по коду, затем вопросы работодателя (чтобы не потерялись, если кандидат уйдёт), затем остальное.
    items = [...code.slice(0, 1), ...queue.map(employerItem), ...code.slice(1)];
    source = {
      mode: 'project',
      repoUrl: submission.repoUrl,
      commitSha: snapshot.commitSha,
      projectTitle: repoTitle(submission.repoUrl),
      generator: qlc.generator,
      files: snapshot.files.length,
      fragments: qlc.fragments,
      truncated: snapshot.truncated,
      policyVersion: DEFENSE_POLICY_VERSION,
    };
  } else {
    if (!queue.length) throw errors.conflict('Вопросов от работодателей нет');
    items = queue.map(employerItem);
    source = { mode: 'questions', repoUrl: null, commitSha: null, projectTitle: 'ответы на вопросы работодателей', generator: 'none', files: 0, fragments: 0, policyVersion: DEFENSE_POLICY_VERSION };
  }

  const first = items[0]!;
  const greeting =
    source.mode === 'project'
      ? `Привет! Это защита проекта ${source.projectTitle}. Я задам ${countOf(items.length, ['вопрос', 'вопроса', 'вопросов'])} по твоему коду и решениям; отвечай своими словами, «не знаю» - тоже честный ответ. `
      : `Привет! У работодателей есть к тебе вопросы: ${items.length}. Отвечай своими словами. `;

  const session = await prisma.$transaction(async (tx) => {
    // Ожидающая защита по приглашению работодателя (pending.ts) — её и начинаем, а не заводим вторую.
    const pending = submissionId
      ? await tx.callSession.findFirst({ where: { candidateId, kind: 'defense', status: 'pending', projectSubmissionId: submissionId }, orderBy: { startedAt: 'asc' }, select: { id: true } })
      : null;
    const activated = pending
      ? await tx.callSession.updateMany({
          where: { id: pending.id, status: 'pending' },
          data: { status: 'active', startedAt: new Date(), policyVersion: CALL_RECORDING_CONSENT_VERSION },
        })
      : { count: 0 };
    const s =
      pending && activated.count === 1
        ? pending
        : await tx.callSession.create({
            data: { candidateId, kind: 'defense', projectSubmissionId: submissionId, status: 'active', policyVersion: CALL_RECORDING_CONSENT_VERSION, transcriptJson: [] },
            select: { id: true },
          });
    await tx.defenseRoomPlan.create({
      data: { callSessionId: s.id, itemsJson: items as unknown as Prisma.InputJsonValue, cursor: 0, sourceJson: source as unknown as Prisma.InputJsonValue },
    });
    return s;
  });
  await appendEntries(session.id, [{ ...itemEntry(first, greeting, 'greeting') }]);
  await markAsked(first, session.id);
  return { sessionId: session.id, resumed: false, webrtc: { iceServers: ICE_SERVERS }, snapshot: await buildSnapshot(session.id) };
}

// ---------------------------------------------------------------------------
// Ход кандидата и реакция ИИ
// ---------------------------------------------------------------------------
export interface TurnResult {
  /** Реплика ИИ (null — ИИ замьючен или ждёт работодателя). */
  text: string | null;
  muted: boolean;
  /** План исчерпан: клиент вызывает finish. */
  done: boolean;
}

async function loadOwn(candidateId: string, sessionId: string) {
  const s = await prisma.callSession.findUnique({ where: { id: sessionId }, select: { id: true, candidateId: true, kind: true, status: true } });
  if (!s || s.candidateId !== candidateId || s.kind !== 'defense') throw errors.notFound('Сессия защиты не найдена');
  return s;
}

/** Последняя реплика не-кандидата перед последней репликой кандидата. */
function lastAsker(transcript: TranscriptEntry[]): TranscriptEntry | undefined {
  let i = transcript.length - 1;
  while (i >= 0 && transcript[i]!.role === 'candidate') i--;
  return i >= 0 ? transcript[i] : undefined;
}

export async function candidateTurn(candidateId: string, sessionId: string, rawText: string, llm: LlmProvider): Promise<TurnResult> {
  const text = rawText.replace(/\r\n/g, '\n').trim();
  if (text.length > DEFENSE_ROOM_LIMITS.maxAnswerChars) throw new AppError('answer_too_long', `Ответ длиннее ${DEFENSE_ROOM_LIMITS.maxAnswerChars} символов`, 400);
  const s = await loadOwn(candidateId, sessionId);
  if (s.status !== 'active') throw errors.conflict('Сессия защиты уже завершена');
  await lockPlan(sessionId);
  try {
    const before = await prisma.callSession.findUniqueOrThrow({ where: { id: sessionId }, select: { transcriptJson: true } });
    const asker = lastAsker(asTranscript(before.transcriptJson));
    // Ответ на вопрос или реплику компании помечается её companyId: другая компания его не увидит (access.ts).
    const askerCompany = asker?.defense?.companyId;
    await appendEntries(sessionId, [{ role: 'candidate', text: text || '(молчание)', ...(askerCompany ? { defense: { companyId: askerCompany } } : {}) }]);

    const plan = await loadPlan(sessionId);
    const current = plan.items[plan.cursor];
    // Ответ засчитывается пункту плана, только если перед ним спрашивал ИИ по этому пункту.
    const answeredCurrent = !!current && asker?.role === 'ai' && asker.defense?.itemId === current.id;
    if (answeredCurrent) {
      current.answered = true;
      if (current.source === 'employer') {
        await prisma.employerQuestion.updateMany({
          where: { id: current.employerQuestionId, status: { in: ['queued', 'asked'] } },
          data: { status: 'answered', answeredInCallSessionId: sessionId },
        });
        publish(sessionId, { type: 'question', questionId: current.employerQuestionId, companyId: current.companyId, status: 'answered' });
      }
      await savePlan(sessionId, plan);
    }
    if (await isAiMuted(sessionId)) return { text: null, muted: true, done: plan.cursor >= plan.items.length };
    publish(sessionId, { type: 'ai_state', state: 'thinking' });
    try {
      return await respond(sessionId, plan, { answer: text, allowFollowUp: answeredCurrent, llm });
    } finally {
      publish(sessionId, { type: 'ai_state', state: 'idle' });
    }
  } finally {
    await unlockPlan(sessionId);
  }
}

/** Следующая реплика ИИ по плану: уточнение, возврат к вопросу после реплики работодателя или следующий вопрос. */
async function respond(
  sessionId: string,
  plan: { items: PlanItem[]; cursor: number },
  opts: { answer: string; allowFollowUp: boolean; llm: LlmProvider },
): Promise<TurnResult> {
  const current = plan.items[plan.cursor];
  const seq = plan.cursor;
  if (current && !current.answered && current.followUps > 0) {
    // На вопрос уже был ответ, ИИ уточнял, а дальше вмешался работодатель: не повторять вопрос, идти дальше.
    current.answered = true;
  }
  if (current && !current.answered) {
    // Кандидат отвечал работодателю (или ИИ был замьючен) — вернуть разговор к открытому вопросу.
    const [e] = await appendEntries(sessionId, [itemEntry(current, 'Спасибо. Вернёмся к вопросу. ', 'return')]);
    return { text: e!.text, muted: false, done: false };
  }
  let ack = neutralAck(seq);
  if (current && opts.allowFollowUp) {
    const step = await decideFollowUp(current, opts.answer, seq, opts.llm);
    ack = /[.!?…]$/.test(step.ack) ? step.ack : `${step.ack}.`;
    if (step.followUp) {
      current.followUps += 1;
      current.answered = false;
      await savePlan(sessionId, plan);
      const [e] = await appendEntries(sessionId, [
        { role: 'ai', text: step.followUp, meta: itemMeta(current, 2), defense: { itemId: current.id, kind: 'followup', ...(current.source === 'employer' ? { companyId: current.companyId } : {}) } },
      ]);
      return { text: e!.text, muted: false, done: false };
    }
  }
  plan.cursor = Math.min(plan.items.length, plan.cursor + (current ? 1 : 0));
  await savePlan(sessionId, plan);
  const next = plan.items[plan.cursor];
  if (next) {
    const [e] = await appendEntries(sessionId, [itemEntry(next, `${ack} `, 'question')]);
    await markAsked(next, sessionId);
    return { text: e!.text, muted: false, done: false };
  }
  const [e] = await appendEntries(
    sessionId,
    [{ role: 'ai', text: `${ack} Это все вопросы. Завершаю защиту и передаю ответы оценщику - результат появится через несколько секунд.`, defense: { kind: 'closing' } }],
    { done: true },
  );
  return { text: e!.text, muted: false, done: true };
}

/**
 * ИИ снова говорит (размьют): если последним говорил кандидат, ИИ продолжает по плану без
 * уточнений. Ход занят — ничего не делаем: продолжение случится на следующем ответе кандидата.
 */
export async function resumeAi(sessionId: string, llm: LlmProvider): Promise<TurnResult | null> {
  const s = await prisma.callSession.findUnique({ where: { id: sessionId }, select: { status: true, transcriptJson: true } });
  if (!s || s.status !== 'active') return null;
  const t = asTranscript(s.transcriptJson);
  if (t[t.length - 1]?.role !== 'candidate') return null;
  if (await isAiMuted(sessionId)) return null;
  try {
    await lockPlan(sessionId);
  } catch {
    return null;
  }
  try {
    const plan = await loadPlan(sessionId);
    return await respond(sessionId, plan, { answer: '', allowFollowUp: false, llm });
  } finally {
    await unlockPlan(sessionId);
  }
}

// ---------------------------------------------------------------------------
// Завершение
// ---------------------------------------------------------------------------
async function storedVerdict(sessionId: string): Promise<DefenseRoomVerdict> {
  const stored = await prisma.callSession.findUnique({ where: { id: sessionId }, select: { verdictJson: true, status: true } });
  const v = asVerdict(stored?.verdictJson);
  if (v) return v;
  throw errors.conflict(stored?.status === 'cancelled' ? 'Защита закрыта без оценки' : 'Сессия защиты уже завершена');
}

/**
 * Завершение. Два параллельных finish (двойной клик, две вкладки) сериализуются блокировкой хода
 * (DefenseRoomPlan.lockedAt): второй получает 409 `busy`, а не второй запуск оценщика. Запуски оценщика
 * считаются в CallSession.finishAttempts (≤ CALL_LIMITS.maxFinishAttempts, как у лейна call): после
 * последней неудачи сессия закрывается без оценки, транскрипт остаётся.
 */
export async function finishDefenseRoom(candidateId: string, sessionId: string, llm: LlmProvider): Promise<DefenseRoomVerdict> {
  const s = await loadOwn(candidateId, sessionId);
  if (s.status !== 'active') return storedVerdict(sessionId);
  await lockPlan(sessionId);
  try {
    return await finishLocked(sessionId, llm);
  } finally {
    await unlockPlan(sessionId);
  }
}

async function finishLocked(sessionId: string, llm: LlmProvider): Promise<DefenseRoomVerdict> {
  const max = CALL_LIMITS.maxFinishAttempts;
  const claimed = await prisma.callSession.updateMany({
    where: { id: sessionId, status: 'active', finishAttempts: { lt: max } },
    data: { finishAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    const cur = await prisma.callSession.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true } });
    if (cur.status !== 'active') return storedVerdict(sessionId);
    throw errors.conflict('Попытки оценки исчерпаны');
  }

  const full = await prisma.callSession.findUniqueOrThrow({ where: { id: sessionId }, select: { transcriptJson: true, projectSubmissionId: true } });
  const plan = await loadPlan(sessionId);
  const submission = full.projectSubmissionId
    ? await prisma.projectSubmission.findUnique({ where: { id: full.projectSubmissionId }, select: { resultJson: true } })
    : null;
  const employerItems = plan.items.filter((i) => i.source === 'employer');
  const askedEmployer = employerItems.filter((i) => plan.items.indexOf(i) <= plan.cursor);
  const requeue = employerItems.filter((i) => !i.answered).map((i) => (i.source === 'employer' ? i.employerQuestionId : ''));

  let verdict: DefenseRoomVerdict;
  try {
    verdict = await evaluateDefenseRoom(
      {
        projectTitle: plan.source.projectTitle,
        transcript: asTranscript(full.transcriptJson),
        plan: plan.items,
        projectScore: plan.source.mode === 'project' ? (summarizeProjectResult(submission?.resultJson)?.score ?? null) : null,
        employerAsked: askedEmployer.length,
        employerAnswered: askedEmployer.filter((i) => i.answered).length,
      },
      llm,
    );
  } catch (err) {
    const now = new Date();
    const closed = await prisma.$transaction(async (tx) => {
      const res = await tx.callSession.updateMany({
        where: { id: sessionId, status: 'active', finishAttempts: { gte: max } },
        data: { status: 'cancelled', finishedAt: now },
      });
      if (res.count !== 1) return false;
      await closeRoom(tx, sessionId, requeue, now);
      return true;
    });
    if (closed) {
      publish(sessionId, { type: 'status', status: 'cancelled' });
      throw new AppError('llm_unavailable', `Оценщик недоступен ${max} раза подряд - защита закрыта без оценки, ответы сохранены.`, 503);
    }
    throw err;
  }
  // Режим «только вопросы работодателя»: сравнивать с проектом нечего — флаг no_project_result не нужен.
  if (plan.source.mode === 'questions') verdict.flags = verdict.flags.filter((f) => f !== 'no_project_result');

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.callSession.updateMany({
      where: { id: sessionId, status: 'active' },
      data: { status: 'finished', finishedAt: now, verdictJson: verdict as unknown as Prisma.InputJsonValue },
    });
    if (res.count !== 1) return false;
    await closeRoom(tx, sessionId, requeue, now);
    return true;
  });
  if (!updated) return storedVerdict(sessionId);
  publish(sessionId, { type: 'status', status: 'finished' });
  publish(sessionId, { type: 'verdict', verdict });
  publish(sessionId, { type: 'snapshot', call: await buildSnapshot(sessionId) });
  return verdict;
}

/** Участники выходят; заданные, но не отвеченные вопросы работодателя возвращаются в очередь — до следующего входа кандидата. */
async function closeRoom(tx: Prisma.TransactionClient, sessionId: string, requeue: string[], now: Date): Promise<void> {
  await tx.callParticipant.updateMany({ where: { callSessionId: sessionId, leftAt: null }, data: { leftAt: now } });
  if (requeue.length) await tx.employerQuestion.updateMany({ where: { id: { in: requeue }, status: 'asked' }, data: { status: 'queued' } });
}

// ---------------------------------------------------------------------------
// Снимок для клиентов (SSE `status`, ответы join/start)
// ---------------------------------------------------------------------------
export async function buildSnapshot(sessionId: string): Promise<CallSnapshot> {
  const s = await prisma.callSession.findUnique({
    where: { id: sessionId },
    select: { id: true, kind: true, status: true, transcriptJson: true, verdictJson: true, participants: { where: { leftAt: null }, select: { userId: true, aiMuted: true } } },
  });
  if (!s) throw errors.notFound('Сессия не найдена');
  const plan = await prisma.defenseRoomPlan.findUnique({ where: { callSessionId: sessionId }, select: { itemsJson: true, cursor: true, sourceJson: true } });
  const items = (plan?.itemsJson as unknown as PlanItem[] | undefined) ?? [];
  const users = await prisma.user.findMany({
    where: { id: { in: s.participants.map((p) => p.userId) } },
    select: { id: true, employerProfile: { select: { company: { select: { id: true, name: true } } } } },
  });
  const company = new Map(users.map((u) => [u.id, u.employerProfile?.company ?? null]));
  return {
    sessionId: s.id,
    kind: s.kind,
    status: s.status,
    mode: ((plan?.sourceJson as unknown as SourceInfo | undefined)?.mode ?? 'project') as DefenseMode,
    transcript: asTranscript(s.transcriptJson),
    participants: s.participants.map((p) => ({ userId: p.userId, companyId: company.get(p.userId)?.id ?? '', companyName: company.get(p.userId)?.name ?? 'компания', aiMuted: p.aiMuted })),
    aiMuted: s.participants.some((p) => p.aiMuted),
    progress: { asked: Math.min(items.length, (plan?.cursor ?? 0) + 1), total: items.length },
    verdict: asVerdict(s.verdictJson),
  };
}
