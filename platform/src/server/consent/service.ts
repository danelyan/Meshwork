// Согласия (ADR 0005, R-C-13, R-C-14, R-C-16): выдача, отзыв, проверка «активно ли», список для кабинета.
// Строка Consent — один акт согласия; отзыв ставит revokedAt, история не удаляется.
// Активное согласие — последнее по kind без revokedAt, на текущую версию текста (кроме раскрытия по приглашению:
// у него версия фиксирует, что видел кандидат в момент принятия, и переподтверждать её задним числом нечего).
import type { Prisma } from '@prisma/client';

import { prisma } from '../db';
import { AppError, errors } from '../errors';

import { deleteCandidateRecordings } from './recordings';
import { getEnv } from '../env';

import { CONSENT_TEXTS, type ConsentKindName, type ConsentText, callRecordingParagraphs, consentVersion } from './texts';

/** Текст для показа: у Г2 срок хранения аудио — фактический, из env CALL_RECORDING_RETENTION_DAYS. */
export function consentTextFor(kind: ConsentKindName): ConsentText {
  const t = CONSENT_TEXTS[kind];
  return kind === 'call_recording' ? { ...t, paragraphs: callRecordingParagraphs(getEnv().CALL_RECORDING_RETENTION_DAYS) } : t;
}

export interface ConsentRow {
  id: string;
  kind: ConsentKindName;
  version: string;
  acceptedAt: Date;
  revokedAt: Date | null;
  context: unknown;
}

export type ConsentState = 'none' | 'active' | 'outdated' | 'revoked';

const invitationOf = (context: unknown): string | null => {
  const v = (context as { invitationId?: unknown } | null)?.invitationId;
  return typeof v === 'string' ? v : null;
};

/** Чистая логика: активная строка — последняя по acceptedAt без revokedAt (и с нужным приглашением). */
export function pickActive<R extends Pick<ConsentRow, 'acceptedAt' | 'revokedAt' | 'context'>>(rows: readonly R[], invitationId?: string): R | null {
  let best: R | null = null;
  for (const r of rows) {
    if (r.revokedAt) continue;
    if (invitationId !== undefined && invitationOf(r.context) !== invitationId) continue;
    if (!best || r.acceptedAt > best.acceptedAt) best = r;
  }
  return best;
}

/**
 * Состояние вида согласия по его строкам: active — есть действующее на текущую версию; outdated — действующее на
 * прежнюю версию текста (спросить заново); revoked — последнее действие кандидата — отзыв; none — не давал.
 */
export function consentState(rows: readonly Pick<ConsentRow, 'kind' | 'version' | 'acceptedAt' | 'revokedAt' | 'context'>[], kind: ConsentKindName, invitationId?: string): ConsentState {
  const own = rows.filter((r) => r.kind === kind && (invitationId === undefined || invitationOf(r.context) === invitationId));
  if (own.length === 0) return 'none';
  const active = pickActive(own);
  if (active) return kind === 'identity_disclosure' || active.version === consentVersion(kind) ? 'active' : 'outdated';
  return 'revoked';
}

async function rowsOf(userId: string, kinds?: ConsentKindName[]): Promise<ConsentRow[]> {
  return (await prisma.consent.findMany({
    where: { userId, ...(kinds ? { kind: { in: kinds } } : {}) },
    orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, kind: true, version: true, acceptedAt: true, revokedAt: true, context: true },
  })) as ConsentRow[];
}

export async function stateOf(userId: string, kind: ConsentKindName, invitationId?: string): Promise<ConsentState> {
  return consentState(await rowsOf(userId, [kind]), kind, invitationId);
}

export async function hasActiveConsent(userId: string, kind: ConsentKindName, invitationId?: string): Promise<boolean> {
  return (await stateOf(userId, kind, invitationId)) === 'active';
}

/** Аккаунт кандидата по candidateId (согласия хранятся на аккаунте). */
export async function userIdForCandidate(candidateId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { candidateId }, select: { id: true } });
  return u?.id ?? null;
}

/** Где в кабинете дать или отозвать согласие. */
export const CONSENTS_HREF = { candidate: '/settings#consents', employer: '/employer/company#consents' } as const;

