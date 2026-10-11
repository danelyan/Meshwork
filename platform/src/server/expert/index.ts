import 'server-only';

// Режим эксперта (/expert): жюри проходит настоящий тест на грейд без регистрации, грейд никому не присваивается.
//
// Граница доверия (публичный вход):
//  - эксперт — одноразовый Candidate + User без входа (AuthAccount provider = 'expert'), почта `…@expert.invalid`;
//  - сессии `cid` у эксперта нет: своя кука `fsp_expert` (другой формат и домен подписи, path=/api/expert), её нельзя
//    подставить вместо `cid` — parseSession такой токен не примет. Значит, остальные API (консультант, профиль,
//    согласия, приватность, загрузки) эксперту закрыты, он видит только свои попытки через /api/expert/*;
//  - в подборку и поиск не попадает: hiddenFromEmployers = true (переключить его некому — нет сессии) и явный фильтр
//    почты эксперта в employer/matching.ts (loadPool — общий источник поиска и подборки);
//  - категорию сервис теста (finalize) пишет как обычно — её удаляет scrubExpertCategories сразу после итога;
//  - лимиты: на адрес клиента (RATE_PER_CLIENT), общий потолок за сутки (DAILY_CAP), TTL сутки — старые эксперты
//    удаляются при создании нового.
// Флаг — DEMO_LOGIN (как /demo): выключен → 404.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { clientKey, hit, type RateRule } from '@/server/auth/rate-limit';
import { ensureConsents } from '@/server/consent/service';
import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';
import { errors } from '@/server/errors';
import { readCookie } from '@/server/session';
import { juryResult } from '@/server/test/jury';
import type { IntegrityIndex } from '@/server/test/integrity';
import type { AttemptView, JuryResult } from '@/server/test/types';
import type { Grade } from '@/server/types';

import { EXPERT_EMAIL_SUFFIX } from './marker';

export { EXPERT_EMAIL_DOMAIN, EXPERT_EMAIL_SUFFIX, NOT_EXPERT_CANDIDATE, isExpertEmail } from './marker';

export const EXPERT_COOKIE = 'fsp_expert';
export const EXPERT_COOKIE_PATH = '/api/expert';
export const EXPERT_PROVIDER = 'expert';
export const EXPERT_NAME = 'Эксперт жюри';
/** Срок жизни эксперта и куки: как у незавершённой попытки (ATTEMPT_TTL_HOURS). */
export const EXPERT_TTL_SEC = 24 * 60 * 60;
/** Новых экспертов с одного адреса клиента. */
export const EXPERT_RATE_PER_CLIENT: RateRule = { limit: 20, windowMs: 10 * 60_000 };
/** Общий потолок новых экспертов за сутки (TTL), чтобы публичная кнопка не плодила записи без конца. */
export const EXPERT_DAILY_CAP = 300;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function assertExpertEnabled(): void {
  if (!getEnv().DEMO_LOGIN) throw errors.notFound();
}

// Отдельный домен подписи: подпись эксперта не совпадёт с подписью `cid` даже на тех же байтах.
function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`expert:${payload}`).digest('base64url');
}

