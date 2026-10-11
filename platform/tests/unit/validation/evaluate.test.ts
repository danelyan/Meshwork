import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEMO_POOL } from '../../../prisma/seed/employer';
import { DEMO_VACANCIES } from '../../../prisma/seed/recommend';
import labels from '../../../eval/matching/labels.json';
import { EXTRA_PROFILES } from '../../../eval/matching/extra-profiles';
import { ndcgAtK, precisionAtK } from '../../../eval/matching/metrics';

import { POST } from '@/app/api/evaluate/route';
import { catalogFromFile } from '@/server/claims/catalog-file';
import { dropUncovered, rankCandidates, type CandidateEvidence } from '@/server/employer/ranking';
import { resetRateLimits } from '@/server/auth/rate-limit';
import { EVAL_LIMITS, EvalInputError, evaluate, reciprocalRank } from '@/server/validation/evaluate';
import { parseMatchingResults } from '@/server/validation/matching-results';
import { sampleDataset } from '@/server/validation/sample';

const vac = (id: string, needs = [{ catalogId: 'be.idempotency', weight: 3 }]) => ({ id, specialization: 'backend', grade: 'middle', needs });
const cand = (id: string, claims: { catalogId: string; level?: string }[] = [{ catalogId: 'be.idempotency', level: 'artifact' }]) => ({ id, specialization: 'backend', claims });
const small = () => ({
  vacancies: [vac('v1')],
  candidates: [cand('good'), cand('none', []), { ...cand('front'), specialization: 'frontend' }],
  relevance: { v1: { good: 2 } },
});

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(new Request('http://localhost/api/evaluate', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }));

beforeEach(() => resetRateLimits());

describe('метрики', () => {
  it('MRR: обратный ранг первого релевантного, нет — 0', () => {
    expect(reciprocalRank(['a', 'b', 'c'], { b: 1 })).toBe(0.5);
    expect(reciprocalRank(['a'], { z: 2 })).toBe(0);
  });

  it('маленький набор: релевантный первым, P@1 = nDCG@1 = MRR = 1', () => {
    const r = evaluate({ ...small(), k: 1 });
    expect(r.rows[0]!.top[0]!.candidateId).toBe('good');
    expect(r.rows[0]!.top[0]!.summary).toMatch(/Закрывает 1 из 1/);
    expect(r.mean!.ours).toEqual({ precision: 1, ndcg: 1, mrr: 1 });
    expect(r.scored).toBe(1);
  });

  it('вакансия без релевантных — предупреждение и не входит в среднее', () => {
    const r = evaluate({ ...small(), vacancies: [vac('v1'), vac('v2')] });
    expect(r.scored).toBe(1);
    expect(r.warnings.join()).toMatch(/v2/);
  });

  it('id вроде toString не находит методы Object.prototype', () => {
    const r = evaluate({ ...small(), vacancies: [vac('toString')], candidates: [cand('constructor')], relevance: { toString: { constructor: 1 } } });
    expect(r.rows[0]!.ours.ndcg).toBe(1);
  });

  // Адаптер eval/matching/run.ts повторён здесь напрямую: пример через /evaluate должен давать те же выдачу и
  // метрики, что скрипт валидации. Свежесть закоммиченного results.json этот тест не проверяет.
  it('пример даёт ту же выдачу и метрики, что адаптер eval/matching/run.ts', () => {
    const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
    const profiles = [...DEMO_POOL, ...EXTRA_PROFILES];
    const evidence: CandidateEvidence[] = profiles.map((p) => ({
      id: p.id,
      specialization: p.specialization,
      fspState: p.fspState,
      category: p.category,
      claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: catalog.get(catalogId)?.statement ?? catalogId, quote: p.stack.join(', ') })),
    }));
    const rel = (labels as unknown as { relevance: Record<string, Record<string, number>> }).relevance;
    const report = evaluate(sampleDataset());
    expect(report.rows.map((r) => r.id)).toEqual(DEMO_VACANCIES.map((v) => v.id));
    for (const v of DEMO_VACANCIES) {
      const ranked = dropUncovered(
        rankCandidates(evidence, { specialization: v.specialization, grade: v.grade, needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })), stack: [] }, catalog, { expandPool: true }),
      ).map((r) => r.candidateId);
      const row = report.rows.find((r) => r.id === v.id)!;
      expect(row.top.map((t) => t.candidateId)).toEqual(ranked.slice(0, 5));
      expect(row.ours.precision).toBeCloseTo(precisionAtK(ranked, rel[v.id] ?? {}, 5), 4);
      expect(row.ours.ndcg).toBeCloseTo(ndcgAtK(ranked, rel[v.id] ?? {}, 5), 4);
    }
  });
});