/** Ошибка «нет согласия»: 409 consent_required с видом, версией и ссылкой на кабинет. */
export function consentRequired(kind: ConsentKindName, message: string): AppError {
  const audience = CONSENT_TEXTS[kind].audience === 'employer' ? 'employer' : 'candidate';
  return new AppError('consent_required', message, 409, { kind, version: consentVersion(kind), href: CONSENTS_HREF[audience] });
}

/** Действует ли Г3 у кандидата (для фоновых шагов, где нельзя ответить 409: LLM-рубрика проекта). */
export async function hasAiAssessmentConsent(candidateId: string): Promise<boolean> {
  const userId = await userIdForCandidate(candidateId);
  return Boolean(userId && (await hasActiveConsent(userId, 'ai_assessment')));
}

/**
 * Г3: без согласия на ИИ-оценку тест, созвон и защита недоступны. Проверяется и на старте, и на каждом ответе,
 * ходе и завершении: отзыв посреди сессии останавливает её, оценщик не запускается.
 */
export async function assertAiAssessmentConsent(candidateId: string): Promise<void> {
  if (await hasAiAssessmentConsent(candidateId)) return;
  throw consentRequired(
    'ai_assessment',
    'Тест, созвон и защита оцениваются с помощью ИИ - для них нужно согласие на оценку ИИ. Дать его можно в настройках, раздел «Мои согласия».',
  );
}

/** Работодатель: поиск кандидатов и приглашения — только после оферты и обязательства по данным. */
export async function employerConsentsMissing(userId: string): Promise<ConsentKindName[]> {
  const rows = await rowsOf(userId, ['employer_offer', 'employer_data_obligation']);
  return (['employer_offer', 'employer_data_obligation'] as const).filter((k) => consentState(rows, k) !== 'active');
}

export async function assertEmployerConsents(userId: string): Promise<void> {
  const missing = await employerConsentsMissing(userId);
  if (missing.length === 0) return;
  throw consentRequired(
    missing[0]!,
    'Поиск кандидатов и приглашения доступны после принятия условий для работодателей и обязательства использовать данные кандидатов только для найма. Принять их можно в профиле компании, раздел «Мои согласия».',
  );
}

export interface GrantInput {
  kind: ConsentKindName;
  version: string;
  context?: { invitationId?: string } | null;
}

async function candidateOfUser(userId: string): Promise<string | null> {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { candidateId: true } }))?.candidateId ?? null;
}

/** Побочные эффекты согласия на модель: показ профиля, Candidate.consentAt. */
async function applyGranted(userId: string, kind: ConsentKindName, at: Date): Promise<void> {
  const candidateId = await candidateOfUser(userId);
  if (!candidateId) return;
  if (kind === 'employer_visibility') await prisma.candidate.update({ where: { id: candidateId }, data: { hiddenFromEmployers: false } });
  if (kind === 'pd_processing') await prisma.candidate.update({ where: { id: candidateId }, data: { consentAt: at } });
}

/**
 * Дать согласие: только текущая версия текста (иначе 409). Повтор действующего — без дубля.
 * identity_disclosure — только с `context.invitationId` своего принятого приглашения.
 */
export async function grantConsent(userId: string, input: GrantInput): Promise<ConsentRow> {
  const { kind, version } = input;
  if (version !== consentVersion(kind)) throw errors.conflict('Текст согласия обновился - обновите страницу');
  let context: Prisma.InputJsonValue | undefined;
  let invitationId: string | undefined;
  if (kind === 'identity_disclosure') {
    invitationId = input.context?.invitationId;
    if (!invitationId) throw errors.badRequest('Раскрытие данных даётся по конкретному приглашению: нужен invitationId');
    const candidateId = await candidateOfUser(userId);
    const inv = candidateId ? await prisma.invitation.findFirst({ where: { id: invitationId, candidateId }, select: { status: true } }) : null;
    if (!inv) throw errors.notFound('Приглашение не найдено');
    if (inv.status !== 'accepted' && inv.status !== 'hired') throw errors.conflict('Раскрыть данные можно, только приняв приглашение');
    context = { invitationId };
  }
  const rows = await rowsOf(userId, [kind]);
  const active = pickActive(rows, invitationId);
  if (active && (kind === 'identity_disclosure' || active.version === version)) return active;
  const row = (await prisma.consent.create({
    data: { userId, kind, version, ...(context ? { context } : {}) },
    select: { id: true, kind: true, version: true, acceptedAt: true, revokedAt: true, context: true },
  })) as ConsentRow;
  await applyGranted(userId, kind, row.acceptedAt);
  return row;
}

