// Генераторы направления engineering (ADR-0003, дополнение 10.10): 300 seed на семейство,
// детерминизм, ключ принимается проверкой, и для семейств с вычисляемым ответом — независимое
// решение по тексту условия (как schema-constraint.test.ts): ключ должен совпасть с ним.
import { catalogFromFile } from '@/server/claims/catalog-file';
import { checkAnswer, normalizeAnswer } from '@/server/test/answers';
import { GENERATORS, generatorsFor } from '@/server/test/generators';
import {
  boundaryValues,
  branchCoverage,
  burnRate,
  ciStages,
  circuitBreaker,
  joinFanout,
  latencyPercentile,
  littlesLaw,
  logCount,
  mockCalls,
  nullAggregates,
  parametrizeCount,
  portMapping,
  rollingUpdate,
  scd2AsOf,
  dedupCount,
  deployRollback,
  dockerCache,
  ENGINEERING_GENERATORS,
  errorBudget,
  fixtureIsolation,
  flakyLine,
  idempotentLoad,
  incrementalWatermark,
  k8sCapacity,
  k8sProbes,
  partitionPrune,
  retryAmplification,
  schemaTypes,
  secretsLeak,
} from '@/server/test/generators/engineering';
import { deriveSeed } from '@/server/test/rng';

const SEEDS = Array.from({ length: 300 }, (_, i) => deriveSeed(20261010, i));

/** Подкатегория → 4 Junior + 4 Middle семейства (ADR-0003, дополнение 10.10 15:50). */
const BY_SUB: Record<string, { junior: string[]; middle: string[] }> = {
  'engineering.data-eng': {
    junior: ['dedup-count', 'schema-types', 'null-aggregates', 'join-fanout'],
    middle: ['idempotent-load', 'incremental-watermark', 'partition-prune', 'scd2-as-of'],
  },
  'engineering.devops': {
    junior: ['docker-cache', 'secrets-leak', 'port-mapping', 'ci-stages'],
    middle: ['k8s-probes', 'k8s-capacity', 'deploy-rollback', 'rolling-update'],
  },
  'engineering.qa-automation': {
    junior: ['test-pyramid', 'fixture-isolation', 'boundary-values', 'parametrize-count'],
    middle: ['flaky-line', 'contract-test', 'mock-calls', 'branch-coverage'],
  },
  'engineering.sre': {
    junior: ['error-budget', 'symptom-alert', 'latency-percentile', 'log-count'],
    middle: ['retry-amplification', 'burn-rate', 'littles-law', 'circuit-breaker'],
  },
};
const EXPECTED_IDS = Object.values(BY_SUB).flatMap((x) => [...x.junior, ...x.middle].map((id) => `eng.${id}`));

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** Строки таблицы, нарисованной table(): после имени, шапки и разделителя. */
function tableRows(code: string, name: string): string[][] {
  const lines = code.split('\n');
  const start = lines.indexOf(name);
  const out: string[][] = [];
  for (let i = start + 3; i < lines.length && lines[i]!.includes('|'); i++) out.push(lines[i]!.split('|').map((c) => c.trim()));
  return out;
}