describe('схема и лимиты', () => {
  const bad = (input: unknown, re: RegExp) => {
    expect(() => evaluate(input)).toThrow(EvalInputError);
    expect(() => evaluate(input)).toThrow(re);
  };

  it('мусор и не объект', () => {
    bad(null, /JSON-объект/);
    bad([1, 2], /JSON-объект/);
    bad({ foo: 1 }, /vacancies/);
    bad({ ...small(), relevance: { v1: { good: 3 } } }, /relevance\.v1\.good/);
    bad({ ...small(), vacancies: [{ ...vac('v1'), grade: 'lead' }] }, /допустимо: junior, middle, senior/);
  });

  it('превышение лимитов по числу объектов, k и длине id', () => {
    bad({ ...small(), vacancies: Array.from({ length: EVAL_LIMITS.vacancies + 1 }, (_, i) => vac(`v${i}`)) }, /максимум 50/);
    bad({ ...small(), candidates: Array.from({ length: EVAL_LIMITS.candidates + 1 }, (_, i) => cand(`c${i}`)) }, /максимум 1000/);
    bad({ ...small(), k: 21 }, /k: больше допустимого/);
    bad({ ...small(), candidates: [cand('x'.repeat(101))] }, /candidates\.0\.id/);
  });

  it('ссылки: id каталога, дубли, разметка на чужие объекты, __proto__', () => {
    bad({ ...small(), vacancies: [vac('v1', [{ catalogId: 'nope.nothing', weight: 1 }])] }, /Нет в каталоге утверждений: nope\.nothing/);
    bad({ ...small(), candidates: [cand('a'), cand('a')] }, /a встречается дважды/);
    bad({ ...small(), relevance: { ghost: { good: 1 } } }, /вакансия ghost/);
    bad({ ...small(), relevance: { v1: { ghost: 1 } } }, /кандидат ghost/);
    bad(JSON.parse('{"vacancies":[{"id":"__proto__","specialization":"backend","grade":"middle","needs":[{"catalogId":"be.idempotency"}]}],"candidates":[{"id":"a","claims":[]}],"relevance":{}}'), /зарезервировано/);
  });
});

describe('POST /api/evaluate', () => {
  it('200 и отчёт на корректном наборе', async () => {
    const res = await post(JSON.stringify(small()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; mean: { ours: { mrr: number } } };
    expect(body.rows).toHaveLength(1);
    expect(body.mean.ours.mrr).toBe(1);
  });

  it('400 понятным текстом: не JSON и не прошла схема', async () => {
    const a = await post('{oops');
    expect(a.status).toBe(400);
    expect(((await a.json()) as { error: { message: string } }).error.message).toMatch(/не JSON/);
    const b = await post(JSON.stringify({ vacancies: [] }));
    expect(b.status).toBe(400);
    expect(((await b.json()) as { error: { message: string } }).error.message).toMatch(/Набор не прошёл проверку/);
  });

  it('413: тело больше 1 МБ (по заголовку и по факту)', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(EVAL_LIMITS.bodyBytes) });
    expect((await post(big)).status).toBe(413);
    expect((await post('{}', { 'content-length': String(EVAL_LIMITS.bodyBytes + 1) })).status).toBe(413);
  });

  it('429 после лимита частоты с одного адреса', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await post('{}', { 'x-forwarded-for': '203.0.113.7' })).status);
    expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe('results.json для /validation', () => {
  it('закоммиченный файл разбирается; новые блоки необязательны', () => {
    const file = JSON.parse(readFileSync(join(__dirname, '../../../eval/matching/results.json'), 'utf8')) as Record<string, unknown>;
    const r = parseMatchingResults(file);
    expect(r.summary.k).toBeGreaterThan(0);
    expect(r.rows.length).toBe(r.summary.vacancies);
    const withExtra = parseMatchingResults({ ...file, extended: { vacancies: 24, methods: { ours: { p5: 0.9 } }, deltaOursMinusBm25: { p5: { mean: 0.1, lo: 0.05, hi: 0.2 } } }, legacyExtended: 'мусор' });
    expect(withExtra.extended?.methods?.ours?.p5).toBe(0.9);
    expect(withExtra.legacyExtended).toBeNull();
  });

  it('без обязательных полей — ошибка', () => {
    expect(() => parseMatchingResults({ rows: [] })).toThrow();
  });
});