/** Дать недостающие согласия текущих версий (демо-аккаунты, сид): действующие не трогает. */
export async function ensureConsents(userId: string, kinds: readonly ConsentKindName[]): Promise<void> {
  const rows = await rowsOf(userId, [...kinds]);
  for (const kind of kinds) {
    if (consentState(rows, kind) !== 'active') await grantConsent(userId, { kind, version: consentVersion(kind) });
  }
}

/**
 * Отозвать согласие. Г1 (pd_processing) отзывается только удалением аккаунта — 409 с подсказкой.
 * call_recording: сохранённые аудио кандидата удаляются сразу. employer_visibility: профиль скрывается.
 * identity_disclosure: по конкретному приглашению — работодатель снова видит псевдоним.
 */
export async function revokeConsent(userId: string, kind: ConsentKindName, opts: { invitationId?: string } = {}): Promise<{ kind: ConsentKindName; revokedAt: string; deletedRecordings?: number }> {
  if (CONSENT_TEXTS[kind].revoke === 'erase') {
    throw new AppError('consent_revoke_is_erase', 'Отзыв согласия на обработку данных - это удаление аккаунта: кнопка «Отозвать согласие и удалить данные» в настройках.', 409);
  }
  if (kind === 'identity_disclosure' && !opts.invitationId) throw errors.badRequest('Укажите приглашение: ?invitationId=');
  const rows = await rowsOf(userId, [kind]);
  const targets = rows.filter((r) => !r.revokedAt && (kind !== 'identity_disclosure' || invitationOf(r.context) === opts.invitationId));
  if (targets.length === 0) throw errors.notFound('Действующего согласия нет');
  const now = new Date();
  await prisma.consent.updateMany({ where: { id: { in: targets.map((t) => t.id) } }, data: { revokedAt: now } });
  const candidateId = await candidateOfUser(userId);
  let deletedRecordings: number | undefined;
  if (candidateId && kind === 'employer_visibility') await prisma.candidate.update({ where: { id: candidateId }, data: { hiddenFromEmployers: true } });
  // revokedAt уже стоит: новые сегменты не пишутся (addAudio перепроверяет режим после записи). Сбой удаления файлов
  // не отменяет отзыв и не превращается в 500 — removeAudio логирует и всё равно обнуляет audioPath.
  if (candidateId && kind === 'call_recording') {
    try {
      deletedRecordings = await deleteCandidateRecordings(candidateId);
    } catch (err) {
      console.error('[consent] call recordings cleanup failed:', err instanceof Error ? err.message : err);
      await prisma.callSession.updateMany({ where: { candidateId }, data: { audioPath: null } }).catch(() => undefined);
      deletedRecordings = 0;
    }
  }
  if (kind === 'identity_disclosure' && opts.invitationId) {
    // ATS (R-X-02): событие «контакты закрыты». Импорт динамический — ats-webhook сам читает раскрытия отсюда.
    const invitationId = opts.invitationId;
    void import('../employer/ats-webhook')
      .then((m) => m.notifyAtsStatusChanged(invitationId))
      .catch((err) => console.warn('[ats] disclosure revoke event failed:', err instanceof Error ? err.message : err));
  }
  return { kind, revokedAt: now.toISOString(), ...(deletedRecordings !== undefined ? { deletedRecordings } : {}) };
}

