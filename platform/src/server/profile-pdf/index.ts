// Серверный PDF-профиль кандидата (R-C-03, аудит 11.10 C02): данные — те же загрузчики, что у экрана
// профиля (getProfile, profileDetails), плюс ступени проверки; документ собирает model.ts, рисует render.ts.
import { latestQualifyingVerdict } from '@/server/call';
import { getProfile } from '@/server/claims';
import { profileDetails } from '@/server/claims/profile-details';
import { prisma } from '@/server/db';

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

/**
 * Подкатегория и версия политики теста, по которой выдана текущая категория. Категория не хранит id попытки,
 * поэтому берём последнюю завершённую попытку того же направления не позже выдачи категории (с запасом в минуту).
 * Её нет у категорий из сида (демоданные) — тогда версия не сохранена, и PDF так и пишет, а не подставляет текущую.
 */
async function loadCategoryProvenance(candidateId: string): Promise<{ subcategoryId: string | null; policyVersion: string | null }> {
  const category = await prisma.candidateCategory.findFirst({
    where: { candidateId },
    orderBy: { confirmedAt: 'desc' },
    select: { subcategoryId: true, specialization: true, confirmedAt: true },
  });
  if (!category) return { subcategoryId: null, policyVersion: null };
  const attempt = await prisma.testAttempt.findFirst({
    where: { candidateId, specialization: category.specialization, status: 'passed', finishedAt: { lte: new Date(category.confirmedAt.getTime() + 60_000) } },
    orderBy: { finishedAt: 'desc' },
    select: { policyVersion: true },
  });
  return { subcategoryId: category.subcategoryId, policyVersion: attempt?.policyVersion ?? null };
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
