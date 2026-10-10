// Сервис созвона (lane call, ADR 0003): старт, реплики, завершение с вердиктом, чтение по роли,
// аудио кандидата. Транскрипт — CallSession.transcriptJson; запись в него — под блокировкой строки.
import type { Prisma } from '@prisma/client';

import { prisma } from '../db';
import { getEnv } from '../env';
import { AppError, errors } from '../errors';
import type { LlmProvider } from '../llm/types';
import { type CallPrincipal, publicVerdict, resolveCallAccess, type ResolvedAccess } from './access';
import { assertSegment, concatRecording, listSegments, recognizeSegment, saveSegment, callAudioDir } from './audio';
import { publishCall } from './bus';
import { CALL_RECORDING_CONSENT_VERSION, hasCallConsent } from './consent';
import { CALL_DISCLAIMER, callDriver, questionTurns, type DriverSession } from './drivers';
import { CALL_LIMITS, CLOSING_LINE } from './plan';
import { REVIEW_QUESTIONS, reviewState } from './test-review';
import { MAX_UTTERANCE_CHARS, type StartCallBody } from './schemas';
import type { CallKind, CallStatus, CallVerdict, CallView, QuestionLevel, TranscriptEntry, TurnResult } from './types';

/** Публичный STUN для WebRTC (defense-room; ADR 0003: P2P, сигналинг через наш API). */
export const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] as const;

type Row = {
  id: string;
  candidateId: string;
  kind: CallKind;
  projectSubmissionId: string | null;
  status: CallStatus;
  startedAt: Date;
  finishedAt: Date | null;
  transcriptJson: Prisma.JsonValue;
  audioPath: string | null;
  verdictJson: Prisma.JsonValue | null;
  policyVersion: string;
};

const rowSelect = {
  id: true,
  candidateId: true,
  kind: true,
  projectSubmissionId: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  transcriptJson: true,
  audioPath: true,
  verdictJson: true,
  policyVersion: true,
} as const;

export function transcriptOf(row: Pick<Row, 'transcriptJson'>): TranscriptEntry[] {
  return Array.isArray(row.transcriptJson) ? (row.transcriptJson as unknown as TranscriptEntry[]) : [];
}

function driverSession(row: Row, transcript = transcriptOf(row)): DriverSession {
  return { id: row.id, candidateId: row.candidateId, kind: row.kind, projectSubmissionId: row.projectSubmissionId, transcript };
}

/** Ждёт ли созвон ответа кандидата: последняя реплика — вопрос ИИ (с meta). */
export function awaitingAnswer(transcript: readonly TranscriptEntry[]): boolean {
  const last = transcript[transcript.length - 1];
  return Boolean(last && last.role === 'ai' && last.meta);
}

/** Промежуточная оценка (созвон ещё идёт, ждут дополнительные вопросы по неопределённым темам). */
function interimOf(row: Pick<Row, 'verdictJson'>): CallVerdict | null {
  const v = row.verdictJson as unknown as CallVerdict | null;
  return v && v.interim ? v : null;
}

/** Следующая неопределённая тема из промежуточной оценки, по которой дополнительный вопрос ещё не задавали. */
function nextProbe(interim: CallVerdict | null, transcript: readonly TranscriptEntry[]): { topic: string; level: QuestionLevel } | null {
  if (!interim?.pendingProbes?.length) return null;
  const asked = new Set(questionTurns(transcript).filter((t) => t.probe).map((t) => t.topic));
  const topic = interim.pendingProbes.find((t) => !asked.has(t));
  if (!topic) return null;
  const item = interim.depthMap.find((d) => d.topic === topic);
  return { topic, level: (item?.maxLevel ?? 2) as QuestionLevel };
}

function answeredCount(transcript: readonly TranscriptEntry[]): number {
  return questionTurns(transcript).filter((t) => t.answer !== null).length;
}

function entry(transcript: readonly TranscriptEntry[], startedAt: Date, e: Omit<TranscriptEntry, 'index' | 'at' | 'tMs'>, now = new Date()): TranscriptEntry {
  return { index: transcript.length, at: now.toISOString(), tMs: Math.max(0, now.getTime() - startedAt.getTime()), ...e };
}

