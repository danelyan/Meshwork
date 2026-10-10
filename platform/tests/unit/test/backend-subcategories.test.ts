import { GENERATORS } from '@/server/test/generators';
import * as B from '@/server/test/generators/backend';
import { BACKEND_GENERATORS } from '@/server/test/generators/backend';

const SUBS = ['backend.web-api', 'backend.integrations', 'backend.highload', 'backend.data-model'];
const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe('backend: подкатегории (ADR-0003, дополнение 10.10 15:50)', () => {
  it('у каждого семейства есть subcategoryId из четырёх, по 8+ на подкатегорию (4 Junior + 4 Middle минимум)', () => {
    for (const g of BACKEND_GENERATORS) expect(SUBS, g.id).toContain(g.subcategoryId);
    for (const s of SUBS) {
      const own = BACKEND_GENERATORS.filter((g) => g.subcategoryId === s);
      expect(own.length, s).toBeGreaterThanOrEqual(8);
      expect(own.filter((g) => g.grade === 'junior').length, `${s} junior`).toBeGreaterThanOrEqual(4);
      expect(own.filter((g) => g.grade === 'middle').length, `${s} middle`).toBeGreaterThanOrEqual(4);
      for (const g of own) {
        if (g.grade === 'middle') {
          expect(g.b, g.id).toBeGreaterThanOrEqual(0.3);
          expect(g.b, g.id).toBeLessThanOrEqual(0.8);
        } else expect(g.b, g.id).toBeLessThanOrEqual(-0.4);
        expect(g.a, g.id).toBeGreaterThanOrEqual(1.0);
        expect(g.a, g.id).toBeLessThanOrEqual(1.4);
      }
    }
  });

  it('id и taskId уникальны, ключ `be.*`', () => {
    expect(new Set(GENERATORS.map((g) => g.id)).size).toBe(GENERATORS.length);
    expect(new Set(BACKEND_GENERATORS.map((g) => g.taskId)).size).toBe(BACKEND_GENERATORS.length);
    for (const g of BACKEND_GENERATORS) expect(g.id).toMatch(/^be\./);
  });

  for (const g of BACKEND_GENERATORS) {
    it(`${g.id}: детерминизм и 300 seed без исключений`, () => {
      const variants = new Set<string>();
      for (const seed of SEEDS) {
        const inst = g.generate(seed);
        expect(g.generate(seed)).toEqual(inst);
        expect(inst.answerKey.length).toBeGreaterThan(0);
        expect(inst.prompt.length).toBeGreaterThan(20);
        variants.add(`${inst.prompt}\n${inst.code ?? ''}`);
      }
      expect(variants.size).toBeGreaterThanOrEqual(10);
    });
  }
});

// ---------------------------------------------------------------------------
// Независимое решение по тексту условия (не по params)
// ---------------------------------------------------------------------------

const each = (g: { generate: (s: number) => { prompt: string; code?: string; answerKey: string } }, solve: (prompt: string, code: string) => string) => {
  for (const seed of SEEDS) {
    const t = g.generate(seed);
    expect(t.answerKey, `seed ${seed}`).toBe(solve(t.prompt, t.code ?? ''));
  }
};
const num = (re: RegExp, s: string) => Number(re.exec(s)![1]);

