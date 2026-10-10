import { catalogFromFile } from '@/server/claims/catalog-file';
import { contactEmail, dedupeClaims, publicSourceType, pseudonym, toCandidateCard } from '@/server/employer/privacy';
import {
  categoryNeeds,
  dropUncovered,
  matchStack,
  passesFilters,
  rankCandidates,
  scoreCandidate,
  type CandidateEvidence,
  type MatchTarget,
} from '@/server/employer/ranking';
import { InvitationInput, VacancyInput, filtersToQuery, parseFilters } from '@/server/employer/schemas';
import { CATEGORY_BASE, CATEGORY_MULT_EXACT, FSP_BOOST, SPEC_MISMATCH_PENALTY } from '@/server/employer/weights';

import { maxPrecisionAtK, ndcgAtK, precisionAtK } from '../../../eval/matching/metrics';
import { fixtureCatalog } from '../../helpers/recommend-fixtures';

const catalog = fixtureCatalog();
const target: MatchTarget = {
  specialization: 'backend',
  grade: 'middle',
  needs: [
    { catalogId: 'be.idempotency', weight: 3 },
    { catalogId: 'be.transactions', weight: 3 },
    { catalogId: 'be.message-queue', weight: 2 },
    { catalogId: 'be.sql-indexes', weight: 2 },
  ],
  stack: ['Go', 'Kafka'],
};

function cand(id: string, claims: [string, CandidateEvidence['claims'][number]['level']][], extra: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return {
    id,
    specialization: 'backend',
    fspState: 'not_linked',
    category: null,
    claims: claims.map(([catalogId, level]) => ({ catalogId, level, statement: `Утверждение ${catalogId}`, quote: 'Go, PostgreSQL' })),
    ...extra,
  };
}