async function lockCall(tx: Prisma.TransactionClient, id: string): Promise<Row> {
  await tx.$queryRaw`SELECT id FROM "CallSession" WHERE id = ${id} FOR UPDATE`;
  const row = await tx.callSession.findUnique({ where: { id }, select: rowSelect });
  if (!row) throw errors.notFound('Созвон не найден');
  return row as Row;
}

async function loadOwn(candidateId: string, id: string): Promise<Row> {
  const row = await prisma.callSession.findUnique({ where: { id }, select: rowSelect });
  if (!row || row.candidateId !== candidateId) throw errors.notFound('Созвон не найден');
  return row as Row;
}

async function aiMuted(callSessionId: string): Promise<boolean> {
  return (await prisma.callParticipant.count({ where: { callSessionId, aiMuted: true, leftAt: null } })) > 0;
}

// ---------------------------------------------------------------------------
// Вид созвона по роли
// ---------------------------------------------------------------------------
export async function buildView(row: Row, acc: ResolvedAccess): Promise<CallView> {
  const transcript = transcriptOf(row);
  const driver = callDriver(row.kind);
  const answered = answeredCount(transcript);
  // Промежуточная оценка (созвон active, ждут дополнительные вопросы) наружу не отдаётся.
  const stored = (row.verdictJson as unknown as CallVerdict | null) ?? null;
  const verdict = stored?.interim ? null : stored;
  const interim = stored?.interim ? stored : null;
  const participants = await prisma.callParticipant.findMany({
    where: { callSessionId: row.id },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true, role: true, joinedAt: true, leftAt: true, aiMuted: true },
  });
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    projectSubmissionId: row.projectSubmissionId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    access: acc.access,
    transcript: acc.access === 'full' ? transcript : null,
    verdict: verdict ? (acc.access === 'full' ? verdict : publicVerdict(verdict)) : null,
    hasRecording: acc.recording && (await listSegments(row.id)).length > 0,
    progress: {
      answered,
      minQuestions: driver.limits.minQuestions,
      maxQuestions: interim ? (driver.limits.hardMaxQuestions ?? driver.limits.maxQuestions) : driver.limits.maxQuestions,
      canFinish: row.status === 'active' && answered >= 1,
      awaitingAnswer: row.status === 'active' && awaitingAnswer(transcript),
    },
    participants: participants.map((p) => ({ userId: p.userId, role: p.role, joinedAt: p.joinedAt.toISOString(), leftAt: p.leftAt?.toISOString() ?? null, aiMuted: p.aiMuted })),
    policyVersion: row.policyVersion,
    disclaimer: driver.disclaimer ?? CALL_DISCLAIMER,
  };
}

const CANDIDATE_ACCESS: ResolvedAccess = { role: 'candidate', access: 'full', recording: true };

// ---------------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------------
export interface StartResult {
  sessionId: string;
  resumed: boolean;
  webrtc: { iceServers: typeof ICE_SERVERS };
  call: CallView;
}