describe('банк engineering', () => {
  it('32 семейства eng.*, зарегистрированы; на каждую из 4 подкатегорий — 4 Junior + 4 Middle (минимум 8)', () => {
    expect(ENGINEERING_GENERATORS.map((g) => g.id).sort()).toEqual([...EXPECTED_IDS].sort());
    expect(generatorsFor('engineering').map((g) => g.id).sort()).toEqual([...EXPECTED_IDS].sort());
    for (const [sub, { junior, middle }] of Object.entries(BY_SUB)) {
      const own = ENGINEERING_GENERATORS.filter((g) => g.subcategoryId === sub);
      expect(own.filter((g) => g.grade === 'junior').map((g) => g.id).sort(), sub).toEqual(junior.map((id) => `eng.${id}`).sort());
      expect(own.filter((g) => g.grade === 'middle').map((g) => g.id).sort(), sub).toEqual(middle.map((id) => `eng.${id}`).sort());
      expect(own.length).toBeGreaterThanOrEqual(8);
    }
    for (const g of ENGINEERING_GENERATORS) expect(Object.keys(BY_SUB), g.id).toContain(g.subcategoryId);
    expect(new Set(GENERATORS.map((g) => g.id)).size).toBe(GENERATORS.length);
    // taskId engineering не пересекаются ни между собой, ни с backend/frontend (там общие taskId допустимы).
    const others = new Set(GENERATORS.filter((g) => g.specialization !== 'engineering').map((g) => g.taskId));
    const engTasks = ENGINEERING_GENERATORS.map((g) => g.taskId);
    expect(new Set(engTasks).size).toBe(engTasks.length);
    for (const t of engTasks) expect(others.has(t), t).toBe(false);
  });

  it('a/b: Junior-задания легче порога Junior−Middle, Middle — тяжелее (как в backend/frontend)', () => {
    for (const g of ENGINEERING_GENERATORS) {
      expect(g.a, g.id).toBeGreaterThanOrEqual(0.8);
      expect(g.a, g.id).toBeLessThanOrEqual(1.6);
      if (g.grade === 'junior') expect(g.b, g.id).toBeLessThan(-0.1);
      else expect(g.b, g.id).toBeGreaterThan(-0.1);
    }
  });

  it('каталог: каждое catalogId генератора — запись eng.*, и task:<id> генератора указан в её proof', () => {
    const cat = new Map(catalogFromFile().map((c) => [c.id, c]));
    for (const g of ENGINEERING_GENERATORS) {
      for (const id of g.catalogIds) {
        expect(id.startsWith('eng.'), `${g.id} → ${id}`).toBe(true);
        const entry = cat.get(id);
        expect(entry, `${g.id} → ${id}`).toBeDefined();
        expect(entry!.specialization).toBe('engineering');
      }
      expect(
        g.catalogIds.some((id) => cat.get(id)!.proof.includes(g.taskId)),
        `${g.taskId} не указан в proof ни одной своей записи`,
      ).toBe(true);
    }
    // Обратная сторона: каждый task:* в proof eng.* ведёт на существующий генератор.
    const taskIds = new Set(GENERATORS.map((g) => g.taskId));
    for (const c of cat.values())
      if (c.specialization === 'engineering') for (const p of c.proof) if (p.startsWith('task:')) expect(taskIds.has(p), `${c.id}: ${p}`).toBe(true);
  });
});

for (const g of ENGINEERING_GENERATORS) {
  describe(g.id, () => {
    it('300 seed: без исключений, детерминизм, ключ принимается проверкой, варианты различаются', () => {
      const prompts = new Set<string>();
      const keys = new Set<string>();
      for (const seed of SEEDS) {
        const inst = g.generate(seed);
        expect(g.generate(seed)).toEqual(inst);
        expect(inst.prompt.length).toBeGreaterThan(20);
        expect(inst.explanation.length).toBeGreaterThan(10);
        for (const k of inst.answerKey.split('|')) {
          expect(normalizeAnswer(g.format, k), `${seed}: ${k}`).not.toBeNull();
          expect(checkAnswer(g.format, k, inst.answerKey)).toBe(true);
        }
        if (g.format === 'line') {
          const n = Number(inst.answerKey);
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(inst.code!.split('\n').length);
        }
        if (g.format === 'number') expect(Number.isFinite(Number(inst.answerKey)), `${seed}`).toBe(true);
        // Ответ не утекает в условие дословно (для list/line он неочевиден по тексту, для number — число не в prompt).
        if (g.format === 'number' && inst.answerKey.length >= 3) expect(inst.prompt.includes(inst.answerKey), `${g.id} ${seed}`).toBe(false);
        prompts.add(`${inst.prompt}\n${inst.code ?? ''}`);
        keys.add(inst.answerKey);
      }
      expect(prompts.size).toBeGreaterThanOrEqual(50);
      expect(keys.size).toBeGreaterThanOrEqual(3);
    });
  });
}

