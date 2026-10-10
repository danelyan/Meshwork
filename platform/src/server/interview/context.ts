// Контекст ИИнтервью: направление, подкатегория, заявленный грейд, план блоков (компетенции по приоритету),
// пометки по последнему тесту и утверждения кандидата. Оценщику из этого уходят только названия компетенций.
import type { Specialization } from '../../lib/directions';
import { isSpecialization } from '../../lib/directions';
import type { Grade } from '../../lib/grades';
import { prisma } from '../db';
import { type BlockPlan, emptyBlockPlan } from './plan';
import { type CompetencyDef, blockCompetencies, competenciesFor, orderTechnical } from './model';

/** Пометка по тесту на грейд: сколько заданий, покрывающих утверждения компетенции, решены верно/неверно. */
export interface TestHint {
  competencyId: string;
  wrong: number;
  right: number;
}

export interface InterviewContext {
  specialization: Specialization;
  subcategoryId: string | null;
  claimedGrade: Grade | null;
  plan: BlockPlan;
  /** catalogId утверждений кандидата (confirmed | edited) — компетенция «заявлена», если покрывает хотя бы одно. */
  claimedCatalogIds: Set<string>;
  testHints: TestHint[];
  /** Факты резюме (цитаты утверждений) — вырезаются из вопросов перед оценщиком. */
  resumeFacts: string[];
}

/** Порядок блока «Разбор теста»: ядро подкатегории → с ошибками в тесте → верно в тесте → остальные (чистая функция). */
export function orderTestBlock(tech: readonly CompetencyDef[], hints: readonly TestHint[]): CompetencyDef[] {
  const h = new Map(hints.map((x) => [x.competencyId, x]));
  const rank = (c: CompetencyDef, i: number) => {
    const x = h.get(c.id);
    const wrong = x && x.wrong > 0 ? 0 : 1;
    const right = x && x.right > 0 ? 0 : 1;
    return [wrong, right, i] as const;
  };
  return tech
    .map((c, i) => ({ c, r: rank(c, i) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.r[2] - b.r[2])
    .map((x) => x.c);
}

export function buildBlockPlan(specialization: Specialization, subcategoryId: string | null, hints: readonly TestHint[]): BlockPlan {
  const plan = emptyBlockPlan();
  const tech = orderTechnical(specialization, subcategoryId);
  // Ядро подкатегории остаётся первым: пометки теста ранжируют внутри ядра и внутри остальных.
  const core = subcategoryId ? tech.filter((c) => c.core.includes(subcategoryId)) : [];
  const rest = tech.filter((c) => !core.includes(c));
  plan.test = [...orderTestBlock(core, hints), ...orderTestBlock(rest, hints)];
  plan.intro = blockCompetencies('intro', specialization);
  plan.systems = blockCompetencies('systems', specialization);
  plan.team = blockCompetencies('team', specialization);
  return plan;
}

/** Пометки по тесту из заданий попытки: catalogIds шаблона → компетенции направления. */
export function testHintsFrom(specialization: Specialization, items: readonly { catalogIds: readonly string[]; correct: boolean | null }[]): TestHint[] {
  const byId = new Map<string, TestHint>();
  for (const c of competenciesFor(specialization)) {
    for (const it of items) {
      if (it.correct === null || !it.catalogIds.some((id) => c.catalogIds.includes(id))) continue;
      const cur = byId.get(c.id) ?? { competencyId: c.id, wrong: 0, right: 0 };
      if (it.correct) cur.right += 1;
      else cur.wrong += 1;
      byId.set(c.id, cur);
    }
  }
  return [...byId.values()];
}

export async function loadInterviewContext(candidateId: string): Promise<InterviewContext> {
  const cand = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      specialization: true,
      subcategoryId: true,
      profile: { select: { claimedGrade: true } },
      categories: { orderBy: { confirmedAt: 'desc' }, take: 1, select: { specialization: true, grade: true } },
    },
  });
  const specRaw = cand?.categories[0]?.specialization ?? cand?.specialization ?? 'backend';
  const specialization: Specialization = isSpecialization(specRaw) ? specRaw : 'backend';
  const claimedGrade = cand?.profile?.claimedGrade ?? cand?.categories[0]?.grade ?? null;

  const attempt = await prisma.testAttempt.findFirst({
    where: { candidateId, specialization, status: { in: ['passed', 'not_confirmed'] } },
    orderBy: { startedAt: 'desc' },
    select: { subcategoryId: true, items: { select: { correct: true, template: { select: { catalogIds: true } } } } },
  });
  const testHints = attempt ? testHintsFrom(specialization, attempt.items.map((i) => ({ catalogIds: i.template.catalogIds, correct: i.correct }))) : [];
  const subcategoryId = cand?.subcategoryId ?? attempt?.subcategoryId ?? null;

  const claims = await prisma.claim.findMany({
    where: { candidateId, status: { in: ['confirmed', 'edited'] } },
    select: { catalogId: true, quote: true },
  });
  return {
    specialization,
    subcategoryId,
    claimedGrade,
    plan: buildBlockPlan(specialization, subcategoryId, testHints),
    claimedCatalogIds: new Set(claims.map((c) => c.catalogId)),
    testHints,
    resumeFacts: claims.map((c) => c.quote.trim()).filter((q) => q.length >= 8),
  };
}