export async function startCall(candidateId: string, body: StartCallBody, llm: LlmProvider): Promise<StartResult> {
  const driver = callDriver(body.kind);
  const projectSubmissionId = body.projectSubmissionId ?? null;
  if (body.kind === 'qualifying' && projectSubmissionId) throw errors.badRequest('projectSubmissionId — только для защиты проекта');
  if (!(await hasCallConsent(candidateId))) {
    throw new AppError('call_consent_required', 'Перед первым созвоном нужно согласие на запись', 409, { version: CALL_RECORDING_CONSENT_VERSION });
  }
  await driver.assertCanStart?.(candidateId, projectSubmissionId);

  const active = await prisma.callSession.findFirst({
    where: { candidateId, kind: body.kind, status: 'active', projectSubmissionId },
    select: rowSelect,
  });
  if (active) return { sessionId: active.id, resumed: true, webrtc: { iceServers: ICE_SERVERS }, call: await buildView(active as Row, CANDIDATE_ACCESS) };

  const dailyLimit = getEnv().CALL_DAILY_LIMIT;
  if (dailyLimit > 0) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await prisma.callSession.count({ where: { candidateId, kind: body.kind, startedAt: { gte: dayAgo } } });
    if (recent >= dailyLimit) {
      throw new AppError('call_limit', `Не больше ${dailyLimit} созвонов в сутки - попробуй завтра`, 429);
    }
  }

  const created = await prisma.callSession.create({
    data: { candidateId, kind: body.kind, projectSubmissionId, policyVersion: CALL_RECORDING_CONSENT_VERSION, transcriptJson: [] },
    select: rowSelect,
  });
  // Первый вопрос — вне транзакции (LLM медленная); пишется под блокировкой.
  const q = await driver.nextQuestion(driverSession(created as Row, []), llm);
  const row = await prisma.$transaction(async (tx) => {
    const cur = await lockCall(tx, created.id);
    const t = transcriptOf(cur);
    if (t.length > 0) return cur;
    const first = entry(t, cur.startedAt, { role: 'ai', text: q.text, meta: q.meta });
    return (await tx.callSession.update({ where: { id: cur.id }, data: { transcriptJson: [first] as unknown as Prisma.InputJsonValue }, select: rowSelect })) as Row;
  });
  const first = transcriptOf(row)[0];
  if (first) publishCall(row.id, { type: 'utterance', entry: first });
  return { sessionId: row.id, resumed: false, webrtc: { iceServers: ICE_SERVERS }, call: await buildView(row, CANDIDATE_ACCESS) };
}

