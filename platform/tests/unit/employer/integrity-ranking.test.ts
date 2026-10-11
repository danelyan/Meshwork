// Вариант 2a в кабинете: пакетная загрузка индекса и снятие понижения созвоном, привязанным к попытке (integrity-ranking.ts).
import {
  loadRankingIntegrity, ownershipForAttempt, parseOwnership, rankingIntegrityOptions, reviewedAttemptId, withRankingIntegrity, type AttemptRef,
} from '@/server/employer/integrity-ranking';
import { rankCandidates, type CandidateEvidence } from '@/server/employer/ranking';

import { fixtureCatalog } from '../../helpers/recommend-fixtures';

const attemptFind = vi.fn();
const callFind = vi.fn();
vi.mock('@/server/db', () => ({
  prisma: {
    testAttempt: { findMany: (...a: unknown[]) => attemptFind(...a) },
    callSession: { findMany: (...a: unknown[]) => callFind(...a) },
  },
}));

afterEach(() => { attemptFind.mockReset(); callFind.mockReset(); });

const d = (s: string) => new Date(`2026-10-${s}Z`);
const high = { level: 'high', reasons: [{ code: 'paste', group: 'browser' }, { code: 'canary_hit', group: 'fit' }] };
const low = { level: 'low', reasons: [] };
const cat = { specialization: 'backend', grade: 'middle', subcategoryId: null } as const;
const att = (id: string, finished: string, tpl: string[]): AttemptRef => ({ id, finishedAt: d(finished), templateIds: new Set(tpl) });

describe('привязка созвона к попытке', () => {
  const a1 = att('a1', '01T10:00:00', ['t1', 't2', 't3']);
  const a2 = att('a2', '05T10:00:00', ['t3', 't4']);

  it('созвон разбирает последнюю попытку до своего начала, содержащую разобранные задания', () => {
    expect(reviewedAttemptId({ startedAt: d('03T00:00:00'), status: 'explained', templateIds: ['t1'] }, [a1, a2])).toBe('a1');
    expect(reviewedAttemptId({ startedAt: d('06T00:00:00'), status: 'explained', templateIds: ['t3'] }, [a1, a2])).toBe('a2');
    expect(reviewedAttemptId({ startedAt: d('06T00:00:00'), status: 'explained', templateIds: ['t1'] }, [a1, a2])).toBe('a1');
  });

  it('созвон до попытки, без разбора или с чужими заданиями — ни к какой попытке', () => {
    expect(reviewedAttemptId({ startedAt: d('04T00:00:00'), status: 'explained', templateIds: ['t4'] }, [a1, a2])).toBeNull();
    expect(reviewedAttemptId({ startedAt: d('06T00:00:00'), status: 'explained', templateIds: [] }, [a1, a2])).toBeNull();
    expect(reviewedAttemptId({ startedAt: d('06T00:00:00'), status: 'explained', templateIds: ['t9'] }, [a1, a2])).toBeNull();
  });

  it('итог — последний созвон по этой попытке; созвон по другой попытке не считается', () => {
    const calls = [
      { startedAt: d('02T00:00:00'), status: 'failed' as const, templateIds: ['t1'] },
      { startedAt: d('03T00:00:00'), status: 'explained' as const, templateIds: ['t2'] },
      { startedAt: d('06T00:00:00'), status: 'explained' as const, templateIds: ['t4'] },
    ];
    expect(ownershipForAttempt('a1', calls, [a1, a2])).toBe('explained');
    expect(ownershipForAttempt('a1', calls.slice(0, 1), [a1, a2])).toBe('failed');
    expect(ownershipForAttempt('a1', [calls[2]!], [a1, a2])).toBeNull();
  });

  it('parseOwnership: статус и шаблоны из сырого вердикта, мусор — null', () => {
    expect(parseOwnership({ depthMap: [], testOwnership: { status: 'partial', reason: 'x', items: [{ templateId: 't1', title: 'A', correct: true }] } })).toEqual({ status: 'partial', templateIds: ['t1'] });
    expect(parseOwnership({ depthMap: [] })).toBeNull();
    expect(parseOwnership({ testOwnership: { status: 'weird' } })).toBeNull();
    expect(parseOwnership(null)).toBeNull();
  });
});