describe('независимые решения по тексту условия (300 seed)', () => {
  it('eng.dedup-count', () => {
    for (const seed of SEEDS) {
      const t = dedupCount.generate(seed);
      const table = t.code!.split('\n')[0]!;
      const rows = tableRows(t.code!, table).map(([id, , amount, loaded]) => ({ id: id!, amount: Number(amount), loaded: toMin(loaded!) }));
      let expected: number;
      if (t.code!.includes('COUNT(DISTINCT')) expected = new Set(rows.map((r) => r.id)).size;
      else if (t.code!.includes('DISTINCT *')) expected = new Set(rows.map((r) => JSON.stringify(r))).size;
      else {
        const last = new Map<string, { amount: number; loaded: number }>();
        for (const r of rows) if (!last.has(r.id) || last.get(r.id)!.loaded < r.loaded) last.set(r.id, r);
        expected = [...last.values()].reduce((s, r) => s + r.amount, 0);
      }
      expect(t.answerKey, `seed ${seed}`).toBe(String(expected));
    }
  });

  it('eng.schema-types: отклонённые строки = невалидные значения типов PostgreSQL', () => {
    const isInt = (v: string) => v === '' || /^-?\d+$/.test(v);
    const isNum = (v: string) => v === '' || /^-?\d+(\.\d+)?$/.test(v);
    const isDate = (v: string) => {
      if (v === '') return true;
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      if (!m) return false;
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
    };
    for (const seed of SEEDS) {
      const t = schemaTypes.generate(seed);
      const csv = t.code!.split('\n\n')[1]!.split('\n').slice(1);
      const bad = csv.flatMap((line, i) => {
        const [id, day, qty, price] = line.split(',');
        expect(line.split(',')).toHaveLength(4);
        const ok = id !== '' && isInt(id!) && isDate(day!) && isInt(qty!) && isNum(price!);
        return ok ? [] : [i + 1];
      });
      expect(bad.length).toBeGreaterThan(0);
      expect(bad.length).toBeLessThan(csv.length);
      expect(t.answerKey, `seed ${seed}`).toBe(bad.join(','));
    }
  });

  it('eng.docker-cache: первая строка COPY, которая копирует изменённый файл', () => {
    for (const seed of SEEDS) {
      const t = dockerCache.generate(seed);
      const file = /изменил только файл (\S+)/.exec(t.prompt)![1]!;
      const lines = t.code!.split('\n');
      const idx = lines.findIndex((l) => l.startsWith('COPY') && (l.includes(' . .') || l.split(' ').slice(1, -1).includes(file)));
      expect(t.answerKey, `seed ${seed}`).toBe(String(idx + 1));
    }
  });

  it('eng.secrets-leak: ровно одна строка с литералом секрета, и это ключ', () => {
    const leak = /(postgres:\/\/[^$"]*:[^$@"]+@)|(COPY \.env)|(sk_live_)|(JWT_SECRET=[^$])|(Bearer [^$])/;
    for (const seed of SEEDS) {
      const t = secretsLeak.generate(seed);
      const hits = t.code!.split('\n').flatMap((l, i) => (leak.test(l) ? [i + 1] : []));
      expect(hits, `seed ${seed}`).toEqual([Number(t.answerKey)]);
    }
  });

  it('eng.fixture-isolation: исполнение семантики pytest по коду', () => {
    for (const seed of SEEDS) {
      const t = fixtureIsolation.generate(seed);
      const code = t.code!;
      const shared = code.includes('return SHARED') || (code.includes('scope="module"') && !code.includes('yield'));
      let list: string[] = [];
      let printed: number | null = null;
      for (const block of code.split('\ndef test_').slice(1)) {
        if (!shared) list = [];
        for (const l of block.split('\n')) {
          if (l.includes('.append(')) list.push(l);
          if (l.includes('print(len(')) printed = list.length;
        }
      }
      expect(t.answerKey, `seed ${seed}`).toBe(String(printed));
    }
  });

  it('eng.error-budget: пересчёт по таймлайну', () => {
    for (const seed of SEEDS) {
      const t = errorBudget.generate(seed);
      const code = t.code!;
      const pct = Number(/SLO доступности \S+: ([\d,]+) %/.exec(code)![1]!.replace(',', '.'));
      const days = Number(/окне (\d+) дней/.exec(code)![1]);
      const times = [...code.matchAll(/^ {2}(\d\d:\d\d) {2}/gm)].map((m) => toMin(m[1]!));
      const incs = [];
      for (let i = 0; i < times.length; i += 4) incs.push({ start: times[i]!, detect: times[i + 1]!, mitigate: times[i + 2]! });
      let expected: number;
      if (t.prompt.includes('останется')) {
        const budget = (days * 24 * 60 * (100 - pct)) / 100;
        expected = budget - incs.reduce((s, x) => s + x.mitigate - x.start, 0);
      } else {
        const k = Number(/инцидента №(\d)|инциденте №(\d)/.exec(t.prompt)!.slice(1).find(Boolean));
        const x = incs[k - 1]!;
        expected = t.prompt.includes('TTD') ? x.detect - x.start : x.mitigate - x.start;
      }
      expect(Number(t.answerKey), `seed ${seed}`).toBeCloseTo(expected, 6);
    }
  });

  it('eng.idempotent-load: прогон журнала по стратегии', () => {
    for (const seed of SEEDS) {
      const t = idempotentLoad.generate(seed);
      const code = t.code!;
      const strategy = code.includes('DELETE FROM') ? 'replace' : code.includes('ON CONFLICT') ? 'upsert' : 'append';
      // Файлы восстанавливаются из журнала: размер, убранный и добавленные ключи.
      const log = code.split('Журнал запусков:\n')[1]!.split('\n');
      const first = /\.csv \(строк: (\d+)\)/.exec(log[0]!)!;
      const n1 = Number(first[1]);
      const removed = Number(/убран \S+ (\d+)/.exec(log[3]!)![1]);
      const added = /добавлены ([\d, ]+)\)/.exec(log[3]!)![1]!.split(',').map((s) => Number(s.trim()));
      const base1 = removed - (removed % 100);
      const f1v1 = Array.from({ length: n1 }, (_, i) => base1 + i);
      const f1v2 = [...f1v1.filter((x) => x !== removed), ...added];
      const n2 = Number(/\.csv \(строк: (\d+)\)/.exec(log[1]!)![1]);
      const f2 = Array.from({ length: n2 }, (_, i) => base1 + 50 + i);
      const failAfter = Number(/обработано строк: (\d+)/.exec(log[1]!)![1]);
      const runs = [
        { d: 1, file: f1v1, fail: null as number | null },
        { d: 2, file: f2, fail: failAfter },
        { d: 2, file: f2, fail: null },
        { d: 1, file: f1v2, fail: null },
      ];
      let rows: { id: number; d: number }[] = [];
      for (const r of runs) {
        const part = r.file.slice(0, r.fail ?? r.file.length);
        if (strategy === 'append') rows.push(...part.map((id) => ({ id, d: r.d })));
        else if (strategy === 'replace') {
          if (r.fail === null) rows = rows.filter((x) => x.d !== r.d).concat(r.file.map((id) => ({ id, d: r.d })));
        } else for (const id of part) if (!rows.some((x) => x.id === id)) rows.push({ id, d: r.d });
      }
      expect(t.answerKey, `seed ${seed}`).toBe(String(rows.length));
    }
  });

  it('eng.incremental-watermark: пошаговая симуляция запусков', () => {
    for (const seed of SEEDS) {
      const t = incrementalWatermark.generate(seed);
      const code = t.code!;
      const tableName = code.split('\n')[0]!;
      const rows = tableRows(code, tableName).map(([id, upd, commit]) => ({ id: id!, upd: toMin(upd!), commit: toMin(commit!) }));
      const runs = /запуски в ([\d:, ]+);/.exec(code)![1]!.split(',').map((s) => toMin(s.trim()));
      let wm = toMin(/начальный :wm = (\d\d:\d\d)/.exec(code)![1]!);
      const ge = code.includes('updated_at >= :wm');
      const byNow = code.includes('время запуска');
      const out: string[] = [];
      for (const r of runs) {
        const batch = rows.filter((x) => x.commit <= r && (ge ? x.upd >= wm : x.upd > wm));
        out.push(...batch.map((x) => x.id));
        if (byNow) wm = r;
        else if (batch.length) wm = Math.max(...batch.map((x) => x.upd));
      }
      const expected = t.prompt.includes('так и не попадут') ? rows.filter((x) => !out.includes(x.id)).length : out.length;
      expect(t.answerKey, `seed ${seed}`).toBe(String(expected));
    }
  });

  it('eng.partition-prune: пересечение условия с границами секций', () => {
    for (const seed of SEEDS) {
      const t = partitionPrune.generate(seed);
      const parts = [...t.code!.matchAll(/CREATE TABLE (p\d{4}_\d\d) PARTITION OF \S+ FOR VALUES FROM \('([\d-]+)'\) TO \('([\d-]+)'\)/g)].map((m) => ({
        name: m[1]!,
        from: Date.parse(m[2]!),
        to: Date.parse(m[3]!),
      }));
      const where = /WHERE (.+)\? Перечислите/.exec(t.prompt)![1]!;
      let lo = -Infinity;
      let hi = Infinity; // полуинтервал [lo, hi) или отрезок с hiIncl
      let hiIncl = false;
      let loExcl = false;
      let pruneable = true;
      const ge = /created_at >= '([\d-]+)'/.exec(where);
      const lt = /created_at < '([\d-]+)'/.exec(where);
      const btw = /created_at BETWEEN '([\d-]+)' AND '([\d-]+)'/.exec(where);
      const gt = /created_at > '([\d-]+)'/.exec(where);
      if (ge) lo = Date.parse(ge[1]!);
      if (lt) hi = Date.parse(lt[1]!);
      if (btw) [lo, hi, hiIncl] = [Date.parse(btw[1]!), Date.parse(btw[2]!), true];
      if (gt) [lo, loExcl] = [Date.parse(gt[1]!), true];
      if (!ge && !lt && !btw && !gt) pruneable = false; // условие не на сам ключ (выражение от ключа или другая колонка)
      const hit = parts.filter((p) => {
        if (!pruneable) return true;
        const startsBeforeHi = hiIncl ? p.from <= hi : p.from < hi;
        const endsAfterLo = loExcl ? p.to - 1 > lo : p.to > lo;
        return startsBeforeHi && endsAfterLo;
      });
      expect(t.answerKey, `seed ${seed}: ${where}`).toBe(hit.map((p) => p.name).sort().join(','));
    }
  });

  it('eng.k8s-capacity и eng.k8s-probes: сумма requests и пошаговая симуляция проб', () => {
    for (const seed of SEEDS) {
      const t = k8sCapacity.generate(seed);
      const code = t.code!;
      {
        const [allocCpu, allocMem] = /allocatable cpu (\d+)m, memory (\d+)Mi/.exec(code)!.slice(1).map(Number);
        const [usedCpu, usedMem] = /requests cpu (\d+)m, memory (\d+)Mi;/.exec(code)!.slice(1).map(Number);
        const [reqCpu, reqMem] = /requests: \{ cpu: (\d+)m, memory: (\d+)Mi \}/.exec(code)!.slice(1).map(Number);
        let n = 0;
        while ((n + 1) * reqCpu! <= allocCpu! - usedCpu! && (n + 1) * reqMem! <= allocMem! - usedMem!) n++;
        expect(t.answerKey, `seed ${seed}`).toBe(String(n));
      }
    }
    for (const seed of SEEDS) {
      const t = k8sProbes.generate(seed);
      const code = t.code!;
      const hang = Number(/в t = (\d+) с завис/.exec(t.prompt)![1]);
      const probe = (name: string) => {
        const block = code.split(`${name}:`)[1]!;
        const num = (k: string) => Number(new RegExp(`${k}: (\\d+)`).exec(block)![1]);
        return { delay: num('initialDelaySeconds'), period: num('periodSeconds'), fail: num('failureThreshold') };
      };
      const fire = (p: { delay: number; period: number; fail: number }) => {
        let streak = 0;
        for (let s = p.delay; ; s += p.period) {
          streak = s >= hang ? streak + 1 : 0;
          if (streak === p.fail) return s;
        }
      };
      const live = fire(probe('livenessProbe'));
      const ready = fire(probe('readinessProbe'));
      if (t.prompt.includes('перезапустит')) expect(t.answerKey, `seed ${seed}`).toBe(String(live));
      else {
        expect(ready).toBeLessThanOrEqual(live);
        expect(t.answerKey, `seed ${seed}`).toBe(String(ready));
      }
    }
  });

  it('eng.deploy-rollback: модель ревизий Deployment по командам', () => {
    for (const seed of SEEDS) {
      const t = deployRollback.generate(seed);
      const revs = new Map<number, string>();
      let next = 1;
      for (const l of t.code!.split('\n')) {
        const img = /--image=\S+:(\S+)$|app=\S+:(\S+)$/.exec(l);
        if (img) revs.set(next++, (img[1] ?? img[2])!);
        const undo = /rollout undo deployment\/\S+(?: --to-revision=(\d+))?$/.exec(l);
        if (undo) {
          const nums = [...revs.keys()].sort((a, b) => a - b);
          const target = undo[1] ? Number(undo[1]) : nums[nums.length - 2]!;
          expect(target).not.toBe(nums[nums.length - 1]);
          const tag = revs.get(target)!;
          revs.delete(target);
          revs.set(next++, tag);
        }
      }
      const cur = revs.get(Math.max(...revs.keys()))!;
      expect(t.answerKey.split('|')[0], `seed ${seed}`).toBe(cur);
      expect(checkAnswer('text', ` «${cur}» `, t.answerKey)).toBe(true);
    }
  });

  it('eng.flaky-line: ровно одна строка с недетерминизмом, и это ключ', () => {
    const flaky = /Math\.random|sleep\(\d+\)|new Date\(\)|WHERE \w+_id = \$1'/;
    for (const seed of SEEDS) {
      const t = flakyLine.generate(seed);
      const hits = t.code!.split('\n').flatMap((l, i) => (flaky.test(l) ? [i + 1] : []));
      expect(hits, `seed ${seed}`).toEqual([Number(t.answerKey)]);
    }
  });

  it('eng.retry-amplification: произведение попыток по цепочке', () => {
    for (const seed of SEEDS) {
      const t = retryAmplification.generate(seed);
      const attempts = [...t.code!.matchAll(/до (\d+) попыт/g)].map((m) => Number(m[1]));
      let reach = 1;
      let total = 0;
      for (const a of attempts) {
        reach *= a;
        total += reach;
      }
      expect(t.answerKey, `seed ${seed}`).toBe(String(t.prompt.includes('PostgreSQL из-за') ? reach : total));
      expect(attempts.filter((a) => a > 1).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('независимые решения: семейства добора до 8 на подкатегорию (300 seed)', () => {
  it('eng.null-aggregates: семантика NULL в SQL', () => {
    for (const seed of SEEDS) {
      const t = nullAggregates.generate(seed);
      const tableName = t.code!.split('\n')[0]!;
      const vals = tableRows(t.code!, tableName).map((r) => (r[2] === 'NULL' ? null : Number(r[2])));
      const nn = vals.filter((v): v is number => v !== null);
      const sql = t.code!.split('\n').at(-1)!;
      let expected: number;
      if (sql.includes('COUNT(DISTINCT')) expected = new Set(nn).size;
      else if (sql.includes('COUNT(bonus)')) expected = nn.length;
      else if (sql.includes('AVG')) expected = nn.reduce((a, b) => a + b, 0) / nn.length;
      else {
        const pivot = Number(/bonus <> (\d+)/.exec(sql)![1]);
        expected = nn.filter((v) => v !== pivot).length;
      }
      expect(Number(t.answerKey), `seed ${seed}`).toBe(expected);
      expect(Number.isInteger(expected)).toBe(true);
    }
  });

  it('eng.join-fanout: исполнение JOIN по таблицам', () => {
    for (const seed of SEEDS) {
      const t = joinFanout.generate(seed);
      const dim = tableRows(t.code!, 'customers').map((r) => Number(r[0]));
      const orders = tableRows(t.code!, 'orders').map((r) => ({ cust: Number(r[1]), amount: Number(r[2]) }));
      const left = t.code!.includes('LEFT JOIN');
      const joined = orders.flatMap((o) => {
        const m = dim.filter((d) => d === o.cust).length;
        return Array.from({ length: m || (left ? 1 : 0) }, () => o);
      });
      const expected = t.code!.includes('SUM(') ? joined.reduce((a, o) => a + o.amount, 0) : joined.length;
      expect(t.answerKey, `seed ${seed}`).toBe(String(expected));
    }
  });

  it('eng.scd2-as-of: соединение по дате с интервалом [valid_from; valid_to)', () => {
    for (const seed of SEEDS) {
      const t = scd2AsOf.generate(seed);
      const vers = tableRows(t.code!, 'dim_customer').map((r) => ({ city: r[2]!, from: r[3]!, to: r[4] === 'NULL' ? null : r[4]! }));
      const orders = tableRows(t.code!, 'orders').map((r) => ({ d: r[2]!, amount: Number(r[3]) }));
      const target = /к городу «([^»]+)»/.exec(t.prompt)![1]!;
      const sum = orders
        .filter((o) => {
          const v = vers.filter((x) => x.from <= o.d && (x.to === null || o.d < x.to));
          expect(v).toHaveLength(1);
          return v[0]!.city === target;
        })
        .reduce((a, o) => a + o.amount, 0);
      expect(sum).toBeGreaterThan(0);
      expect(t.answerKey, `seed ${seed}`).toBe(String(sum));
    }
  });

  it('eng.port-mapping: хост — левая часть ports, сеть compose — порт контейнера', () => {
    for (const seed of SEEDS) {
      const t = portMapping.generate(seed);
      const ports = [...t.code!.matchAll(/"(\d+):(\d+)"/g)].map((m) => ({ host: Number(m[1]), cont: Number(m[2]) }));
      const [web, api] = ports as [{ host: number; cont: number }, { host: number; cont: number }];
      let expected: number;
      if (t.prompt.includes('открывает фронтенд')) expected = web.host;
      else if (t.prompt.includes('http://api:')) expected = api.cont;
      else if (t.prompt.includes('curl')) expected = api.host;
      else expected = 5432;
      expect(t.answerKey, `seed ${seed}`).toBe(String(expected));
    }
  });

  it('eng.ci-stages: правила when/allow_failure GitLab по YAML', () => {
    for (const seed of SEEDS) {
      const t = ciStages.generate(seed);
      const failing = /Задача (\S+) упала/.exec(t.prompt)![1]!;
      const jobs = t.code!
        .split('\n\n')[1]!
        .split(/\n(?=\S)/)
        .map((block) => ({
          name: block.split(':')[0]!,
          stage: /stage: (\w+)/.exec(block)![1]!,
          allow: block.includes('allow_failure: true'),
          when: /when: (\w+)/.exec(block)?.[1] ?? 'on_success',
        }));
      const ran: string[] = [];
      let bad = false;
      for (const st of ['build', 'test', 'deploy']) {
        let badHere = false;
        for (const j of jobs.filter((x) => x.stage === st)) {
          if (!(j.when === 'always' || (j.when === 'on_failure' ? bad : !bad))) continue;
          ran.push(j.name);
          if (j.name === failing && !j.allow) badHere = true;
        }
        bad ||= badHere;
      }
      expect(jobs).toHaveLength(7);
      expect(t.answerKey, `seed ${seed}`).toBe(ran.filter((n) => n !== failing).sort().join(','));
    }
  });

  it('eng.rolling-update: maxSurge вверх, maxUnavailable вниз', () => {
    for (const seed of SEEDS) {
      const t = rollingUpdate.generate(seed);
      const replicas = Number(/replicas: (\d+)/.exec(t.code!)![1]);
      const parse = (k: string, up: boolean) => {
        const v = new RegExp(`${k}: (\\d+)(%?)`).exec(t.code!)!;
        if (!v[2]) return Number(v[1]);
        const raw = (replicas * Number(v[1])) / 100;
        return up ? Math.ceil(raw) : Math.floor(raw);
      };
      const s = parse('maxSurge', true);
      const u = parse('maxUnavailable', false);
      expect(s + u).toBeGreaterThan(0);
      expect(t.answerKey, `seed ${seed}`).toBe(String(t.prompt.includes('наибольшее') ? replicas + s : replicas - u));
    }
  });

  it('eng.boundary-values: отклоняются значения вне диапазона требования', () => {
    for (const seed of SEEDS) {
      const t = boundaryValues.generate(seed);
      const m = /(не меньше|больше) (\d+) и (не больше|меньше) (\d+)/.exec(t.prompt)!;
      const lo = Number(m[2]);
      const hi = Number(m[4]);
      const ok = (v: number) => (m[1] === 'не меньше' ? v >= lo : v > lo) && (m[3] === 'не больше' ? v <= hi : v < hi);
      const vals = t.code!.split('\n').map((l) => Number(l.split('. ')[1]));
      const rejected = vals.flatMap((v, i) => (ok(v) ? [] : [i + 1]));
      expect(rejected.length).toBeGreaterThan(0);
      expect(rejected.length).toBeLessThan(vals.length);
      expect(t.answerKey, `seed ${seed}`).toBe(rejected.join(','));
    }
  });

  it('eng.parametrize-count: декартово произведение минус пропущенные', () => {
    for (const seed of SEEDS) {
      const t = parametrizeCount.generate(seed);
      const lists = [...t.code!.matchAll(/parametrize\("\w+", \[(.*)\]\)/g)].map((m) => m[1]!.split(/,(?![^(]*\))/).map((x) => x.trim()));
      let combos: string[][] = [[]];
      for (const l of lists) combos = combos.flatMap((c) => l.map((v) => [...c, v]));
      const run = combos.filter((c) => !c.some((v) => v.includes('mark.skip')));
      expect(t.answerKey, `seed ${seed}`).toBe(String(run.length));
    }
  });

  it('eng.mock-calls: прогон цикла ретраев по side_effect', () => {
    for (const seed of SEEDS) {
      const t = mockCalls.generate(seed);
      const attempts = Number(/attempts=(\d+)/.exec(t.code!)![1]);
      const effects = /side_effect = \[(.*)\]/.exec(t.code!)![1]!.split(', ');
      let calls = 0;
      for (let i = 0; i < attempts; i++) {
        calls++;
        if (effects[i] !== 'TimeoutError()') break;
      }
      expect(effects.length).toBeGreaterThanOrEqual(attempts);
      expect(t.answerKey, `seed ${seed}`).toBe(String(calls));
    }
  });

  it('eng.branch-coverage: ветви if по входам тестов', () => {
    for (const seed of SEEDS) {
      const t = branchCoverage.generate(seed);
      const t1 = Number(/total >= (\d+)/.exec(t.code!)![1]);
      const t2 = Number(/items > (\d+)/.exec(t.code!)![1]);
      const covered = new Set<string>();
      for (const m of t.code!.matchAll(/shipping\((\d+), (\d+), (True|False)\)/g)) {
        covered.add(`a${Number(m[1]) >= t1}`);
        covered.add(`b${Number(m[2]) > t2}`);
        covered.add(`c${m[3] === 'True'}`);
      }
      expect(t.answerKey, `seed ${seed}`).toBe(String(6 - covered.size));
    }
  });

  it('eng.latency-percentile: ближайший ранг', () => {
    for (const seed of SEEDS) {
      const t = latencyPercentile.generate(seed);
      const vals = t.code!.split(', ').map(Number).sort((a, b) => a - b);
      const p = Number(/Чему равен p(\d+)/.exec(t.prompt)![1]);
      expect(vals).toHaveLength(20);
      expect(t.answerKey, `seed ${seed}`).toBe(String(vals[Math.ceil((p / 100) * vals.length) - 1]));
    }
  });

  it('eng.log-count: фильтр журнала', () => {
    for (const seed of SEEDS) {
      const t = logCount.generate(seed);
      const m = /путь (\S+) с (\S+) по (\S+) включительно/.exec(t.prompt)!;
      const n = t.code!.split('\n').filter((l) => {
        const [ts, , path, status] = l.split(/\s+/);
        return path === m[1] && Number(status) >= 500 && Number(status) <= 599 && ts! >= m[2]! && ts! <= m[3]!;
      }).length;
      expect(t.answerKey, `seed ${seed}`).toBe(String(n));
    }
  });

  it('eng.burn-rate: скорость сгорания и двухоконное правило', () => {
    for (const seed of SEEDS) {
      const t = burnRate.generate(seed);
      const errors = t.code!.split('\n').slice(1).map((l) => Number(l.split('|')[1]));
      const rate = (e: number, req: number) => e / req / 0.001;
      let expected: number;
      if (t.prompt.includes('за весь час')) expected = rate(errors.reduce((a, b) => a + b, 0), 12000);
      else {
        expected = 0;
        for (let i = 0; i < 12; i++) {
          const long = rate(errors.slice(0, i + 1).reduce((a, b) => a + b, 0), 1000 * (i + 1));
          if (rate(errors[i]!, 1000) >= 14.4 - 1e-9 && long >= 6 - 1e-9) {
            expected = i + 1;
            break;
          }
        }
      }
      expect(Number(t.answerKey), `seed ${seed}`).toBeCloseTo(expected, 6);
    }
  });

  it('eng.littles-law: L = λ·W и рост очереди', () => {
    for (const seed of SEEDS) {
      const t = littlesLaw.generate(seed);
      const lambda = Number(/приходит (\d+) задач/.exec(t.prompt)![1]);
      const w = Number(/одну задачу (\d+) мс/.exec(t.prompt)![1]);
      const workers = /обработчиков (\d+)\./.exec(t.prompt);
      if (!workers) expect(t.answerKey, `seed ${seed}`).toBe(String(Math.ceil((lambda * w) / 1000)));
      else {
        const minutes = Number(/за (\d+) мин/.exec(t.prompt)![1]);
        const growth = (lambda - (Number(workers[1]) * 1000) / w) * minutes * 60;
        expect(growth).toBeGreaterThan(0);
        expect(Number(t.answerKey), `seed ${seed}`).toBeCloseTo(growth, 6);
      }
    }
  });

  it('eng.circuit-breaker: автомат closed → open → half-open', () => {
    for (const seed of SEEDS) {
      const t = circuitBreaker.generate(seed);
      const T = Number(/t = 0, 1, …, (\d+)/.exec(t.prompt)![1]) + 1;
      const [from, to] = /ошибкой при (\d+) ≤ t < (\d+)/.exec(t.prompt)!.slice(1).map(Number) as [number, number];
      const threshold = Number(/после (\d+) ошибок подряд/.exec(t.code!)![1]);
      const open = Number(/open: (\d+) с/.exec(t.code!)![1]);
      let state = 'closed';
      let fails = 0;
      let until = -1;
      let reached = 0;
      for (let s = 0; s < T; s++) {
        const down = s >= from && s < to;
        if (state === 'open' && s < until) continue;
        reached++;
        if (state === 'open') {
          // half-open
          if (down) until = s + open;
          else [state, fails] = ['closed', 0];
          continue;
        }
        fails = down ? fails + 1 : 0;
        if (fails >= threshold) [state, until] = ['open', s + open];
      }
      const expected = t.prompt.includes('дойдёт до зависимости') ? reached : T - reached;
      expect(t.answerKey, `seed ${seed}`).toBe(String(expected));
    }
  });
});
