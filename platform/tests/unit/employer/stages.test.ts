// Ступени 1–3 ADR 0003 в ранжировании и объяснении работодателя (lane employer-card).
import { maskContacts } from '@/server/collector/mask';
import { rankCandidates, scoreCandidate, type CandidateEvidence, type MatchTarget } from '@/server/employer/ranking';
import {
  buildProjectBlock,
  maskProjectBlock,
  pickOwnProject,
  summarizeDefense,
  summarizeQualifying,
  type DefenseEvidence,
  type ProjectEvidence,
  type QualifyingEvidence,
} from '@/server/employer/stages';
import { CALL_TOPIC_BONUS, CALL_TOPIC_BONUS_MAX, PROJECT_BONUS_PER_SCORE } from '@/server/employer/weights';

import { fixtureCatalog } from '../../helpers/recommend-fixtures';

const catalog = fixtureCatalog();
const target: MatchTarget = {
  vacancyId: 'v1',
  specialization: 'backend',
  grade: 'middle',
  needs: [
    { catalogId: 'be.idempotency', weight: 3 },
    { catalogId: 'be.transactions', weight: 3 },
    { catalogId: 'be.message-queue', weight: 2 },
    { catalogId: 'be.sql-indexes', weight: 2 },
  ],
  stack: [],
};

function cand(id: string, extra: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return {
    id,
    specialization: 'backend',
    fspState: 'not_linked',
    category: null,
    claims: [{ catalogId: 'be.idempotency', level: 'self_reported', statement: 'Идемпотентность', quote: 'Go' }],
    ...extra,
  };
}

function project(extra: Partial<ProjectEvidence> = {}): ProjectEvidence {
  return {
    submissionId: 's1',
    taskId: 't1',
    vacancyId: 'v1',
    subcategoryId: 'backend.integrations',
    score: 0.8,
    tests: { passed: 4, total: 5 },
    flags: [],
    late: false,
    checkedAt: '2026-10-10T10:00:00.000Z',
    criteria: [{ id: 'r1', text: 'Идемпотентность платежа', source: 'required', passed: true, evidence: 'Пишет ivan@example.com, см. src/pay.ts', file: 'src/pay.ts' }],
    ...extra,
  };
}

const qualifying = (topics: { topic: string; catalogId: string | null; confirmed: boolean; probed?: number }[]): QualifyingEvidence =>
  summarizeQualifying({
    evaluatedAt: '2026-10-10T10:00:00.000Z',
    depthMap: topics.map((t) => ({ topic: t.topic, catalogId: t.catalogId, claimed: true, probed: t.probed ?? 2, confirmed: t.confirmed, total: t.confirmed ? 6 : 2 })),
  });

const defense = (extra: Partial<DefenseEvidence> = {}): DefenseEvidence => ({
  score: 3,
  passed: false,
  flags: ['strong_project_weak_defense'],
  projectScore: 0.9,
  projectSubmissionId: 's1',
  evaluatedAt: '2026-10-10T11:00:00.000Z',
  ...extra,
});

describe('свидетельства ступеней: сжатие вердиктов', () => {
  it('карта глубины: подтверждённые и спрошенные темы, catalogId без дублей, цитат в свидетельстве нет', () => {
    const q = summarizeQualifying({
      evaluatedAt: 'x',
      depthMap: [
        { topic: 'Идемпотентность', catalogId: 'be.idempotency', claimed: true, probed: 3, confirmed: true, total: 7 },
        { topic: 'Идемпотентность ключей', catalogId: 'be.idempotency', claimed: true, probed: 1, confirmed: true, total: 6 },
        { topic: 'Очереди', catalogId: 'be.message-queue', claimed: true, probed: 2, confirmed: false, total: 2 },
        { topic: 'Деплой', catalogId: null, claimed: false, probed: 0, confirmed: false, total: 0 },
      ],
    });
    expect(q.confirmedTopics).toEqual(['Идемпотентность', 'Идемпотентность ключей']);
    expect(q.probedTopics).toEqual(['Идемпотентность', 'Идемпотентность ключей', 'Очереди']);
    expect(q.confirmedCatalogIds).toEqual(['be.idempotency']);
    expect(JSON.stringify(q)).not.toMatch(/quote|claimStatement/);
  });

  it('защита: баллы и флаги, без цитат', () => {
    const d = summarizeDefense({ total: 3, passed: false, flags: ['strong_project_weak_defense'], projectScore: 0.9, evaluatedAt: 'x', ...{ quotes: ['секрет'] } } as never, 's1');
    expect(d).toEqual({ score: 3, passed: false, flags: ['strong_project_weak_defense'], projectScore: 0.9, projectSubmissionId: 's1', evaluatedAt: 'x' });
  });
});

