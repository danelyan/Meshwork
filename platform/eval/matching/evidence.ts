// Слепок профиля для формулы подбора: утверждения + (при withStages) проекты и созвон по ADR 0003.
// Общий для run.ts и ablation.ts, чтобы оба считали по одному и тому же представлению.
import type { CatalogEntry } from '../../src/server/claims/types';
import type { CandidateEvidence } from '../../src/server/employer/ranking';
import type { CallsEvidence, ProjectEvidence } from '../../src/server/employer/stages';

import type { SynProfile } from './synthetic';

const AT = '2026-10-11T12:00:00.000Z';

export function stageEvidence(p: Pick<SynProfile, 'id' | 'projects' | 'callTopics'>): { projects?: ProjectEvidence[]; calls?: CallsEvidence } {
  const out: { projects?: ProjectEvidence[]; calls?: CallsEvidence } = {};
  if (p.projects?.length) {
    out.projects = p.projects.map((x) => ({
      submissionId: `${p.id}:${x.vacancyId}`, taskId: `task:${x.vacancyId}`, vacancyId: x.vacancyId, subcategoryId: null,
      score: x.score, tests: { passed: Math.round(x.score * 10), total: 10 }, flags: [], late: false, checkedAt: AT, criteria: [],
    }));
  }
  if (p.callTopics) {
    const scoresByTopic = p.callTopics.map((t) => ({ topic: t.catalogId, catalogId: t.catalogId, claimed: t.claimed, probed: 1, confirmed: t.confirmed, total: t.confirmed ? 6 : 2 }));
    out.calls = {
      qualifying: {
        confirmedTopics: scoresByTopic.filter((d) => d.confirmed).map((d) => d.topic),
        probedTopics: scoresByTopic.map((d) => d.topic),
        confirmedCatalogIds: [...new Set(scoresByTopic.filter((d) => d.confirmed).map((d) => d.catalogId))].sort(),
        scoresByTopic, evaluatedAt: AT,
      },
    };
  }
  return out;
}

export function toEvidence(p: Pick<SynProfile, 'id' | 'specialization' | 'fspState' | 'category' | 'claims' | 'stack' | 'projects' | 'callTopics'>, catalog: Map<string, CatalogEntry>): CandidateEvidence {
  return {
    id: p.id, specialization: p.specialization, fspState: p.fspState, category: p.category,
    claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: catalog.get(catalogId)?.statement ?? catalogId, quote: p.stack.join(', ') })),
    ...stageEvidence(p),
  };
}