// ---------------------------------------------------------------------------
// Реплика кандидата → следующий вопрос
// ---------------------------------------------------------------------------
export async function submitTurn(
  candidateId: string,
  sessionId: string,
  input: { text?: string; audioRef?: string },
  llm: LlmProvider,
): Promise<TurnResult> {
  const row = await loadOwn(candidateId, sessionId);
  if (row.status !== 'active') throw errors.conflict('Созвон уже завершён');
  const text = (input.text ?? '').replace(/\r\n/g, '\n').trim();
  // Сегмент должен существовать. Текст уже распознан в /audio или браузером — второй раз STT не зовём.
  if (input.audioRef) await assertSegment(sessionId, input.audioRef);
  if (!text) throw new AppError('empty_answer', 'Не удалось разобрать ответ - скажи ещё раз или напиши текстом', 400);
  if (text.length > MAX_UTTERANCE_CHARS) throw new AppError('answer_too_long', `Ответ длиннее ${MAX_UTTERANCE_CHARS} символов`, 400);

  const driver = callDriver(row.kind);
  const saved = await prisma.$transaction(async (tx) => {
    const cur = await lockCall(tx, sessionId);
    if (cur.status !== 'active') throw errors.conflict('Созвон уже завершён');
    const t = transcriptOf(cur);
    // Ждём ответа на вопрос ИИ; если ИИ не успел ответить на прошлую реплику (сбой) — реплика дописывается,
    // и вопрос генерируется заново. После закрывающей реплики (без meta) отвечать некому.
    if (!awaitingAnswer(t) && t[t.length - 1]?.role !== 'candidate') throw errors.conflict('Ответ на этот вопрос уже принят');
    const e = entry(t, cur.startedAt, { role: 'candidate', text, ...(input.audioRef ? { audioRef: input.audioRef } : {}) });
    const next = [...t, e];
    const upd = (await tx.callSession.update({
      where: { id: sessionId },
      data: { transcriptJson: next as unknown as Prisma.InputJsonValue, ...(input.audioRef ? { audioPath: callAudioDir(sessionId).rel } : {}) },
      select: rowSelect,
    })) as Row;
    return { row: upd, entry: e };
  });
  publishCall(sessionId, { type: 'utterance', entry: saved.entry });

  const transcript = transcriptOf(saved.row);
  const answered = answeredCount(transcript);
  if (await aiMuted(sessionId)) return { candidate: saved.entry, ai: null, text: null, done: false };

  let aiText: string;
  let meta: TranscriptEntry['meta'];
  let done = false;
  const interim = interimOf(saved.row);
  const probe = interim ? nextProbe(interim, transcript) : null;
  const hardMax = driver.limits.hardMaxQuestions ?? driver.limits.maxQuestions;
  // Этап «разбор задания теста» (11.10): после обычных вопросов — до 2 реплик ИИ; сбой этапа созвон не ломает.
  const review = async (allowStart: boolean) => {
    if (interim || !driver.nextReviewQuestion) return null;
    publishCall(sessionId, { type: 'ai_state', state: 'thinking' });
    try {
      return await driver.nextReviewQuestion(driverSession(saved.row, transcript), llm, { allowStart });
    } catch (err) {
      console.warn('[call] test-review failed:', err instanceof Error ? err.message : err);
      return null;
    } finally {
      publishCall(sessionId, { type: 'ai_state', state: 'idle' });
    }
  };
  const closeOrReview = async () => {
    const rq = await review(true);
    if (rq) {
      aiText = rq.text;
      meta = rq.meta;
    } else {
      aiText = driver.closingLine ?? CLOSING_LINE;
      done = true;
    }
  };
  const followUp = interim ? null : await review(false);
  if (followUp) {
    aiText = followUp.text;
    meta = followUp.meta;
  } else if (!interim && reviewState(transcript).asked >= REVIEW_QUESTIONS) {
    aiText = driver.closingLine ?? CLOSING_LINE;
    done = true;
  } else if (interim && (!probe || answered >= hardMax)) {
    // Дополнительные вопросы по неопределённым темам заданы — дальше finish досчитает только их.
    aiText = driver.closingLine ?? CLOSING_LINE;
    done = true;
  } else if (!interim && answered >= driver.limits.maxQuestions) {
    await closeOrReview();
  } else {
    publishCall(sessionId, { type: 'ai_state', state: 'thinking' });
    try {
      const q = await driver.nextQuestion(driverSession(saved.row, transcript), llm, probe ? { force: probe } : {});
      if (!probe && answered >= driver.limits.minQuestions && q.done) {
        await closeOrReview();
      } else {
        aiText = q.text;
        meta = q.meta;
      }
    } finally {
      publishCall(sessionId, { type: 'ai_state', state: 'idle' });
    }
  }

  const aiEntry = await prisma.$transaction(async (tx) => {
    const cur = await lockCall(tx, sessionId);
    const t = transcriptOf(cur);
    if (cur.status !== 'active') throw errors.conflict('Созвон уже завершён');
    // Пока ИИ думал, мог вступить работодатель — вопрос всё равно добавляется после его реплики.
    if (awaitingAnswer(t)) throw errors.conflict('Следующий вопрос уже задан');
    const e = entry(t, cur.startedAt, { role: 'ai', text: aiText, ...(meta ? { meta } : {}) });
    await tx.callSession.update({ where: { id: sessionId }, data: { transcriptJson: [...t, e] as unknown as Prisma.InputJsonValue } });
    return e;
  });
  publishCall(sessionId, { type: 'utterance', entry: aiEntry });
  return { candidate: saved.entry, ai: aiEntry, text: aiEntry.text, done };
}

