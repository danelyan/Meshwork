import { prisma } from '../db';
import { errors } from '../errors';
import { candidateContact, dedupeClaims, toCandidateCard } from '../employer/privacy';
import { loadCatalog } from '../recommend/evidence';
import { resumeFieldsView } from '../resume-fields';

/** Own editable questionnaire fields plus the exact public projection used by employer search. */
export async function profileDetails(candidateId: string) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: {
    id: true, name: true, email: true, contact: true, specialization: true, fspState: true, hiddenFromEmployers: true,
    profile: { select: { city: true, goal: true, claimedGrade: true, stack: true, workFormats: true, salaryMin: true, salaryExpected: true, fspParticipation: true, experienceYears: true, roles: true, softSkills: true } },
    categories: { orderBy: { confirmedAt: 'desc' }, take: 1, select: { specialization: true, grade: true } },
    claims: { where: { status: { in: ['confirmed', 'edited'] } }, select: { catalogId: true, level: true, sourceKind: true } },
  } });
  if (!candidate) throw errors.notFound('Профиль не найден');
  const [catalog, resumeFields] = await Promise.all([loadCatalog(), resumeFieldsView(candidateId)]);
  const profile = candidate.profile;
  const fields = [Boolean(candidate.specialization), Boolean(profile?.goal), Boolean(profile?.claimedGrade), Boolean(profile?.stack.length), Boolean(profile?.workFormats.length), Boolean(profile?.city), profile?.salaryMin != null, Boolean(candidateContact(candidate)), Boolean(profile?.fspParticipation)];
  return {
    name: candidate.name, specialization: candidate.specialization, contact: candidateContact(candidate),
    hiddenFromEmployers: candidate.hiddenFromEmployers, fspState: candidate.fspState,
    basics: profile, resumeFields, completion: { filled: fields.filter(Boolean).length, total: fields.length },
    employerPreview: toCandidateCard({ ...candidate, category: candidate.categories[0] ?? null, claims: dedupeClaims(candidate.claims, catalog), experience: profile }, false),
  };
}

export type ProfileDetails = Awaited<ReturnType<typeof profileDetails>>;
