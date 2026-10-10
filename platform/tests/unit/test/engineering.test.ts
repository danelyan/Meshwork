// Генераторы направления engineering (ADR-0003, дополнение 10.10): 300 seed на семейство,
// детерминизм, ключ принимается проверкой, и для семейств с вычисляемым ответом — независимое
// решение по тексту условия (как schema-constraint.test.ts): ключ должен совпасть с ним.
import { catalogFromFile } from '@/server/claims/catalog-file';
import { checkAnswer, normalizeAnswer } from '@/server/test/answers';
import { GENERATORS, generatorsFor } from '@/server/test/generators';
import {
  dedupCount,
  deployRollback,
  dockerCache,
  ENGINEERING_GENERATORS,
  errorBudget,
  fixtureIsolation,
  flakyLine,
  idempotentLoad,
  incrementalWatermark,
  k8sRuntime,
  partitionPrune,
  retryAmplification,
  schemaTypes,
  secretsLeak,
} from '@/server/test/generators/engineering';
import { deriveSeed } from '@/server/test/rng';

const SEEDS = Array.from({ length: 300 }, (_, i) => deriveSeed(20261010, i));

const EXPECTED_IDS = [
  'eng.dedup-count',
  'eng.schema-types',
  'eng.docker-cache',
  'eng.secrets-leak',
  'eng.test-pyramid',
  'eng.fixture-isolation',
  'eng.error-budget',
  'eng.symptom-alert',
  'eng.idempotent-load',
  'eng.incremental-watermark',
  'eng.partition-prune',
  'eng.k8s-runtime',
  'eng.deploy-rollback',
  'eng.flaky-line',
  'eng.contract-test',
  'eng.retry-amplification',
];

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
  it('16 семейств: 8 Junior + 8 Middle, ключи eng.*, зарегистрированы в реестре', () => {
    expect(ENGINEERING_GENERATORS.map((g) => g.id).sort()).toEqual([...EXPECTED_IDS].sort());
    expect(generatorsFor('engineering').map((g) => g.id).sort()).toEqual([...EXPECTED_IDS].sort());
    expect(ENGINEERING_GENERATORS.filter((g) => g.grade === 'junior')).toHaveLength(8);
    expect(ENGINEERING_GENERATORS.filter((g) => g.grade === 'middle')).toHaveLength(8);
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

  it('eng.k8s-runtime: пошаговая симуляция проб и сумма requests', () => {
    for (const seed of SEEDS) {
      const t = k8sRuntime.generate(seed);
      const code = t.code!;
      if (code.startsWith('Узел')) {
        const [allocCpu, allocMem] = /allocatable cpu (\d+)m, memory (\d+)Mi/.exec(code)!.slice(1).map(Number);
        const [usedCpu, usedMem] = /requests cpu (\d+)m, memory (\d+)Mi;/.exec(code)!.slice(1).map(Number);
        const [reqCpu, reqMem] = /requests: \{ cpu: (\d+)m, memory: (\d+)Mi \}/.exec(code)!.slice(1).map(Number);
        let n = 0;
        while ((n + 1) * reqCpu! <= allocCpu! - usedCpu! && (n + 1) * reqMem! <= allocMem! - usedMem!) n++;
        expect(t.answerKey, `seed ${seed}`).toBe(String(n));
        continue;
      }
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