// ---------------------------------------------------------------------------
// Завершение: слепой оценщик → вердикт → уровни утверждений
// ---------------------------------------------------------------------------
export async function finishCall(candidateId: string, sessionId: string, llm: LlmProvider): Promise<CallView> {
  const row = await loadOwn(candidateId, sessionId);
  if (row.status === 'finished') return buildView(row, CANDIDATE_ACCESS);
  if (row.status !== 'active') throw errors.conflict('Созвон отменён');
  const driver = callDriver(row.kind);
  const transcript = transcriptOf(row);

  if (answeredCount(transcript) === 0) {
    // Ни одного ответа — оценивать нечего: созвон отменён, без вердикта.
    const upd = await prisma.callSession.updateMany({ where: { id: sessionId, status: 'active' }, data: { status: 'cancelled', finishedAt: new Date() } });
    if (upd.count === 1) publishCall(sessionId, { type: 'status', status: 'cancelled' });
    return buildView(await loadOwn(candidateId, sessionId), CANDIDATE_ACCESS);
  }

  // Каждый запуск оценщика — 3–6 вызовов LLM: запуски считаются атомарно, повторы после 503 ограничены.
  const max = CALL_LIMITS.maxFinishAttempts;
  const claimed = await prisma.callSession.updateMany({
    where: { id: sessionId, status: 'active', finishAttempts: { lt: max } },
    data: { finishAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    const cur = await loadOwn(candidateId, sessionId);
    if (cur.status === 'finished') return buildView(cur, CANDIDATE_ACCESS);
    if (cur.status !== 'active') throw errors.conflict('Созвон закрыт без оценки');
    throw errors.conflict('Оценка уже идёт - подожди результата');
  }

  const interim = interimOf(row);
  let partial;
  try {
    partial = await driver.evaluate(driverSession(row, transcript), llm, { interim });
  } catch (err) {
    console.warn('[call] evaluator failed:', err instanceof Error ? err.message : err);
    const closed = await prisma.callSession.updateMany({
      where: { id: sessionId, status: 'active', finishAttempts: { gte: max } },
      data: { status: 'cancelled', finishedAt: new Date() },
    });
    if (closed.count === 1) {
      publishCall(sessionId, { type: 'status', status: 'cancelled' });
      throw new AppError('llm_unavailable', `Оценщик недоступен ${max} раза подряд - созвон закрыт без оценки, ответы сохранены. Начни новый созвон позже.`, 503);
    }
    publishCall(sessionId, { type: 'error', code: 'llm_unavailable', message: 'Оценщик сейчас недоступен' });
    throw new AppError('llm_unavailable', 'Оценщик сейчас недоступен. Ответы сохранены - нажми «Завершить» ещё раз чуть позже.', 503);
  }

  // Прогоны оценщика разошлись в решении по теме → «нужен ещё вопрос»: созвон продолжается дополнительными
  // вопросами (до hardMaxQuestions), промежуточная оценка хранится в verdictJson и наружу не отдаётся.
  const hardMax = driver.limits.hardMaxQuestions;
  if (!interim && hardMax) {
    const room = hardMax - answeredCount(transcript);
    const probes = partial.depthMap.filter((d) => d.status === 'inconclusive').map((d) => d.topic).slice(0, Math.max(0, room));
    if (probes.length) {
      const pending: CallVerdict = { ...partial, upgradedCatalogIds: [], evaluatedAt: new Date().toISOString(), interim: true, pendingProbes: probes };
      const first = nextProbe(pending, transcript)!;
      const q = await driver.nextQuestion(driverSession(row, transcript), llm, { force: first });
      const cont = await prisma.$transaction(async (tx) => {
        const cur = await lockCall(tx, sessionId);
        if (cur.status !== 'active') return null;
        // Незаданный ответ на последний вопрос (кандидат нажал «Завершить» раньше) остаётся без ответа:
        // дополнительный вопрос идёт следом, оценщик видит только пары с ответом.
        const t = transcriptOf(cur);
        const e = entry(t, cur.startedAt, { role: 'ai', text: q.text, meta: q.meta });
        const upd = (await tx.callSession.update({
          where: { id: sessionId },
          // Промежуточная оценка — не попытка завершения: попытка возвращается, иначе созвон с дополнительным
          // вопросом мог бы упереться в maxFinishAttempts при первом же сбое оценщика на итоговом завершении.
          data: {
            transcriptJson: [...t, e] as unknown as Prisma.InputJsonValue,
            verdictJson: pending as unknown as Prisma.InputJsonValue,
            finishAttempts: { decrement: 1 },
          },
          select: rowSelect,
        })) as Row;
        return { row: upd, entry: e };
      });
      if (cont) {
        publishCall(sessionId, { type: 'utterance', entry: cont.entry });
        return buildView(cont.row, CANDIDATE_ACCESS);
      }
      return buildView(await loadOwn(candidateId, sessionId), CANDIDATE_ACCESS);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const cur = await lockCall(tx, sessionId);
    if (cur.status !== 'active') return { row: cur, fresh: false };
    const upgradedCatalogIds = (await driver.applyVerdict?.(tx, cur.candidateId, partial)) ?? [];
    const now = new Date();
    const verdict: CallVerdict = { ...partial, upgradedCatalogIds, evaluatedAt: now.toISOString() };
    delete verdict.interim;
    delete verdict.pendingProbes;
    const upd = (await tx.callSession.update({
      where: { id: sessionId },
      data: { status: 'finished', finishedAt: now, verdictJson: verdict as unknown as Prisma.InputJsonValue },
      select: rowSelect,
    })) as Row;
    return { row: upd, fresh: true };
  });
  if (result.fresh) {
    publishCall(sessionId, { type: 'status', status: 'finished' });
    const v = result.row.verdictJson as unknown as CallVerdict;
    publishCall(sessionId, { type: 'verdict', verdict: v });
  }
  return buildView(result.row, CANDIDATE_ACCESS);
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------
export async function getCallForViewer(who: CallPrincipal, sessionId: string): Promise<{ view: CallView; access: ResolvedAccess }> {
  const row = await prisma.callSession.findUnique({ where: { id: sessionId }, select: rowSelect });
  if (!row) throw errors.notFound('Созвон не найден');
  const access = await resolveCallAccess(who, row);
  return { view: await buildView(row as Row, access), access };
}

/** Созвоны кандидата, свежие первыми (профиль: карта глубины последнего завершённого). */
export async function listCalls(candidateId: string, kind?: CallKind): Promise<CallView[]> {
  const rows = await prisma.callSession.findMany({
    where: { candidateId, ...(kind ? { kind } : {}) },
    orderBy: { startedAt: 'desc' },
    take: 10,
    select: rowSelect,
  });
  return Promise.all(rows.map((r) => buildView(r as Row, CANDIDATE_ACCESS)));
}

/** Последний вердикт квалифицирующего созвона — для профиля и (позже) карточки работодателя. */
export async function latestQualifyingVerdict(candidateId: string): Promise<CallVerdict | null> {
  const row = await prisma.callSession.findFirst({
    where: { candidateId, kind: 'qualifying', status: 'finished' },
    orderBy: { finishedAt: 'desc' },
    select: { verdictJson: true },
  });
  return (row?.verdictJson as unknown as CallVerdict | null) ?? null;
}

// ---------------------------------------------------------------------------
// Аудио
// ---------------------------------------------------------------------------
export async function addAudio(candidateId: string, sessionId: string, pcm: Uint8Array): Promise<{ audioRef: string; text: string | null }> {
  const row = await loadOwn(candidateId, sessionId);
  if (row.status !== 'active') throw errors.conflict('Созвон уже завершён');
  const audioRef = await saveSegment(sessionId, pcm);
  if (!row.audioPath) await prisma.callSession.update({ where: { id: sessionId }, data: { audioPath: callAudioDir(sessionId).rel } });
  let text: string | null = null;
  try {
    text = await recognizeSegment(pcm);
  } catch (err) {
    // Аудио сохранено; текст пришлёт клиент или кандидат наберёт.
    console.warn('[call] stt failed:', err instanceof Error ? err.message : err);
  }
  return { audioRef, text };
}

export async function getRecording(who: CallPrincipal, sessionId: string, segment?: string): Promise<Buffer> {
  const row = await prisma.callSession.findUnique({ where: { id: sessionId }, select: { id: true, candidateId: true } });
  if (!row) throw errors.notFound('Созвон не найден');
  const access = await resolveCallAccess(who, row);
  if (!access.recording) throw errors.forbidden('Запись созвона откроется после того, как кандидат примет приглашение');
  const wav = await concatRecording(sessionId, segment);
  if (!wav) throw errors.notFound('Аудио в этом созвоне не записывалось');
  return wav;
}