describe('ранжирование работодателя', () => {
  it('доказанное выше «со слов» при одинаковом наборе требований', () => {
    const proven = cand('a', [['be.idempotency', 'artifact'], ['be.transactions', 'artifact']]);
    const said = cand('b', [['be.idempotency', 'self_reported'], ['be.transactions', 'self_reported']]);
    const r = rankCandidates([said, proven], target, catalog);
    expect(r.map((x) => x.candidateId)).toEqual(['a', 'b']);
    expect(r[0]!.provenCount).toBe(2);
    expect(r[1]!.explanation.summary).toContain('доказанного артефактами нет');
  });

  it('объяснение: «закрывает N из M», доказанное, нехватка, ФСП, категория', () => {
    const c = cand('a', [['be.idempotency', 'platform'], ['be.transactions', 'self_reported']], { fspState: 'linked' });
    const r = scoreCandidate(c, target, catalog)!;
    expect(r.covered).toBe(2);
    expect(r.total).toBe(4);
    expect(r.explanation.summary).toMatch(/^Закрывает 2 из 4 требований: /);
    expect(r.explanation.proven).toEqual(['Утверждение be.idempotency']);
    expect(r.explanation.missing).toEqual(['Утверждение be.message-queue', 'Утверждение be.sql-indexes']);
    expect(r.explanation.fsp).toBe('есть подтверждённые достижения');
    expect(r.explanation.category).toMatch(/тест не пройден/);
    expect(r.explanation.stackMatched).toEqual(['Go']);
  });

  it('категория — множитель покрытия: без закрытых требований не поднимает', () => {
    const base = cand('a', [['be.idempotency', 'artifact']]);
    const withCat = { ...base, id: 'b', category: { specialization: 'backend' as const, grade: 'middle' as const } };
    const a = scoreCandidate(base, { ...target, stack: [] }, catalog)!;
    const b = scoreCandidate(withCat, { ...target, stack: [] }, catalog)!;
    expect(b.boosts.category).toBeCloseTo((a.coverageScore + CATEGORY_BASE) * (1 + CATEGORY_MULT_EXACT) - a.coverageScore, 4);
    expect(b.score).toBeGreaterThan(a.score);
    const empty = cand('c', [], { category: { specialization: 'backend', grade: 'middle' } });
    const e = scoreCandidate(empty, target, catalog)!;
    expect(e.score).toBeCloseTo(CATEGORY_BASE * (1 + CATEGORY_MULT_EXACT), 4);
    expect(e.explanation.category).toBe('Backend · Middle (тест)');
    // грейд ниже требуемого — без множителя и с пометкой
    const low = scoreCandidate({ ...base, category: { specialization: 'backend', grade: 'junior' } }, target, catalog)!;
    expect(low.boosts.category).toBe(0);
    expect(low.categoryMatch).toBe(false);
    expect(low.explanation.category).toMatch(/ниже требуемого/);
  });

  it('ФСП — небольшая прибавка, отсутствие ФСП не штрафуется (R-FSP-03)', () => {
    const t = { ...target, stack: [] };
    const no = scoreCandidate(cand('a', [['be.idempotency', 'artifact']], { fspState: 'no_achievements' }), t, catalog)!;
    const yes = scoreCandidate(cand('b', [['be.idempotency', 'artifact']], { fspState: 'linked' }), t, catalog)!;
    expect(yes.score - no.score).toBeCloseTo(FSP_BOOST, 6);
    expect(no.boosts.fsp).toBe(0);
  });

  it('другая специализация — штраф; без утверждений и категории — не в выдаче', () => {
    const fe = cand('fe', [['be.idempotency', 'artifact']], { specialization: 'frontend' });
    const r = scoreCandidate(fe, { ...target, stack: [] }, catalog)!;
    expect(r.boosts.specPenalty).toBe(SPEC_MISMATCH_PENALTY);
    expect(r.explanation.summary).toContain('другая специализация');
    expect(scoreCandidate(cand('z', []), target, catalog)).toBeNull();
  });

  it('детерминированно: равный балл — по id', () => {
    const a = cand('b', [['be.idempotency', 'artifact']]);
    const b = cand('a', [['be.idempotency', 'artifact']]);
    const r1 = rankCandidates([a, b], target, catalog).map((x) => x.candidateId);
    const r2 = rankCandidates([b, a], target, catalog).map((x) => x.candidateId);
    expect(r1).toEqual(['a', 'b']);
    expect(r2).toEqual(r1);
  });

  it('фильтры: специализация по категории, грейд только с категорией, стек, ФСП', () => {
    const c = cand('a', [['be.idempotency', 'artifact']], { specialization: 'frontend', category: { specialization: 'backend', grade: 'junior' } });
    expect(passesFilters(c, { specialization: 'backend' })).toBe(true);
    expect(passesFilters(c, { grade: 'junior' })).toBe(true);
    expect(passesFilters(cand('b', []), { grade: 'junior' })).toBe(false);
    expect(passesFilters(c, { stack: ['go', 'PostgreSQL'] })).toBe(true);
    expect(passesFilters(c, { stack: ['Go', 'Rust'] })).toBe(false);
    expect(passesFilters(c, { fsp: true })).toBe(false);
    expect(passesFilters(c, { categoryOnly: true })).toBe(true);
    expect(matchStack(c.claims, ['GO', 'kafka'])).toEqual(['GO']);
  });

  it('сигнатура категории для поиска без потребности: своя специализация + общие', () => {
    const real = new Map(catalogFromFile().map((e) => [e.id, e]));
    const needs = categoryNeeds(real, 'frontend', 'junior');
    expect(needs.length).toBeGreaterThan(5);
    expect(needs.every((n) => n.catalogId.startsWith('fe.') || n.catalogId.startsWith('common.'))).toBe(true);
  });
});