/** Токен куки эксперта: `x.<candidateId>.<exp>.<sig>` — 4 части, parseSession (`cid`) его не принимает. */
export function signExpertToken(candidateId: string, secret: string = getEnv().SESSION_SECRET, nowSec = Math.floor(Date.now() / 1000), ttlSec = EXPERT_TTL_SEC): string {
  if (!ID_RE.test(candidateId)) throw new Error('signExpertToken: недопустимый id');
  const payload = `x.${candidateId}.${nowSec + ttlSec}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyExpertToken(token: string | undefined | null, secret: string = getEnv().SESSION_SECRET, nowSec = Math.floor(Date.now() / 1000)): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'x') return null;
  const [, id, exp, sig] = parts as [string, string, string, string];
  if (!ID_RE.test(id) || !/^\d{1,12}$/.test(exp)) return null;
  const expected = Buffer.from(sign(`x.${id}.${exp}`, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (Number(exp) <= nowSec) return null;
  return id;
}

export function expertCookie(candidateId: string) {
  return {
    name: EXPERT_COOKIE,
    value: signExpertToken(candidateId),
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: getEnv().APP_URL.startsWith('https://'),
    path: EXPERT_COOKIE_PATH,
    maxAge: EXPERT_TTL_SEC,
  };
}

/** candidateId эксперта из куки; кука подписана нами, и запись — именно эксперт (защита в глубину). Иначе 401. */
export async function requireExpert(req: Request): Promise<string> {
  const id = verifyExpertToken(readCookie(req, EXPERT_COOKIE));
  if (!id) throw errors.unauthorized('Сессия эксперта не найдена или истекла. Начните тест эксперта заново.');
  const c = await prisma.candidate.findFirst({ where: { id, email: { endsWith: EXPERT_EMAIL_SUFFIX } }, select: { id: true } });
  if (!c) throw errors.unauthorized('Сессия эксперта не найдена или истекла. Начните тест эксперта заново.');
  return c.id;
}

/** Удалить экспертов старше TTL (попытки, задания и категории — каскадом). Ошибка уборки не мешает созданию. */
export async function purgeExpiredExperts(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - EXPERT_TTL_SEC * 1000);
  const old = await prisma.candidate.findMany({ where: { email: { endsWith: EXPERT_EMAIL_SUFFIX }, createdAt: { lt: before } }, select: { id: true }, take: 500 });
  if (old.length === 0) return 0;
  const ids = old.map((c) => c.id);
  await prisma.$transaction([
    prisma.user.deleteMany({ where: { candidateId: { in: ids }, accounts: { some: { provider: EXPERT_PROVIDER } } } }),
    prisma.candidate.deleteMany({ where: { id: { in: ids }, email: { endsWith: EXPERT_EMAIL_SUFFIX } } }),
  ]);
  return ids.length;
}

/**
 * Новый одноразовый эксперт: Candidate (скрыт от работодателей) + User без входа с согласием Г3 (тест оценивается
 * автоматически; нажатие «Начать тест эксперта» — это согласие, ПДн нет). Лимиты: адрес клиента и суточный потолок.
 */
export async function createExpert(req: Request, now: Date = new Date()): Promise<string> {
  if (!hit(`expert:${clientKey(req)}`, EXPERT_RATE_PER_CLIENT, now.getTime())) throw errors.rateLimited('Слишком много тестов эксперта подряд. Подождите несколько минут.');
  try {
    await purgeExpiredExperts(now);
  } catch (e) {
    console.warn('[expert] уборка старых экспертов не удалась', e);
  }
  const since = new Date(now.getTime() - EXPERT_TTL_SEC * 1000);
  const recent = await prisma.candidate.count({ where: { email: { endsWith: EXPERT_EMAIL_SUFFIX }, createdAt: { gte: since } } });
  if (recent >= EXPERT_DAILY_CAP) throw errors.rateLimited('Лимит тестов эксперта на сутки исчерпан.');
  const key = randomUUID();
  const candidate = await prisma.candidate.create({
    data: {
      email: `expert-${key}${EXPERT_EMAIL_SUFFIX}`,
      name: EXPERT_NAME,
      hiddenFromEmployers: true,
      isDemo: false,
      user: {
        create: {
          name: EXPERT_NAME,
          role: 'candidate',
          onboardedAt: now,
          accounts: { create: { provider: EXPERT_PROVIDER, providerAccountId: key } },
        },
      },
    },
    select: { id: true, user: { select: { id: true } } },
  });
  await ensureConsents(candidate.user!.id, ['ai_assessment']);
  return candidate.id;
}

/** Удалить эксперта сразу (тест не начался). */
export async function deleteExpert(candidateId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.deleteMany({ where: { candidateId, accounts: { some: { provider: EXPERT_PROVIDER } } } }),
    prisma.candidate.deleteMany({ where: { id: candidateId, email: { endsWith: EXPERT_EMAIL_SUFFIX } } }),
  ]);
}

/** Категория эксперту не присваивается: сервис теста записал её при итоге — удаляем. Только у эксперта. */
export async function scrubExpertCategories(candidateId: string): Promise<void> {
  await prisma.candidateCategory.deleteMany({ where: { candidateId, candidate: { email: { endsWith: EXPERT_EMAIL_SUFFIX } } } });
}

export interface ExpertOutcome {
  /** Грейд по ответам: заявленный или грейд ниже (R-C-08); null — по ответам не выдаётся. */
  wouldGrant: Grade | null;
  /** Индекс честности задержал бы выдачу кандидату (needs_confirmation → подтверждающий тест). */
  heldByIntegrity: boolean;
  theta: number;
  se: number;
  pPass: number;
}

export interface ExpertAttemptView {
  attempt: AttemptView;
  outcome: ExpertOutcome | null;
  /** Разбор индекса честности (jury.ts) — в режиме эксперта всегда, без флага JURY_INSIGHTS. */
  jury: JuryResult | null;
}

/** Ответ API эксперта: вид попытки + итог для разбора. После итога — убрать категорию. */
export async function expertView(candidateId: string, attempt: AttemptView): Promise<ExpertAttemptView> {
  const r = attempt.result;
  if (!r) return { attempt, outcome: null, jury: null };
  await scrubExpertCategories(candidateId);
  const row = await prisma.testAttempt.findFirst({ where: { id: attempt.id, candidateId }, select: { integrity: true } });
  const integrity = row?.integrity && typeof row.integrity === 'object' && !Array.isArray(row.integrity) ? (row.integrity as unknown as IntegrityIndex & { confirmGrade?: Grade | null }) : null;
  const jury = integrity && Array.isArray(integrity.reasons) ? juryResult(integrity, null, false) : null;
  const heldByIntegrity = r.status === 'needs_confirmation';
  const wouldGrant = r.confirmed ? attempt.grade : heldByIntegrity ? (integrity?.confirmGrade ?? attempt.grade) : (r.offeredGrade ?? null);
  // Кандидатские поля, которые эксперту не нужны и вводят в заблуждение («категория записана», согласие на грейд ниже).
  const clean: AttemptView = { ...attempt, result: { ...r, jury: undefined, juniorOffered: false, integrity: null } };
  return { attempt: clean, outcome: { wouldGrant, heldByIntegrity, theta: r.theta, se: r.se, pPass: r.pPass }, jury };
}
