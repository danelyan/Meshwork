import { prisma } from '../db';
import { errors } from '../errors';
import { candidateContact, dedupeClaims, toCandidateCard } from '../employer/privacy';
import { loadCatalog } from '../recommend/evidence';
import { resumeFieldsView } from '../resume-fields';
import { STACK } from '../onboarding/scenario';
import { SPECIALIZATIONS, isSpecialization } from '@/lib/directions';

/** Own editable questionnaire fields plus the exact public projection used by employer search. */
export async function profileDetails(candidateId: string) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: {
    id: true, name: true, email: true, contact: true, specialization: true, fspState: true, hiddenFromEmployers: true,
    profile: { select: { city: true, goal: true, claimedGrade: true, stack: true, workFormats: true, salaryMin: true, salaryExpected: true, fspParticipation: true, experienceYears: true, roles: true, softSkills: true } },
    categories: { orderBy: { confirmedAt: 'desc' }, take: 1, select: { specialization: true, grade: true } },
    claims: { where: { status: { in: ['confirmed', 'edited'] } }, select: { catalogId: true, level: true, sourceKind: true } },
    user: { select: { id: true } },
  } });
  if (!candidate) throw errors.notFound('Профиль не найден');
  const [catalog, resumeFields] = await Promise.all([loadCatalog(), resumeFieldsView(candidateId)]);
  const profile = candidate.profile;
  const state = candidate.user ? await prisma.onboardingState.findUnique({ where: { userId: candidate.user.id }, select: { answers: true } }) : null;
  const answers = (state?.answers ?? {}) as Record<string, unknown>;
  const about = typeof answers.experienceSummary === 'string' ? answers.experienceSummary : null;
  const industries = Array.isArray(answers.candidateIndustries) ? answers.candidateIndustries.filter((v): v is string => typeof v === 'string') : [];
  // Навыки, которые встречаются в резюме и GitHub, но ещё не в стеке профиля: «Нашли у вас: + Kafka» (макет Astra v2).
  const evidence = await prisma.claim.findMany({ where: { candidateId, status: { not: 'rejected' }, sourceKind: { in: ['resume', 'github'] } }, select: { statement: true, quote: true, sourceKind: true } });
  const known = new Set((profile?.stack ?? []).map((s) => s.toLowerCase()));
  const pool = [...new Set(isSpecialization(candidate.specialization) ? STACK[candidate.specialization] : SPECIALIZATIONS.flatMap((s) => STACK[s]))];
  const suggestions: { name: string; from: 'resume' | 'github' }[] = [];
  for (const skill of pool) {
    if (known.has(skill.toLowerCase())) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu');
    const hit = evidence.find((c) => re.test(`${c.statement} ${c.quote ?? ''}`));
    if (hit) suggestions.push({ name: skill, from: hit.sourceKind === 'github' ? 'github' : 'resume' });
    if (suggestions.length >= 4) break;
  }
  const checks: [string, boolean][] = [['специализация', Boolean(candidate.specialization)], ['цель', Boolean(profile?.goal)], ['грейд', Boolean(profile?.claimedGrade)], ['навыки', Boolean(profile?.stack.length)], ['формат', Boolean(profile?.workFormats.length)], ['город', Boolean(profile?.city)], ['зарплата', profile?.salaryMin != null], ['контакт', Boolean(candidateContact(candidate))], ['ФСП', Boolean(profile?.fspParticipation)]];
  const fields = checks.map(([, ok]) => ok);
  return {
    name: candidate.name, specialization: candidate.specialization, contact: candidateContact(candidate),
    hiddenFromEmployers: candidate.hiddenFromEmployers, fspState: candidate.fspState,
    basics: profile, resumeFields, completion: { filled: fields.filter(Boolean).length, total: fields.length, missing: checks.filter(([, ok]) => !ok).map(([label]) => label) },
    about, industries, suggestions,
    employerPreview: toCandidateCard({ ...candidate, category: candidate.categories[0] ?? null, claims: dedupeClaims(candidate.claims, catalog), experience: profile }, false),
  };
}

export type ProfileDetails = Awaited<ReturnType<typeof profileDetails>>;
