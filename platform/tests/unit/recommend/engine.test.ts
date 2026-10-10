import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { catalogFromFile } from '@/server/claims/catalog-file';
import { buildIndex, creditFor, parseNeeds } from '@/server/recommend/evidence';
import { computeGaps, reachFactor } from '@/server/recommend/gap-map';
import { computeCoverage, describeCoverage } from '@/server/recommend/matcher';
import { rankTasks } from '@/server/recommend/tasks';
import { decideGrade, inferSpecialization, middleSignature } from '@/server/recommend/test';

import { DEMO_COMPANIES, DEMO_TASKS, DEMO_VACANCIES } from '../../../prisma/seed/recommend';
import { fixtureCatalog } from '../../helpers/recommend-fixtures';

const catalog = fixtureCatalog();
const needs = (...p: [string, number][]) => p.map(([catalogId, weight]) => ({ catalogId, weight }));

describe('сид recommend', () => {
  it('3 компании, 8 вакансий с вилкой в ₽, 16 заданий; все ID есть в каталоге-фикстуре', () => {
    expect(DEMO_COMPANIES).toHaveLength(3);
    expect(DEMO_VACANCIES).toHaveLength(8);
    expect(DEMO_TASKS).toHaveLength(16);
    for (const v of DEMO_VACANCIES) {
      expect(v.salaryFrom).toBeGreaterThan(0);
      expect(v.salaryTo).toBeGreaterThan(v.salaryFrom);
      expect(DEMO_COMPANIES.some((c) => c.id === v.companyId)).toBe(true);
      for (const [id] of v.needs) expect(catalog.has(id)).toBe(true);
    }
    expect(new Set(DEMO_TASKS.map((t) => t.id)).size).toBe(16);
  });
});

describe('смежность', () => {
  it('рёбра из каталога двусторонние', () => {
    const file = new Map(catalogFromFile().map((e) => [e.id, e]));
    expect(file.get('be.idempotency')!.adjacent).toContain('be.message-queue');
    expect(file.get('be.message-queue')!.adjacent).toContain('be.idempotency');
    expect(file.get('fe.state-mgmt')!.adjacent).toEqual(['fe.server-state']);
    for (const e of file.values()) for (const a of e.adjacent ?? []) expect(file.get(a)?.adjacent).toContain(e.id);
    const noAdj = buildIndex([{ catalogId: 'be.message-queue', level: 'platform' }]);
    expect(creditFor('be.no-such', noAdj, catalog)).toEqual({ direct: null, adjacentVia: null, credit: 0 });
  });

  it('смежное даёт половину веса уровня и называет источник; прямое сильнее — берётся оно', () => {
    const idx = buildIndex([{ catalogId: 'be.message-queue', level: 'platform' }]);
    expect(creditFor('be.idempotency', idx, catalog)).toEqual({ direct: null, adjacentVia: 'be.message-queue', credit: 0.5 });
    const both = buildIndex([
      { catalogId: 'be.message-queue', level: 'platform' },
      { catalogId: 'be.idempotency', level: 'artifact' },
    ]);
    expect(creditFor('be.idempotency', both, catalog)).toEqual({ direct: 'artifact', adjacentVia: null, credit: 0.5 });
    const strongDirect = buildIndex([
      { catalogId: 'be.message-queue', level: 'self_reported' },
      { catalogId: 'be.idempotency', level: 'third_party' },
    ]);
    expect(creditFor('be.idempotency', strongDirect, catalog).credit).toBe(0.75);
  });

  it('несколько утверждений одного ID — берётся лучший уровень', () => {
    const idx = buildIndex([
      { catalogId: 'a', level: 'self_reported' },
      { catalogId: 'a', level: 'third_party' },
      { catalogId: 'a', level: 'artifact' },
    ]);
    expect(idx.get('a')).toBe('third_party');
  });

  it('платформа выше третьей стороны (решение 09.10)', () => {
    const idx = buildIndex([
      { catalogId: 'a', level: 'platform' },
      { catalogId: 'a', level: 'third_party' },
    ]);
    expect(idx.get('a')).toBe('platform');
  });
});