describe('web-api: ключи', () => {
  it('pagination-offset', () => {
    each(B.paginationOffset, (p) => {
      const total = num(/ровно (\d+) записей/, p);
      let m = /limit=(\d+)&offset=(\d+)/.exec(p);
      if (m) return String(Math.max(0, Math.min(+m[1]!, total - +m[2]!)));
      m = /page=(\d+)&per_page=(\d+)/.exec(p);
      if (m) return String(Math.max(0, Math.min(+m[2]!, total - (+m[1]! - 1) * +m[2]!)));
      return String(Math.ceil(total / num(/per_page = (\d+)/, p)));
    });
  });

  it('validation-rules', () => {
    each(B.validationRules, (p, code) => {
      const [, a, b] = /name .* от (\d+) до (\d+) символов/.exec(p)!;
      const [, c, d] = /age .* от (\d+) до (\d+)/.exec(p)!;
      const res: number[] = [];
      code.split('\n').forEach((line, i) => {
        const o = JSON.parse(line.replace(/^\d+\. /, '')) as Record<string, unknown>;
        const name = o.name;
        const age = o.age;
        const bad =
          typeof name !== 'string' ||
          name.length < +a! ||
          name.length > +b! ||
          typeof o.email !== 'string' ||
          !o.email.includes('@') ||
          (age !== undefined && (!Number.isInteger(age) || (age as number) < +c! || (age as number) > +d!));
        if (bad) res.push(i + 1);
      });
      return res.join(',');
    });
  });

  it('cursor-pagination: реальные списки id', () => {
    each(B.cursorPagination, (p, code) => {
      const lines = code.split('\n');
      const [, hi] = /id (\d+) \.\.\. (\d+)/.exec(lines[0]!)!;
      const limit = num(/limit = (\d+)/, lines[0]!);
      const total = +hi!;
      let feed = Array.from({ length: total }, (_, i) => total - i);
      const page1 = feed.slice(0, limit);
      const origNext = feed.slice(limit, 2 * limit);
      const ins = /добавляются (\d+)/.exec(lines[1]!);
      if (ins) feed = [...Array.from({ length: +ins[1]! }, (_, i) => total + +ins[1]! - i), ...feed];
      else {
        const k = num(/удаляются (\d+)/, lines[1]!);
        feed = feed.filter((id) => !page1.slice(0, k).includes(id));
      }
      const page2 = lines[2]!.includes('OFFSET') ? feed.slice(limit, 2 * limit) : feed.filter((id) => id < page1[limit - 1]!).slice(0, limit);
      return String(ins ? page2.filter((id) => page1.includes(id)).length : origNext.filter((id) => !page2.includes(id)).length);
    });
  });

  it('proxy-retry', () => {
    each(B.proxyRetry, (p, code) => {
      let bal = num(/Начальный balance = (\d+)/, p);
      const hold = num(/на (\d+): оно не входит/, p);
      let holdOn = true;
      for (const line of code.split('\n')) {
        const times = line.includes('ответ потерян') ? 2 : 1;
        for (let r = 0; r < times; r++) {
          let m;
          if ((m = /PUT \/account \{"balance": (\d+)\}/.exec(line))) bal = +m[1]!;
          else if ((m = /POST \/deposits \{"amount": (\d+)\}, Idempotency-Key/.exec(line))) {
            if (r === 0) bal += +m[1]!;
          } else if ((m = /POST \/deposits \{"amount": (\d+)\}/.exec(line))) bal += +m[1]!;
          else if ((m = /POST \/withdrawals \{"amount": (\d+)\}/.exec(line))) bal -= +m[1]!;
          else if ((m = /PATCH \/account \{"add": (\d+)\}/.exec(line))) bal += +m[1]!;
          else if (/DELETE \/holds\/7/.test(line)) {
            if (holdOn) {
              bal += hold;
              holdOn = false;
            }
          } else throw new Error(line);
        }
      }
      return String(bal);
    });
  });

  it('optimistic-lock', () => {
    each(B.optimisticLock, (p, code) => {
      let version = 1;
      const known = new Map<string, number>();
      let c412 = 0;
      for (const line of code.split('\n')) {
        const [, c, op] = /\d+\. (\w): (GET|PUT)/.exec(line)!;
        if (op === 'GET') known.set(c!, version);
        else if (known.get(c!) === version) known.set(c!, ++version);
        else c412++;
      }
      return String(p.includes('Сколько ответов 412') ? c412 : version);
    });
  });

  it('rate-limit-window', () => {
    each(B.rateLimitWindow, (p, code) => {
      const times = code.split('\n').map((l) => num(/t = (\d+)/, l));
      const fixed = p.startsWith('Фиксированное');
      const w = fixed ? num(/окна по (\d+) с/, p) : num(/за последние (\d+) с/, p);
      const lim = fixed ? num(/не больше (\d+) запросов/, p) : num(/меньше (\d+);/, p);
      const ok: number[] = [];
      let rej = 0;
      for (const t of times) {
        const used = fixed ? ok.filter((x) => Math.floor(x / w) === Math.floor(t / w)).length : ok.filter((x) => x > t - w && x <= t).length;
        if (used < lim) ok.push(t);
        else rej++;
      }
      return String(rej);
    });
  });
});