describe('балл: проект под ЭТУ потребность и темы созвона', () => {
  it('проект под эту потребность даёт PROJECT_BONUS_PER_SCORE × балл; проект под чужую — нет', () => {
    const plain = scoreCandidate(cand('a'), target, catalog)!;
    const own = scoreCandidate(cand('a', { projects: [project({ score: 0.8 })] }), target, catalog)!;
    const foreign = scoreCandidate(cand('a', { projects: [project({ vacancyId: 'v-other' })] }), target, catalog)!;
    expect(own.score).toBeCloseTo(plain.score + PROJECT_BONUS_PER_SCORE * 0.8, 4);
    expect(own.boosts.project).toBeCloseTo(PROJECT_BONUS_PER_SCORE * 0.8, 4);
    expect(foreign.score).toBe(plain.score);
    expect(own.ownProject).toBe(true);
    expect(foreign.ownProject).toBeUndefined();
  });

  it('поиск по банку (без vacancyId): проект баллов не даёт', () => {
    const plain = scoreCandidate(cand('a'), { ...target, vacancyId: null }, catalog)!;
    const withProject = scoreCandidate(cand('a', { projects: [project()] }), { ...target, vacancyId: null }, catalog)!;
    expect(withProject.score).toBe(plain.score);
  });

  it('из нескольких проектов под потребность берётся лучший', () => {
    const best = pickOwnProject([project({ score: 0.4, submissionId: 'x' }), project({ score: 0.9, submissionId: 'y' })], 'v1');
    expect(best?.submissionId).toBe('y');
    expect(pickOwnProject([project()], null)).toBeNull();
  });

  it('темы созвона: бонус только за подтверждённые темы из требований потребности, с потолком', () => {
    const plain = scoreCandidate(cand('a'), target, catalog)!;
    const one = scoreCandidate(cand('a', { calls: { qualifying: qualifying([{ topic: 'Идемпотентность', catalogId: 'be.idempotency', confirmed: true }, { topic: 'Очереди', catalogId: 'be.message-queue', confirmed: false }, { topic: 'Деплой', catalogId: 'be.deploy', confirmed: true }]) } }), target, catalog)!;
    expect(one.score).toBeCloseTo(plain.score + CALL_TOPIC_BONUS, 4);
    expect(one.explanation.depthMap?.matchedNeed).toBe(1);
    const all = scoreCandidate(
      cand('a', { calls: { qualifying: qualifying(target.needs.map((n) => ({ topic: n.catalogId, catalogId: n.catalogId, confirmed: true }))) } }),
      { ...target, needs: [...target.needs, { catalogId: 'be.rest-design', weight: 1 }] },
      catalog,
    )!;
    expect(all.boosts.calls).toBe(CALL_TOPIC_BONUS_MAX);
  });

  it('кандидат без категории и без закрытых требований, но с проектом под потребность, остаётся в выдаче', () => {
    const c = cand('p', { claims: [], projects: [project()] });
    expect(scoreCandidate(cand('q', { claims: [] }), target, catalog)).toBeNull();
    const r = scoreCandidate(c, target, catalog)!;
    expect(r.score).toBeGreaterThan(0);
    expect(r.ownProject).toBe(true);
  });

  it('проект под потребность без категории: summary объясняет, почему кандидат показан', () => {
    const noCat = scoreCandidate(cand('p', { claims: [], projects: [project()] }), target, catalog)!;
    expect(noCat.explanation.summary).toMatch(/Показан за проверенный проект; категории под потребность нет\.$/);
    const withCat = scoreCandidate(cand('q', { category: { specialization: 'backend', grade: 'middle' }, projects: [project()] }), target, catalog)!;
    expect(withCat.explanation.summary).not.toMatch(/Показан за проверенный проект/);
  });

  it('ранжирование: кандидат с проектом под потребность выше такого же без проекта', () => {
    const r = rankCandidates([cand('a'), cand('b', { projects: [project()] })], target, catalog);
    expect(r.map((x) => x.candidateId)).toEqual(['b', 'a']);
  });
});