describe('gap-map', () => {
  const n = needs(['be.idempotency', 3], ['be.transactions', 3], ['be.cache', 1], ['be.authz', 2]);

  it('platform — не пробел; порядок по приоритету, ничья по ID; детерминированно', () => {
    const idx = buildIndex([
      { catalogId: 'be.transactions', level: 'platform' },
      { catalogId: 'be.cache', level: 'self_reported' },
    ]);
    const a = computeGaps(n, catalog, idx, 'junior');
    const b = computeGaps([...n].reverse(), catalog, idx, 'junior');
    expect(a).toEqual(b);
    expect(a.map((g) => g.catalogId)).toEqual(['be.idempotency', 'be.authz', 'be.cache']);
    expect(a[0]!.priority).toBe(3); // 3 × (1−0) × 1
    expect(a[2]!.priority).toBeCloseTo(0.75); // 1 × (1−0.25)
    expect(a[2]!.currentLevel).toBe('self_reported');
    expect(a[0]!.suggestedProof).toEqual(catalog.get('be.idempotency')!.proof);
  });

  it('смежность — половинный зачёт снижает приоритет, но пробел остаётся', () => {
    const idx = buildIndex([{ catalogId: 'be.message-queue', level: 'platform' }]);
    const [g] = computeGaps(needs(['be.idempotency', 2]), catalog, idx, 'junior');
    expect(g!.currentLevel).toBeNull();
    expect(g!.priority).toBe(1); // 2 × (1−0.5)
  });

  it('посильность: Middle-цель без доказанного грейда вдвое менее приоритетна', () => {
    const mid = catalog.get('be.cache')!;
    const onlyMiddle = { ...mid, grades: ['middle' as const] };
    expect(reachFactor(onlyMiddle, null)).toBe(0.5);
    expect(reachFactor(onlyMiddle, 'junior')).toBe(1);
    expect(reachFactor(mid, null)).toBe(1);
  });

  it('несуществующий catalogId не попадает в результат', () => {
    expect(computeGaps(needs(['be.ghost', 3]), catalog, new Map(), null)).toEqual([]);
  });
});