describe('integrations: ключи', () => {
  it('json-mapping', () => {
    each(B.jsonMapping, (p, code) => {
      const o = JSON.parse(code) as { amount_minor: number; tip_minor?: number; items: { qty: number }[] };
      if (p.includes('itemsCount')) return String(o.items.reduce((s, i) => s + i.qty, 0));
      if (p.includes('total =')) return String((o.amount_minor + (o.tip_minor ?? 0)) / 100);
      return String(o.amount_minor / 100);
    });
  });

  it('timeout-budget', () => {
    each(B.timeoutBudget, (p, code) => {
      const pause = /пауза (\d+) с/.exec(p) ? num(/пауза (\d+) с/, p) : 0;
      let total = 0;
      for (const l of code.split('\n')) {
        const [, to, re, st] = /таймаут (\d+) с, повторов (\d+), (\S+)/.exec(l)!;
        if (st!.startsWith('недоступен')) total += (+re! + 1) * +to! + +re! * pause;
      }
      return String(total);
    });
  });

  it('retryable-status', () => {
    each(B.retryableStatus, (_p, code) =>
      code
        .split('\n')
        .flatMap((l) => {
          const [, n, rest] = /^(\d+)\. (.*)$/.exec(l)!;
          return /^(429|502|503|504)\b|таймаут|connection reset/.test(rest!) ? [n] : [];
        })
        .join(','),
    );
  });

  it('webhook-dedup', () => {
    each(B.webhookDedup, (_p, code) => {
      const done = new Set<string>();
      let sum = 0;
      for (const l of code.split('\n').slice(1)) {
        const [, id, type, amount, status] = /^\d+ \| (\S+) \| (\S+) \| (\d+) \| (\d+)$/.exec(l)!;
        if (status === '500' || type !== 'payment.succeeded' || done.has(id!)) continue;
        done.add(id!);
        sum += +amount!;
      }
      return String(sum);
    });
  });

  it('circuit-breaker', () => {
    each(B.circuitBreaker, (p, code) => {
      const th = num(/(\d+) неудачи подряд/, p);
      const cool = num(/прошло (\d+) с/, p);
      const [, from, to] = /от (\d+) с включительно до (\d+) с/.exec(p)!;
      const down = (t: number) => t >= +from! && t < +to!;
      let open: number | null = null; // момент размыкания
      let streak = 0;
      let sent = 0;
      for (const l of code.split('\n')) {
        const t = num(/t=(\d+)/, l);
        if (open !== null && t - open < cool) continue;
        sent++;
        if (!down(t)) {
          open = null;
          streak = 0;
        } else if (open !== null) open = t;
        else if (++streak >= th) open = t;
      }
      return String(sent);
    });
  });
});