describe('подборка под потребность: категория из теста — самостоятельное основание показа (Q-36, 10.10)', () => {
  const mid = { specialization: 'backend' as const, grade: 'middle' as const };

  it('только категория (0 закрытых) остаётся в подборке; без категории и с нулём закрытых — нет', () => {
    const catOnly = cand('cat', [], { category: mid });
    const zero = cand('z', [['be.background-jobs', 'self_reported']]);
    const one = cand('o', [['be.idempotency', 'self_reported']]);
    const ranked = rankCandidates([catOnly, zero, one], target, catalog);
    expect(dropUncovered(ranked).map((x) => x.candidateId)).toEqual(expect.arrayContaining(['cat', 'o']));
    expect(dropUncovered(ranked).map((x) => x.candidateId)).not.toContain('z');
  });

  it('категория другой специализации или ниже требуемого грейда — не основание', () => {
    const fe = cand('fe', [], { specialization: 'frontend', category: { specialization: 'frontend', grade: 'middle' } });
    const low = cand('low', [], { category: { specialization: 'backend', grade: 'junior' } });
    const ranked = dropUncovered(rankCandidates([fe, low], target, catalog));
    expect(ranked).toEqual([]);
    // грейд выше требуемого — основание есть
    const high = cand('high', [], { category: mid });
    const jTarget = { ...target, grade: 'junior' as const };
    expect(dropUncovered(rankCandidates([high], jTarget, catalog)).map((x) => x.candidateId)).toEqual(['high']);
  });

  it('порядок: категория + закрытое > только категория > категория не нужна, но слабое покрытие; и при равном покрытии категория выше', () => {
    const both = cand('both', [['be.idempotency', 'self_reported']], { category: mid });
    const catOnly = cand('cat', [], { category: mid });
    const claimsOnly = cand('claims', [['be.idempotency', 'self_reported']]);
    const r = rankCandidates([claimsOnly, catOnly, both], { ...target, stack: [] }, catalog);
    expect(r.map((x) => x.candidateId)).toEqual(['both', 'claims', 'cat']);
    // только категория выше кандидата без категории с практически нулевым покрытием
    const tiny = cand('tiny', [['be.sql-indexes', 'self_reported']]);
    const tinyScore = scoreCandidate(tiny, { ...target, stack: [] }, catalog)!.score;
    const catScore = scoreCandidate(catOnly, { ...target, stack: [] }, catalog)!.score;
    expect(catScore).toBeCloseTo(CATEGORY_BASE * (1 + CATEGORY_MULT_EXACT), 4);
    expect(tinyScore).toBeLessThan(catScore);
    // категория с частичным покрытием не обгоняет сильное покрытие без категории
    const strong = cand('strong', [['be.idempotency', 'artifact'], ['be.transactions', 'artifact'], ['be.message-queue', 'artifact'], ['be.sql-indexes', 'artifact']]);
    const partial = cand('partial', [['be.idempotency', 'self_reported']], { category: mid });
    const r2 = rankCandidates([partial, strong], { ...target, stack: [] }, catalog);
    expect(r2[0]!.candidateId).toBe('strong');
  });

  it('объяснение для «только категория»', () => {
    const r = scoreCandidate(cand('cat', [], { category: mid }), target, catalog)!;
    expect(r.categoryMatch).toBe(true);
    expect(r.covered).toBe(0);
    expect(r.explanation.summary).toMatch(/^Категория Backend · Middle подтверждена тестом; требования потребности не доказаны утверждениями\./);
  });
});