describe('matcher', () => {
  const n = needs(['be.idempotency', 3], ['be.transactions', 1], ['be.cache', 2], ['be.ghost', 3]);

  it('покрытие, k из n, смежность отдельно, ghost игнорируется', () => {
    const idx = buildIndex([
      { catalogId: 'be.transactions', level: 'platform' },
      { catalogId: 'be.message-queue', level: 'platform' },
    ]);
    const r = computeCoverage(n, catalog, idx);
    expect(r.total).toBe(3);
    expect(r.covered).toBe(1);
    expect(r.missing.map((m) => m.catalogId)).toEqual(['be.idempotency', 'be.cache']);
    expect(r.adjacent).toEqual([{ catalogId: 'be.idempotency', statement: 'Утверждение be.idempotency', via: 'be.message-queue', viaStatement: 'Утверждение be.message-queue' }]);
    // (3×0.5 + 1×1 + 0) / 6
    expect(r.score).toBeCloseTo(2.5 / 6, 5);
    const text = describeCoverage(r);
    expect(text).toMatch(/^Закрываешь 1 из 3, не хватает: /);
    expect(text).toContain('Смежное засчитано вдвое слабее');
    expect(text).not.toContain('be.ghost');
    expect(text).toContain('Утверждение be.idempotency (через «Утверждение be.message-queue»)');
    expect(text).not.toMatch(/\(через be\./);
  });

  it('объяснение содержит только ID из каталога', () => {
    const r = computeCoverage(n, catalog, new Map());
    const text = describeCoverage(r, 'candidate');
    for (const m of text.match(/\b(?:be|fe|common)\.[a-z-]+/g) ?? []) expect(catalog.has(m)).toBe(true);
    expect(text.startsWith('Закрыто 0 из 3')).toBe(true);
  });

  it('пустые needs → score 0, без деления на ноль', () => {
    expect(computeCoverage([], catalog, new Map())).toMatchObject({ score: 0, total: 0, covered: 0 });
    expect(parseNeeds('мусор')).toEqual([]);
    expect(parseNeeds([{ catalogId: 'x', weight: 'a' }, 5, null])).toEqual([{ catalogId: 'x', weight: 1 }]);
  });
});

describe('tasks', () => {
  const stm = new Map([['a', 'A'], ['b', 'B']]);
  const T = (id: string, grade: 'junior' | 'middle', catalogIds: string[]) => ({ id, title: id, family: 'f', grade, catalogIds });

  it('только задания, закрывающие запрошенные пробелы; сортировка и лимит', () => {
    const tasks = [T('t3', 'middle', ['a']), T('t1', 'junior', ['a', 'b']), T('t2', 'junior', ['z'])];
    const out = rankTasks(tasks, ['a', 'b'], 'junior', stm, 5);
    expect(out.map((t) => t.taskId)).toEqual(['t1', 't3']);
    expect(out[0]!.closes).toEqual(['a', 'b']);
    expect(out[0]!.reason).toBe('Закрывает пробелы: A; B');
    expect(rankTasks(tasks, ['a', 'b'], 'junior', stm, 1)).toHaveLength(1);
    expect(rankTasks(tasks, ['a'], 'junior', stm, 0)).toEqual([]);
  });

  it('при равенстве — ближе к «доказанный грейд + 1», затем по id; одинаковый вход → одинаковый выход', () => {
    const tasks = [T('tb', 'junior', ['a']), T('ta', 'middle', ['a']), T('tc', 'middle', ['a'])];
    const out = rankTasks(tasks, ['a'], 'junior', stm, 5);
    expect(out.map((t) => t.taskId)).toEqual(['ta', 'tc', 'tb']);
    expect(rankTasks([...tasks].reverse(), ['a'], 'junior', stm, 5)).toEqual(out);
  });
});

describe('правило теста', () => {
  const entries = [...catalog.values()];
  const sig = middleSignature(catalog, 'backend');
  const take = (share: number) => new Set(sig.slice(0, Math.round(sig.length * share)).map((e) => e.id));

  it('сигнатура: специализация + общие, Middle и вес ≥ 2', () => {
    expect(sig.every((e) => e.specialization !== 'frontend' && e.weight >= 2 && e.grades.includes('middle'))).toBe(true);
    const c2 = fixtureCatalog({ 'be.cache': { weight: 1 }, 'be.authz': { grades: ['junior'] } });
    expect(middleSignature(c2, 'backend').map((e) => e.id)).not.toContain('be.cache');
    expect(middleSignature(c2, 'backend').map((e) => e.id)).not.toContain('be.authz');
    expect(entries.length).toBeGreaterThan(sig.length);
  });

  it('сигнатура по весам J/M реального каталога: M ≥ 2 и M > J', () => {
    const real = new Map(catalogFromFile().map((e) => [e.id, e]));
    for (const spec of ['backend', 'frontend'] as const) {
      const s = middleSignature(real, spec);
      expect(s.length).toBeGreaterThan(5);
      for (const e of s) {
        const w = ('junior' in e.weights! ? e.weights! : e.weights![spec])!;
        expect(w.middle).toBeGreaterThanOrEqual(2);
        expect(w.middle!).toBeGreaterThan(w.junior ?? 0);
        expect(e.weight).toBe(w.middle);
      }
    }
    const be = middleSignature(real, 'backend').map((e) => e.id);
    expect(be).toContain('be.idempotency');
    expect(be).not.toContain('be.lang-core'); // J = M = 3 — не отличает Middle
    expect(be).not.toContain('common.git'); // M < J
  });

  it('пороги 0.25 (решение владельца 09.10, research/13) / 0.15', () => {
    expect(decideGrade(sig, take(0.7)).grade).toBe('middle');
    expect(decideGrade(sig, take(0.3)).grade).toBe('middle');
    const mid = decideGrade(sig, take(0.2));
    expect(mid.grade).toBe('junior');
    expect(mid.reason).toContain('Middle - если уверены');
    const low = decideGrade(sig, take(0.1));
    expect(low.grade).toBe('junior');
    expect(low.reason).not.toContain('если уверены');
    expect(decideGrade(sig, new Set()).reason).toContain('Для Middle не хватает заявленных');
  });

  it('точно на порогах (20 записей): 0.25 → Middle, 0.15 → «если уверены», ниже → Junior; пустая сигнатура → Junior', () => {
    const ten = 'abcdefghijklmnopqrst'.split('').map((id) => ({ ...catalog.get('be.cache')!, id, weight: 2 as const }));
    const has = (n: number) => new Set(ten.slice(0, n).map((e) => e.id));
    expect(decideGrade(ten, has(5)).grade).toBe('middle');
    expect(decideGrade(ten, has(5)).coverage).toBe(0.25);
    expect(decideGrade(ten, has(4)).grade).toBe('junior');
    const sure = decideGrade(ten, has(3));
    expect(sure.coverage).toBe(0.15);
    expect(sure.grade).toBe('junior');
    expect(sure.reason).toContain('Middle - если уверены');
    const under = decideGrade(ten, has(2));
    expect(under.grade).toBe('junior');
    expect(under.reason).not.toContain('если уверены');
    expect(decideGrade([], new Set()).grade).toBe('junior');
  });

  it('демо-кандидат Middle (eval/demo/demo-1): утверждения из резюме → Middle; без них → Junior', () => {
    const real = new Map(catalogFromFile().map((e) => [e.id, e]));
    const label = JSON.parse(readFileSync(join(__dirname, '../../../eval/demo/demo-1/label.json'), 'utf8')) as {
      claims: { catalogId: string }[];
    };
    const d = decideGrade(middleSignature(real, 'backend'), new Set(label.claims.map((c) => c.catalogId)));
    expect(d.coverage).toBeGreaterThanOrEqual(0.25);
    expect(d.grade).toBe('middle');
    expect(decideGrade(middleSignature(real, 'backend'), new Set()).grade).toBe('junior');
  });

  it('специализация по утверждениям', () => {
    expect(inferSpecialization(['be.a', 'be.b', 'fe.x'])).toBe('backend');
    expect(inferSpecialization(['fe.x'])).toBe('frontend');
    expect(inferSpecialization(['be.a', 'fe.x'])).toBeNull();
    expect(inferSpecialization([])).toBeNull();
  });
});