describe('highload: ключи', () => {
  it('pool-capacity: расписание по слотам', () => {
    each(B.poolCapacity, (p) => {
      const pool = num(/пул из (\d+) соединений/, p);
      const n = num(/приходят (\d+) запросов/, p);
      const d = num(/на (\d+) мс \(других/, p);
      const free = Array<number>(pool).fill(0);
      const start: number[] = [];
      const end: number[] = [];
      for (let i = 0; i < n; i++) {
        const s = free.indexOf(Math.min(...free));
        start.push(free[s]!);
        free[s]! += d;
        end.push(free[s]!);
      }
      let m = /запрос №(\d+) \(/.exec(p);
      if (m) return String(end[+m[1]! - 1]);
      m = /t = ([\d.]+) мс ещё ждут/.exec(p);
      if (m) return String(start.filter((s) => s > +m![1]!).length);
      return String(Math.max(...end));
    });
  });

  it('lru-hits', () => {
    each(B.lruHits, (p, code) => {
      const cap = num(/Кэш на (\d+) ключа/, p);
      const lru = p.includes('LRU;');
      const cache = new Map<string, true>();
      let hits = 0;
      for (const k of code.split(' ')) {
        if (cache.has(k)) {
          hits++;
          if (lru) {
            cache.delete(k);
            cache.set(k, true);
          }
        } else {
          cache.set(k, true);
          if (cache.size > cap) cache.delete(cache.keys().next().value!);
        }
      }
      return String(hits);
    });
  });

  it('queue-backpressure', () => {
    each(B.queueBackpressure, (p, code) => {
      const cap = num(/ограничена (\d+) сообщениями/, p);
      const mu = num(/до (\d+) сообщений в секунду/, p);
      let q = 0;
      let rej = 0;
      for (const l of code.split('\n')) {
        const [, sec, rate] = /: (\d+) с, (\d+) сообщ/.exec(l)!;
        for (let s = 0; s < +sec!; s++) {
          q = Math.max(0, q - mu);
          const room = cap - q;
          rej += Math.max(0, +rate! - room);
          q = Math.min(cap, q + +rate!);
        }
      }
      return String(rej);
    });
  });

  it('cache-stampede', () => {
    each(B.cacheStampede, (p, code) => {
      const d = num(/занимает (\d+) мс/, p);
      const ttl = num(/TTL (\d+) мс/, p);
      const single = p.includes('single-flight');
      let validUntil = -1; // кэш валиден для t < validUntil; значение с наибольшим моментом окончания
      let inflightEnd = -1;
      let queries = 0;
      const pending: number[] = []; // моменты окончания идущих загрузок
      for (const l of code.split('\n')) {
        const t = num(/t=(\d+)/, l);
        for (const e of pending.filter((x) => x <= t)) validUntil = Math.max(validUntil, e + ttl);
        // Позднее окончание перезаписывает значение: валидность определяется последним завершением
        const done = pending.filter((x) => x <= t);
        if (done.length) validUntil = Math.max(...done) + ttl;
        for (let i = pending.length - 1; i >= 0; i--) if (pending[i]! <= t) pending.splice(i, 1);
        if (t < validUntil) continue;
        if (single && inflightEnd > t) continue;
        pending.push(t + d);
        inflightEnd = t + d;
        queries++;
      }
      return String(queries);
    });
  });
});

describe('data-model: ключи', () => {
  it('fk-actions: выполнение по правилам PostgreSQL', () => {
    each(B.fkActions, (_p, code) => {
      const lines = code.split('\n');
      const ids = lines[2]!.replace('-- parent: id ', '').split(', ').map(Number);
      const owner = lines[3]!.replace('-- child: parent_id ', '').split(', ').map(Number);
      const target = num(/id = (\d+);/, lines[4]!);
      const action = /ON DELETE (CASCADE|SET NULL|RESTRICT)/.exec(lines[1]!)?.[1] ?? 'NO ACTION';
      let parents = ids.length;
      let kids = owner.length;
      const k = owner.filter((o) => o === target).length;
      if (action === 'CASCADE') {
        parents--;
        kids -= k;
      } else if (action === 'SET NULL') parents--;
      else if (k === 0) parents--; // у цели нет дочерних - DELETE проходит (в генераторе k ≥ 1)
      return String(parents + kids);
    });
  });

  it('transaction-scope', () => {
    each(B.transactionScope, (p, code) => {
      let committed = num(/сначала (\d+) строк/, p);
      let inTx: number[] | null = null; // число вставок по уровням savepoint
      let savepoints: { name: string; len: number }[] = [];
      let buf: string[] = [];
      for (const l of code.split('\n')) {
        if (l === 'BEGIN;') {
          buf = [];
          savepoints = [];
          inTx = [];
        } else if (l.startsWith('INSERT')) {
          if (inTx) buf.push(l);
          else committed++;
        } else if (l.startsWith('SAVEPOINT')) savepoints.push({ name: l.slice(10, -1), len: buf.length });
        else if (l.startsWith('ROLLBACK TO')) buf.length = savepoints.find((s) => s.name === l.slice(12, -1))!.len;
        else if (l === 'COMMIT;') {
          committed += buf.length;
          inTx = null;
        } else if (l === 'ROLLBACK;') inTx = null;
      }
      return String(committed);
    });
  });

  it('upsert-conflict', () => {
    each(B.upsertConflict, (_p, code) => {
      const t = new Map<string, number>();
      for (const l of code.split('\n')) {
        let m;
        if ((m = /^-- в таблице: (\w+) → (\d+)/.exec(l))) t.set(m[1]!, +m[2]!);
        else if ((m = /VALUES \('(\w+)', (\d+)\) ON CONFLICT \(sku\) (.*);$/.exec(l))) {
          const [, sku, q, act] = m;
          const cur = t.get(sku!);
          if (cur === undefined) t.set(sku!, +q!);
          else if (act === 'DO UPDATE SET qty = stock.qty + EXCLUDED.qty') t.set(sku!, cur + +q!);
          else if (act === 'DO UPDATE SET qty = EXCLUDED.qty') t.set(sku!, +q!);
          else if (act !== 'DO NOTHING') throw new Error(act);
        } else throw new Error(l);
      }
      return String([...t.values()].reduce((a, b) => a + b, 0));
    });
  });

  it('deadlock-commits: ожидание по графу', () => {
    each(B.deadlockCommits, (_p, code) => {
      const steps = code.split('\n').map((l) => {
        const m = /^T(\d): (UPDATE.*id = (\d+)|SELECT.*FOR UPDATE|SELECT.*id = (\d+)|COMMIT)/.exec(l)!;
        const t = +m[1]! - 1;
        if (m[2] === 'COMMIT;' || l.endsWith('COMMIT;')) return { t, k: 'c' as const, r: 0 };
        if (l.includes('FOR UPDATE')) return { t, k: 'l' as const, r: num(/id = (\d+)/, l) };
        if (l.includes('UPDATE accounts')) return { t, k: 'l' as const, r: num(/id = (\d+)/, l) };
        return { t, k: 's' as const, r: 0 };
      });
      // Пошаговый планировщик: каждый такт пытаемся продвинуть голову очереди каждой транзакции.
      const q: (typeof steps)[] = [[], []];
      const owner: Record<number, number> = {};
      const dead = [false, false];
      let commits = 0;
      const run = () => {
        for (let guard = 0; guard < 50; guard++) {
          let moved = false;
          for (const t of [0, 1]) {
            if (dead[t]) continue;
            const s = q[t]![0];
            if (!s) continue;
            if (s.k === 's') {
              q[t]!.shift();
              moved = true;
            }
            else if (s.k === 'c') {
              q[t]!.shift();
              commits++;
              dead[t] = true;
              for (const r of Object.keys(owner)) if (owner[+r] === t) delete owner[+r];
              moved = true;
            } else if (owner[s.r] === undefined || owner[s.r] === t) {
              owner[s.r] = t;
              q[t]!.shift();
              moved = true;
            }
          }
          if (!moved) {
            // оба ждут друг друга -> откат одного
            const w = [0, 1].filter((t) => !dead[t] && q[t]![0] && owner[q[t]![0]!.r] !== undefined && owner[q[t]![0]!.r] !== t);
            if (w.length === 2) {
              dead[1] = true;
              q[1] = [];
              for (const r of Object.keys(owner)) if (owner[+r] === 1) delete owner[+r];
            } else return;
          }
        }
      };
      for (const s of steps) {
        q[s.t]!.push(s);
        run();
      }
      run();
      return String(commits);
    });
  });

  it('lost-update', () => {
    each(B.lostUpdate, (_p, code) => {
      const lines = code.split('\n');
      const rr = lines[0]!.includes('REPEATABLE READ');
      const start = num(/-- (\d+)/, lines[2]!);
      let bal = start;
      const apply = (l: string) => {
        const abs = /SET balance = (-?\d+) WHERE/.exec(l);
        if (abs) return +abs[1]!;
        const rel = /balance = balance ([+-]) (\d+) WHERE/.exec(l)!;
        return bal + (rel[1] === '+' ? 1 : -1) * +rel[2]!;
      };
      bal = apply(lines[4]!); // T1 commits first
      // T2: при RR строка изменена после снимка T2 -> ошибка, откат
      if (!rr) bal = apply(lines[6]!);
      return String(bal);
    });
  });
});
