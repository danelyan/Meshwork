// Серверный PDF-профиль кандидата (R-C-03, аудит 11.10 C02): данные — те же загрузчики, что у экрана
// профиля (getProfile, profileDetails), плюс ступени проверки; документ собирает model.ts, рисует render.ts.
import { latestQualifyingVerdict } from '@/server/call';
import { getProfile } from '@/server/claims';
import { profileDetails } from '@/server/claims/profile-details';
import { prisma } from '@/server/db';
import { lowerGrade } from '@/lib/grades';

import { buildProfileDocument, PDF_FILENAME, type ProfileStagesInput } from './model';
import { renderProfilePdf } from './render';

export { buildProfileDocument, PDF_FILENAME } from './model';
export type { ProfileDocument, ProfileDocumentInput } from './model';

async function loadStages(candidateId: string): Promise<ProfileStagesInput> {
  const [verdict, submissions, defenses] = await Promise.all([
    latestQualifyingVerdict(candidateId),
    prisma.projectSubmission.findMany({ where: { candidateId }, select: { status: true } }),
    prisma.defenseSession.findMany({ where: { candidateId, status: 'completed' }, select: { verdict: true } }),
  ]);
  return {
    call: verdict ? { summary: verdict.summary, evaluatedAt: verdict.evaluatedAt } : null,
    projects: { submitted: submissions.length, checked: submissions.filter((s) => s.status === 'checked').length },
    defenses: {
      completed: defenses.length,
      passed: defenses.filter((d) => typeof d.verdict === 'object' && d.verdict !== null && (d.verdict as { passed?: unknown }).passed === true).length,
    },
  };
}

/** Запас между событием, выдавшим категорию, и её confirmedAt: обе записи делает одна транзакция. */
const PROVENANCE_WINDOW_MS = 60_000;

/**
 * Подкатегория и версия политики теста, по которой выдана текущая категория. Категория не хранит id попытки,
 * поэтому ищем попытку того же направления, чьё событие выдачи ближе всего к дате категории: для passed это
 * finishedAt, для принятого грейда ниже — juniorConfirmedAt (confirmJunior оставляет попытку not_confirmed).
 * Попытки нет у категорий из сида (демоданные) — тогда версия не сохранена, и PDF так и пишет, а не подставляет текущую.
 */
export async function loadCategoryProvenance(candidateId: string): Promise<{ subcategoryId: string | null; policyVersion: string | null }> {
  const category = await prisma.candidateCategory.findFirst({
    where: { candidateId },
    orderBy: { confirmedAt: 'desc' },
    select: { subcategoryId: true, specialization: true, grade: true, confirmedAt: true },
  });
  if (!category) return { subcategoryId: null, policyVersion: null };
  const attempts = await prisma.testAttempt.findMany({
    where: { candidateId, specialization: category.specialization, OR: [{ status: 'passed', finishedAt: { not: null } }, { juniorConfirmedAt: { not: null } }] },
    select: { policyVersion: true, status: true, grade: true, subcategoryId: true, finishedAt: true, juniorConfirmedAt: true },
  });
  const issuedAt = category.confirmedAt.getTime();
  let best: { policyVersion: string; distance: number } | null = null;
  for (const a of attempts) {
    // Попытка должна относиться к этой категории: та же подкатегория (если категория её хранит) и тот же грейд —
    // пройденная попытка на этот грейд или принятый грейд ниже после попытки на старший (confirmJunior).
    if (category.subcategoryId && a.subcategoryId !== category.subcategoryId) continue;
    const passedHere = a.status === 'passed' && a.grade === category.grade;
    const offeredHere = a.juniorConfirmedAt !== null && lowerGrade(a.grade) === category.grade;
    const events = [passedHere ? a.finishedAt : null, offeredHere ? a.juniorConfirmedAt : null].filter((d): d is Date => d instanceof Date);
    for (const event of events) {
      const distance = Math.abs(event.getTime() - issuedAt);
      if (distance <= PROVENANCE_WINDOW_MS && (!best || distance < best.distance)) best = { policyVersion: a.policyVersion, distance };
    }
  }
  return { subcategoryId: category.subcategoryId, policyVersion: best?.policyVersion ?? null };
}

/** PDF собственного профиля кандидата: только его данные (candidateId — из сессии). */
export async function profilePdf(candidateId: string, now = new Date()): Promise<{ filename: string; data: Buffer }> {
  const [profile, details, provenance, stages] = await Promise.all([getProfile(candidateId), profileDetails(candidateId), loadCategoryProvenance(candidateId), loadStages(candidateId)]);
  const doc = buildProfileDocument({
    profile,
    contact: details.contact,
    basics: details.basics,
    subcategoryId: provenance.subcategoryId,
    policyVersion: provenance.policyVersion,
    stages,
    generatedAt: now,
  });
  return { filename: PDF_FILENAME, data: await renderProfilePdf(doc) };
}