describe('loadRankingIntegrity: пакетно по пулу', () => {
  const graded = (id: string, candidateId: string, integrity: unknown) => ({ id, candidateId, ...cat, kind: 'grade', confirmsAttemptId: null, integrity });

  function mockDb(calls: { candidateId: string; startedAt: Date; verdictJson: unknown }[]) {
    attemptFind.mockImplementation((args: { where: { status?: unknown; id?: unknown } }) => {
      if (args.where.status === 'passed') return Promise.resolve([graded('a-ok', 'ok', low), graded('a-x', 'x', high), graded('a-y', 'y', high), graded('a-z', 'z', high)]);
      return Promise.resolve([
        { id: 'a-x', candidateId: 'x', finishedAt: d('01T10:00:00'), items: [{ templateId: 't1' }, { templateId: 't2' }] },
        { id: 'a-y', candidateId: 'y', finishedAt: d('01T10:00:00'), items: [{ templateId: 't1' }] },
        { id: 'a-z', candidateId: 'z', finishedAt: d('01T10:00:00'), items: [{ templateId: 't1' }] },
        { id: 'a-z2', candidateId: 'z', finishedAt: d('02T10:00:00'), items: [{ templateId: 't7' }] },
      ]);
    });
    callFind.mockResolvedValue(calls);
  }

  it('три запроса на весь пул (без N+1); explained по этой попытке снимает понижение, partial/failed/чужая попытка — нет', async () => {
    mockDb([
      { candidateId: 'x', startedAt: d('03T00:00:00'), verdictJson: { testOwnership: { status: 'explained', items: [{ templateId: 't2' }] } } },
      { candidateId: 'y', startedAt: d('03T00:00:00'), verdictJson: { testOwnership: { status: 'partial', items: [{ templateId: 't1' }] } } },
      // z объяснил задания другой (более поздней, не давшей категорию) попытки
      { candidateId: 'z', startedAt: d('03T00:00:00'), verdictJson: { testOwnership: { status: 'explained', items: [{ templateId: 't7' }] } } },
    ]);
    const m = await loadRankingIntegrity(new Map([['ok', cat], ['x', cat], ['y', cat], ['z', cat], ['nocat', null]]));
    expect(attemptFind).toHaveBeenCalledTimes(2);
    expect(callFind).toHaveBeenCalledTimes(1);
    const callWhere = callFind.mock.calls[0]![0].where;
    expect(callWhere.candidateId.in.sort()).toEqual(['x', 'y', 'z']);
    expect(m.get('ok')).toEqual({ level: 'low', confirmedAgain: false });
    expect(m.get('x')).toEqual({ level: 'high', confirmedAgain: false, ownershipExplained: true });
    expect(m.get('y')?.ownershipExplained).toBeUndefined();
    expect(m.get('z')?.ownershipExplained).toBeUndefined();
    expect(m.has('nocat')).toBe(false);
  });

  it('нет high — созвоны и задания не запрашиваются', async () => {
    attemptFind.mockResolvedValue([graded('a-ok', 'ok', low)]);
    await loadRankingIntegrity(new Map([['ok', cat]]));
    expect(attemptFind).toHaveBeenCalledTimes(1);
    expect(callFind).not.toHaveBeenCalled();
  });

  it('в ранжировании: снятый созвоном high сохраняет категорию, оставшийся — нет; выключатель возвращает прежний порядок', async () => {
    mockDb([{ candidateId: 'x', startedAt: d('03T00:00:00'), verdictJson: { testOwnership: { status: 'explained', items: [{ templateId: 't1' }] } } }]);
    const catalog = fixtureCatalog();
    const pool: CandidateEvidence[] = ['x', 'y'].map((id) => ({
      id, specialization: 'backend', fspState: 'not_linked', category: { specialization: 'backend', grade: 'middle' },
      claims: [{ catalogId: 'be.idempotency', level: 'self_reported', statement: 's', quote: '' }],
    }));
    const ev = withRankingIntegrity(pool, await loadRankingIntegrity(new Map(pool.map((c) => [c.id, c.category]))));
    const target = { specialization: 'backend' as const, grade: 'middle' as const, needs: [{ catalogId: 'be.idempotency', weight: 3 }, { catalogId: 'be.transactions', weight: 3 }], stack: [] };
    const on = rankCandidates(ev, target, catalog, {}, rankingIntegrityOptions(true));
    expect(on.map((r) => [r.candidateId, r.categoryMatch])).toEqual([['x', true], ['y', false]]);
    const off = rankCandidates(ev, target, catalog, {}, rankingIntegrityOptions(false));
    expect(off.map((r) => r.categoryMatch)).toEqual([true, true]);
  });
});