describe('защита: флаг — пометка, не штраф', () => {
  it('флаг strong_project_weak_defense не меняет балл и порядок, но виден в объяснении', () => {
    const clean = cand('a', { calls: { defense: defense({ flags: [], passed: true, score: 7 }) }, projects: [project()] });
    const flagged = cand('b', { calls: { defense: defense() }, projects: [project()] });
    const noDefense = cand('c', { projects: [project()] });
    const rc = scoreCandidate(clean, target, catalog)!;
    const rf = scoreCandidate(flagged, target, catalog)!;
    const rn = scoreCandidate(noDefense, target, catalog)!;
    expect(rf.score).toBe(rc.score);
    expect(rf.score).toBe(rn.score);
    expect(rf.explanation.defense?.flags).toEqual(['strong_project_weak_defense']);
    expect(rf.explanation.defense?.notes[0]).toMatch(/не штраф/);
    expect(rf.explanation.summary).toMatch(/защита: 3 из 8 \(флаг: сильный проект при слабой защите\)/);
    expect(rc.explanation.defense?.flags).toEqual([]);
    // Порядок определяют только прежние слагаемые: равный балл — по id, а не по флагу.
    expect(rankCandidates([flagged, clean], target, catalog).map((x) => x.candidateId)).toEqual(['a', 'b']);
    expect(rankCandidates([clean, flagged], target, catalog).map((x) => x.candidateId)).toEqual(['a', 'b']);
  });

  it('защита без ответов: оценки нет', () => {
    const r = scoreCandidate(cand('a', { calls: { defense: defense({ score: null, passed: null, flags: ['short_defense'] }) } }), target, catalog)!;
    expect(r.explanation.defense?.score).toBeNull();
    expect(r.explanation.summary).toMatch(/[Зз]ащита: ответов нет/);
  });
});

describe('объяснение: проект своей и чужой потребности', () => {
  it('своя — таблица критериев; чужая — только подкатегория и балл, без критериев и вакансии', () => {
    const c = cand('a', { projects: [project(), project({ vacancyId: 'v-other', taskId: 't2', submissionId: 's2', subcategoryId: 'backend.web-api', score: 0.55, criteria: [{ id: 'z', text: 'ТАЙНА чужой потребности', source: 'wish', passed: true, evidence: 'эвиденс' }] })] });
    const ex = scoreCandidate(c, target, catalog)!.explanation;
    expect(ex.project?.own?.criteria).toHaveLength(1);
    expect(ex.project?.others).toEqual([{ subcategoryId: 'backend.web-api', subcategory: expect.stringMatching(/\S/), score: 0.55 }]);
    expect(JSON.stringify(ex.project?.others)).not.toMatch(/ТАЙНА|v-other|t2|s2/);
    expect(ex.summary).toMatch(/Проект под эту потребность: 80% скрытых тестов/);
  });

  it('без ступеней объяснение не получает новых полей, summary прежний', () => {
    const ex = scoreCandidate(cand('a'), target, catalog)!.explanation;
    expect(ex.depthMap).toBeUndefined();
    expect(ex.project).toBeUndefined();
    expect(ex.defense).toBeUndefined();
    expect(ex.summary).not.toMatch(/созвон|проект|защита/i);
  });

  it('маскирование до принятого приглашения: e-mail и ссылки в доказательствах скрыты, остальное цело', () => {
    const own = project();
    const block = buildProjectBlock([own], own);
    const masked = maskProjectBlock(block);
    expect(block.own?.criteria[0]!.evidence).toContain('ivan@example.com');
    expect(masked.own?.criteria[0]!.evidence).not.toContain('ivan@example.com');
    expect(masked.own?.criteria[0]!.evidence).toContain(maskContacts('ivan@example.com').text);
    expect(masked.own?.criteria[0]!.text).toBe('Идемпотентность платежа');
    expect(maskProjectBlock({ own: null, others: [] })).toEqual({ own: null, others: [] });
  });
});