/** Раскрыта ли личность кандидата компании: принятое приглашение этой компании + действующее раскрытие по нему. */
export async function disclosedCandidateIds(companyId: string, candidateIds: readonly string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const invs = await prisma.invitation.findMany({
    where: { companyId, candidateId: { in: [...candidateIds] }, status: { in: ['accepted', 'hired'] } },
    select: { id: true, candidateId: true },
  });
  if (invs.length === 0) return new Set();
  const consents = await prisma.consent.findMany({
    where: { kind: 'identity_disclosure', revokedAt: null, user: { candidateId: { in: [...new Set(invs.map((i) => i.candidateId))] } } },
    select: { context: true },
  });
  const open = new Set(consents.map((c) => invitationOf(c.context)).filter((v): v is string => !!v));
  return new Set(invs.filter((i) => open.has(i.id)).map((i) => i.candidateId));
}

/** Раскрыта ли личность по одному приглашению (карточки приглашений работодателя). */
export async function disclosedInvitationIds(invitationIds: readonly string[]): Promise<Set<string>> {
  if (invitationIds.length === 0) return new Set();
  const consents = await prisma.consent.findMany({
    where: { kind: 'identity_disclosure', revokedAt: null, user: { candidate: { invitations: { some: { id: { in: [...invitationIds] } } } } } },
    select: { context: true },
  });
  const want = new Set(invitationIds);
  return new Set(consents.map((c) => invitationOf(c.context)).filter((v): v is string => !!v && want.has(v)));
}

// --- кабинет «Мои согласия» ---

export interface ConsentItemView {
  kind: ConsentKindName;
  title: string;
  label: string;
  state: ConsentState;
  /** Версия действующего (или последнего) согласия; null — не давал. */
  version: string | null;
  currentVersion: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  requiredFor: string | null;
  revoke: 'button' | 'erase' | 'per_invitation';
  docUrl: string | null;
  paragraphs: readonly string[];
  /** identity_disclosure: приглашение и компания. */
  invitationId?: string;
  company?: string | null;
}

const CANDIDATE_LIST: ConsentKindName[] = ['pd_processing', 'ai_assessment', 'employer_visibility', 'call_recording', 'research', 'marketing'];
const EMPLOYER_LIST: ConsentKindName[] = ['pd_processing', 'employer_offer', 'employer_data_obligation'];

export async function listConsents(userId: string): Promise<{ items: ConsentItemView[] }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { candidateId: true, employerProfile: { select: { id: true } } } });
  if (!user) throw errors.notFound('Аккаунт не найден');
  const rows = await rowsOf(userId);
  const kinds = [...new Set([...(user.candidateId ? CANDIDATE_LIST : []), ...(user.employerProfile ? EMPLOYER_LIST : []), 'pd_processing' as const])];
  const view = (kind: ConsentKindName, own: ConsentRow[], extra: Partial<ConsentItemView> = {}): ConsentItemView => {
    const t = consentTextFor(kind);
    const last = pickActive(own) ?? own[0] ?? null;
    return {
      kind,
      title: t.title,
      label: t.label,
      state: consentState(own, kind),
      version: last?.version ?? null,
      currentVersion: t.version,
      acceptedAt: last?.acceptedAt.toISOString() ?? null,
      revokedAt: last?.revokedAt?.toISOString() ?? null,
      requiredFor: t.requiredFor,
      revoke: t.revoke,
      docUrl: t.docUrl ?? null,
      paragraphs: t.paragraphs,
      ...extra,
    };
  };
  const items = kinds.map((k) => view(k, rows.filter((r) => r.kind === k)));
  const disclosures = rows.filter((r) => r.kind === 'identity_disclosure');
  const invIds = [...new Set(disclosures.map((r) => invitationOf(r.context)).filter((v): v is string => !!v))];
  if (invIds.length) {
    const invs = await prisma.invitation.findMany({
      where: { id: { in: invIds } },
      select: { id: true, company: { select: { name: true } }, vacancy: { select: { company: { select: { name: true } } } } },
    });
    const name = new Map(invs.map((i) => [i.id, i.company?.name ?? i.vacancy?.company.name ?? null]));
    for (const id of invIds) {
      items.push(view('identity_disclosure', disclosures.filter((r) => invitationOf(r.context) === id), { invitationId: id, company: name.get(id) ?? null }));
    }
  }
  return { items };
}