describe('приватность карточки (R-E-07)', () => {
  const src = {
    id: 'cand-1',
    name: 'Иван Петров',
    email: 'ivan@example.test',
    specialization: 'backend' as const,
    fspState: 'linked' as const,
    category: null,
    claims: [
      { catalogId: 'b', statement: 'B', level: 'self_reported' as const, sourceType: null },
      { catalogId: 'a', statement: 'A', level: 'platform' as const, sourceType: null },
      { catalogId: 'c', statement: 'C', level: 'third_party' as const, sourceType: 'fsp' as const },
    ],
  };
  it('до принятия: псевдоним, контактов нет; после — имя и почта', () => {
    const hidden = toCandidateCard(src, false);
    expect(hidden.displayName).toBe(pseudonym('cand-1'));
    expect(hidden.displayName).toMatch(/^Кандидат #[0-9A-F]{6}$/);
    expect(hidden.contacts).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain('ivan@');
    expect(JSON.stringify(hidden)).not.toContain('Петров');
    expect(hidden.claims.map((c) => c.level)).toEqual(['platform', 'third_party', 'self_reported']);
    const open = toCandidateCard(src, true);
    expect(open.contacts).toEqual({ name: 'Иван Петров', email: 'ivan@example.test' });
  });
  it('дедупликация: по catalogId остаётся высший уровень, платформа выше третьей стороны (09.10)', () => {
    const out = dedupeClaims(
      [
        { catalogId: 'x', level: 'third_party', sourceKind: 'fsp' },
        { catalogId: 'x', level: 'platform', sourceKind: 'chat' },
        { catalogId: 'y', level: 'artifact', sourceKind: 'github' },
        { catalogId: 'y', level: 'third_party', sourceKind: 'codeforces' },
      ],
      new Map(),
    );
    expect(out).toEqual([
      { catalogId: 'x', level: 'platform', statement: 'x', sourceType: null },
      { catalogId: 'y', level: 'third_party', statement: 'y', sourceType: 'codeforces' },
    ]);
  });
  it('служебный адрес онбординга — не контакт', () => {
    expect(contactEmail('user-x@users.invalid')).toBeNull();
    expect(contactEmail('a@b.ru')).toBe('a@b.ru');
  });
});

describe('схемы', () => {
  it('фильтры из query: мусор отбрасывается, лимит ограничен, обратно в query', () => {
    const { filters, limit } = parseFilters({ spec: 'backend', grade: 'senior', stack: 'Go, go ,Kafka', fsp: '1', limit: '999' });
    expect(filters).toEqual({ specialization: 'backend', stack: ['Go', 'Kafka'], fsp: true });
    expect(limit).toBe(50);
    expect(filtersToQuery(filters)).toBe('spec=backend&stack=Go%2CKafka&fsp=1');
    expect(parseFilters({}).limit).toBe(20);
  });
  it('приглашение: зарплата и описание обязательны, потребность — нет', () => {
    expect(InvitationInput.safeParse({ candidateId: 'c', message: 'Платёжная команда, Go' }).success).toBe(false);
    expect(InvitationInput.safeParse({ candidateId: 'c', message: 'коротко', salaryOffer: 1 }).success).toBe(false);
    expect(InvitationInput.safeParse({ candidateId: 'c', message: 'Платёжная команда, Go', salaryOffer: 200000 }).success).toBe(true);
  });
  it('потребность: вилка не перевёрнута, хотя бы одно требование', () => {
    const ok = { title: 'Backend', specialization: 'backend', grade: 'junior', salaryFrom: 1, salaryTo: 2, needs: [{ catalogId: 'be.orm', weight: 2 }] };
    expect(VacancyInput.safeParse(ok).success).toBe(true);
    expect(VacancyInput.safeParse({ ...ok, salaryTo: 0 }).success).toBe(false);
    expect(VacancyInput.safeParse({ ...ok, needs: [] }).success).toBe(false);
  });
});

describe('метрики eval подбора', () => {
  const rel = { a: 2, b: 1 };
  it('P@k, потолок, nDCG@k', () => {
    expect(precisionAtK(['a', 'x', 'b'], rel, 5)).toBeCloseTo(0.4);
    expect(maxPrecisionAtK(rel, 5)).toBeCloseTo(0.4);
    expect(ndcgAtK(['a', 'b'], rel, 5)).toBeCloseTo(1);
    expect(ndcgAtK(['b', 'a'], rel, 5)).toBeLessThan(1);
    expect(ndcgAtK(['x'], {}, 5)).toBe(0);
  });
});

describe('тип источника для работодателя (R-E-07)', () => {
  it('только у artifact/third_party; резюме, документ, чат и платформа — null', () => {
    expect(publicSourceType('github', 'artifact')).toBe('github');
    expect(publicSourceType('url', 'artifact')).toBe('article');
    expect(publicSourceType('stackoverflow', 'artifact')).toBe('stackoverflow');
    expect(publicSourceType('codeforces', 'third_party')).toBe('codeforces');
    expect(publicSourceType('fsp', 'third_party')).toBe('fsp');
    expect(publicSourceType('github', 'self_reported')).toBeNull();
    expect(publicSourceType('resume', 'artifact')).toBeNull();
    expect(publicSourceType('chat', 'platform')).toBeNull();
    expect(publicSourceType(undefined, 'artifact')).toBeNull();
  });
});
