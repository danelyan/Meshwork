import { GENERATORS } from '@/server/test/generators';
import * as B from '@/server/test/generators/backend';
import { BACKEND_GENERATORS } from '@/server/test/generators/backend';

const SUBS = ['backend.web-api', 'backend.integrations', 'backend.highload', 'backend.data-model'];
const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe('backend: подкатегории (ADR-0003, дополнение 10.10 15:50)', () => {
  it('у каждого семейства есть subcategoryId из четырёх; пул: 6+ Junior, 4+ Middle, 4+ Senior (ADR-0003, 16:15)', () => {
    for (const g of BACKEND_GENERATORS) expect(SUBS, g.id).toContain(g.subcategoryId);
    for (const s of SUBS) {
      const own = BACKEND_GENERATORS.filter((g) => g.subcategoryId === s);
      expect(own.length, s).toBeGreaterThanOrEqual(14);
      expect(own.filter((g) => g.grade === 'junior').length, `${s} junior`).toBeGreaterThanOrEqual(6);
      expect(own.filter((g) => g.grade === 'middle').length, `${s} middle`).toBeGreaterThanOrEqual(4);
      expect(own.filter((g) => g.grade === 'senior').length, `${s} senior`).toBeGreaterThanOrEqual(4);
      for (const g of own) {
        if (g.grade === 'senior') {
          expect(g.b, g.id).toBeGreaterThanOrEqual(1.0);
          expect(g.b, g.id).toBeLessThanOrEqual(1.7);
        } else if (g.grade === 'middle') {
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

// ---------------------------------------------------------------------------
// +2 Junior и +4 Senior на подкатегорию (ADR-0003, 16:15)
// ---------------------------------------------------------------------------

describe('web-api: новые ключи', () => {
  it('route-matching', () => {
    each(B.routeMatching, (p, code) => {
      const [rt, rq] = code.split('\n\nЗапросы:\n');
      const routes = rt!.replace('Маршруты:\n', '').split('\n').map((l) => l.split(' '));
      const reqs = rq!.split('\n').map((l) => l.replace(/^\d+\. /, '').split(' '));
      let c404 = 0;
      let c405 = 0;
      for (const [m, path] of reqs) {
        const byPath = routes.filter(([, rp]) => {
          const a = rp!.split('/');
          const b = path!.split('/');
          return a.length === b.length && a.every((x, i) => x.startsWith(':') || x === b[i]);
        });
        if (!byPath.length) c404++;
        else if (!byPath.some(([rm]) => rm === m)) c405++;
      }
      return String(p.includes('получат 405') ? c405 : c404);
    });
  });

  it('list-query', () => {
    each(B.listQuery, (p, code) => {
      const [, status, sort, limit, offset] = /status=(\w+)&sort=(-?)amount&limit=(\d+)&offset=(\d+)/.exec(p)!;
      const rows = code
        .split('\n')
        .slice(3)
        .map((l) => l.split('|').map((x) => x.trim()))
        .map(([id, st, am]) => ({ id: +id!, st, am: +am! }))
        .filter((r) => r.st === status);
      rows.sort((a, b) => (sort ? b.am - a.am : a.am - b.am));
      return rows.slice(+offset!, +offset! + +limit!).map((r) => r.id).join(',');
    });
  });

  it('api-breaking-changes: классификация по тексту', () => {
    const breaking = /переименовано|удалено|удалён|(?<!не)обязательное поле|изменён с integer|ужесточено/;
    each(B.apiBreakingChanges, (_p, code) =>
      code
        .split('\n')
        .flatMap((l) => {
          const [, n, t] = /^(\d+)\. (.*)$/.exec(l)!;
          return breaking.test(t!) ? [n] : [];
        })
        .join(','),
    );
  });

  it('idempotency-ttl', () => {
    each(B.idempotencyTtl, (p, code) => {
      const ttl = num(/ровно (\d+) с/, p);
      const executedAt = new Map<string, number>();
      let n = 0;
      for (const l of code.split('\n')) {
        const [, t, key] = /t=(\d+)с\s+Idempotency-Key: (\w+)/.exec(l)!;
        const at = executedAt.get(key!);
        if (at !== undefined && +t! - at < ttl) continue;
        executedAt.set(key!, +t!);
        n++;
      }
      return String(n);
    });
  });

  it('shared-cache-origin', () => {
    each(B.sharedCacheHits, (p, code) => {
      const h = /Cache-Control: ([^.]+)\. Запросы/.exec(p)![1]!;
      const dir = (n: string) => new RegExp(`${n}=(\\d+)`).exec(h)?.[1];
      const times = code.split('\n').map((l) => num(/t=(\d+)/, l));
      if (/no-store|private/.test(h)) return String(times.length);
      if (/no-cache/.test(h)) return String(times.length);
      const fresh = Number(dir('s-maxage') ?? dir('max-age'));
      let origin = 0;
      let last = -Infinity;
      for (const t of times) {
        if (t - last >= fresh) {
          origin++;
          last = t;
        }
      }
      return String(origin);
    });
  });

  it('capacity-littles-law', () => {
    each(B.littlesLaw, (p) => {
      const rps = num(/получает (\d+) запросов/, p);
      const lat = num(/обработки (\d+) мс/, p);
      const w = num(/не больше (\d+) запросов одновременно/, p);
      const u = num(/не выше (\d+)%/, p);
      const conc = (rps * lat) / 1000;
      const per = (w * u) / 100;
      return String(Math.ceil(Math.round((conc / per) * 1e6) / 1e6) + (p.includes('нужен один резервный') ? 1 : 0));
    });
  });
});

describe('integrations: новые ключи', () => {
  it('fetch-all-pages', () => {
    each(B.fetchAllPages, (p) => {
      const size = num(/по (\d+) записей/, p);
      const total = num(/Всего у API (\d+) записей/, p);
      const full = p.includes('если страница заполнена целиком');
      let pos = 0;
      let reqs = 0;
      let hasNext = true;
      while (hasNext) {
        reqs++;
        const got = Math.min(size, total - pos);
        pos += got;
        hasNext = full ? got === size : pos < total;
      }
      return String(reqs);
    });
  });

  it('client-throttle: расписание по окнам', () => {
    each(B.clientThrottle, (p) => {
      const limit = num(/не больше (\d+) запросов в секунду/, p);
      const m = num(/сделать (\d+) запросов/, p);
      const perWindow: number[] = [];
      for (let i = 0; i < m; i++) {
        const w = Math.floor(i / limit);
        perWindow[w] = (perWindow[w] ?? 0) + 1;
      }
      return String(p.includes('В какую секунду') ? perWindow.length - 1 : perWindow.length);
    });
  });

  it('retry-amplification-chain', () => {
    each(B.retryAmplification, (_p, code) => {
      let calls = 1;
      for (const l of code.split('\n')) {
        const m = /при любой ошибке повторяет, (\d+) повтора/.exec(l);
        if (m) calls *= +m[1]! + 1;
      }
      return String(calls);
    });
  });

  it('saga-compensation', () => {
    each(B.sagaCompensation, (p, code) => {
      const failAt = num(/Шаг №(\d+)/, p);
      const done = code.split('\n').slice(0, failAt - 1);
      return done
        .map((l) => /компенсация: (\S+)$/.exec(l)![1]!)
        .filter((c) => c !== 'нет')
        .reverse()
        .join(',');
    });
  });

  it('webhook-replay-window', () => {
    each(B.webhookReplayWindow, (p, code) => {
      const tol = num(/≤ (\d+) с/, p);
      const seen = new Set<string>();
      for (const l of code.split('\n').slice(1)) {
        const [, , arr, sent, id, sig] = /^(\d+) \| (\d+) \| (\d+) \| (\w+) \| (\S+)$/.exec(l)!.map((x, i) => (i >= 2 && i <= 3 ? Number(x) : x)) as unknown as [string, string, number, number, string, string];
        if (sig === 'верна' && Math.abs(arr - sent) <= tol && !seen.has(id)) seen.add(id);
      }
      return String(seen.size);
    });
  });

  it('contract-drift', () => {
    each(B.contractDrift, (_p, code) => {
      const [head, ...rest] = code.split('\n').filter(Boolean);
      const payload = head!.replace('Ответ: ', '').split(', ');
      return rest
        .flatMap((l) => {
          const m = /^(C\d): обязательные \[(.*?)\], схема \[(.*?)\], (\S+)$/.exec(l)!;
          const req = m[2]!.split(', ');
          const schema = m[3]!.split(', ');
          const broken = req.some((f) => !payload.includes(f)) || (m[4] === 'строгий' && payload.some((f) => !schema.includes(f)));
          return broken ? [m[1]!] : [];
        })
        .join(',');
    });
  });
});

describe('highload: новые ключи', () => {
  it('batching-time', () => {
    each(B.batchingTime, (p) => {
      const n = num(/вставить (\d+) строк/, p);
      const rtt = num(/занимает (\d+) мс/, p);
      const batch = /пач\S* по (\d+) строк/.exec(p) ? num(/пач\S* по (\d+) строк/, p) : 1;
      const single = n * rtt;
      const batched = Math.ceil(n / batch) * rtt;
      if (p.includes('на сколько мс пачки быстрее')) return String(single - batched);
      return String(p.includes('по одной строке отдельными') ? single : batched);
    });
  });

  it('ttl-loads', () => {
    each(B.ttlLoads, (p, code) => {
      const ttl = num(/живёт (\d+) с/, p);
      const times = code.split('\n').map((l) => num(/t=(\d+)/, l));
      let loadedAt: number | null = null;
      let loads = 0;
      for (const t of times) {
        if (loadedAt === null || t - loadedAt >= ttl) {
          loads++;
          loadedAt = t;
        }
      }
      return String(loads);
    });
  });

  it('replica-lag-reads', () => {
    each(B.replicaLag, (p, code) => {
      const lag = num(/отстаёт на (\d+) с/, p);
      const sticky = /в течение (\d+) с/.exec(p) ? num(/в течение (\d+) с/, p) : 0;
      const evs = code.split('\n').map((l) => ({ t: num(/t=(\d+)/, l), w: l.includes('запись') }));
      let stale = 0;
      let lastW: number | null = null;
      evs.forEach((e, i) => {
        if (e.w) {
          lastW = e.t;
          return;
        }
        if (sticky && lastW !== null && e.t < lastW + sticky) return;
        const newest = Math.max(-Infinity, ...evs.slice(0, i).filter((x) => x.w).map((x) => x.t));
        if (newest > e.t - lag) stale++;
      });
      return String(stale);
    });
  });

  it('hot-key-db-load', () => {
    each(B.hotKeyDbLoad, (p, code) => {
      const cap = num(/вмещает (\d+) ключей/, p);
      const groups = code.split('\n').map((l) => {
        const [, n, r] = /: (\d+) ключей по (\d+) запросов/.exec(l)!;
        return { n: +n!, r: +r! };
      });
      const keys = groups.flatMap((g) => Array<number>(g.n).fill(g.r)).sort((a, b) => b - a);
      const total = keys.reduce((s, x) => s + x, 0);
      return String(total - keys.slice(0, cap).reduce((s, x) => s + x, 0));
    });
  });

  it('queue-drain: посекундная симуляция', () => {
    each(B.queueDrain, (p) => {
      const parts = num(/топике (\d+) партиях/, p);
      let backlog = num(/накопилось (\d+) сообщений/, p);
      const lambda = num(/поступать (\d+) сообщений/, p);
      const cons = num(/Запущено (\d+) консьюмеров/, p);
      const mu = num(/каждый обрабатывает (\d+) сообщений/, p);
      const rate = Math.min(parts, cons) * mu;
      if (rate <= lambda) return '0';
      for (let s = 1; s < 100000; s++) {
        backlog = Math.max(0, backlog + lambda - rate);
        if (backlog === 0) return String(s);
      }
      return '0';
    });
  });

  it('slow-query-top', () => {
    each(B.slowQueryTop, (_p, code) => {
      const lines = code.split('\n');
      let best = 0;
      let bestV = -1;
      for (let i = 0; i < lines.length; i += 2) {
        const t = lines[i + 1]!;
        const calls = num(/calls=(\d+)/, t);
        const v = /total=(\d+)/.test(t) ? num(/total=(\d+)/, t) : Math.round(calls * Number(/mean=([\d.]+)/.exec(t)![1]));
        if (v > bestV) {
          bestV = v;
          best = i / 2 + 1;
        }
      }
      return String(best);
    });
  });
});

describe('data-model: новые ключи', () => {
  it('sql-aggregate: выполнение запроса над таблицей из условия', () => {
    each(B.sqlAggregate, (_p, code) => {
      const [tab, , sql] = code.split('\n\n').length === 2 ? [code.split('\n\n')[0]!, '', code.split('\n\n')[1]!] : [code, '', ''];
      const rows = tab
        .split('\n')
        .slice(3)
        .map((l) => l.split('|').map((x) => x.trim()))
        .map(([id, u, st, am]) => ({ id: +id!, u: +u!, st, am: +am! }));
      let m;
      if ((m = /SUM\(amount\) FROM \w+ WHERE status = '(\w+)'/.exec(sql))) return String(rows.filter((r) => r.st === m![1]).reduce((s, r) => s + r.am, 0));
      if ((m = /COUNT\(DISTINCT user_id\) FROM \w+ WHERE status <> '(\w+)'/.exec(sql))) return String(new Set(rows.filter((r) => r.st !== m![1]).map((r) => r.u)).size);
      if ((m = /MAX\(amount\) FROM \w+ WHERE user_id = (\d+) AND status = '(\w+)'/.exec(sql))) return String(Math.max(0, ...rows.filter((r) => r.u === +m![1]! && r.st === m![2]).map((r) => r.am)));
      m = /HAVING SUM\(amount\) > (\d+)/.exec(sql)!;
      const sums: Record<number, number> = {};
      for (const r of rows) sums[r.u] = (sums[r.u] ?? 0) + r.am;
      return String(Object.values(sums).filter((v) => v > +m![1]!).length);
    });
  });

  it('null-count', () => {
    each(B.nullCount, (_p, code) => {
      const [tab, sql] = code.split('\n\n');
      const cities = tab!
        .split('\n')
        .slice(3)
        .map((l) => l.split('|')[1]!.trim())
        .map((c) => (c === 'NULL' ? null : c));
      let m;
      if (/COUNT\(city\)/.test(sql!)) return String(cities.filter((c) => c !== null).length);
      if ((m = /city <> '(.+?)'/.exec(sql!))) return String(cities.filter((c) => c !== null && c !== m![1]).length);
      if (/city = NULL/.test(sql!)) return '0';
      if (/NOT IN/.test(sql!)) return '0';
      m = /IS NULL OR city = '(.+?)'/.exec(sql!)!;
      return String(cities.filter((c) => c === null || c === m![1]).length);
    });
  });

  it('migration-safety', () => {
    const bad = [/ADD COLUMN \w+ \w+ NOT NULL;/, /clock_timestamp/, /TYPE bigint/, /^CREATE INDEX orders/, /SET NOT NULL/, /DROP COLUMN/, /RENAME COLUMN/];
    each(B.migrationSafety, (_p, code) =>
      code
        .split('\n')
        .flatMap((l) => {
          const [, n, sql] = /^(\d+)\. (.*)$/.exec(l)!;
          return bad.some((r) => r.test(sql!)) ? [n] : [];
        })
        .join(','),
    );
  });

  it('write-skew: выполнение по правилам изоляции PostgreSQL', () => {
    each(B.writeSkew, (p, code) => {
      const level = /ISOLATION LEVEL ([A-Z ]+);/.exec(code)![1]!;
      const min = num(/не меньше (\d+)/, p);
      const n = num(/Сейчас на дежурстве (\d+)/, p);
      const counter = p.includes('общий счётчик');
      if (!counter) return String(level === 'SERIALIZABLE' ? n - 1 : n - 2);
      // Один счётчик, UPDATE ... WHERE n > min.
      let v = n;
      v = v > min ? v - 1 : v; // T1
      if (level === 'READ COMMITTED') v = v > min ? v - 1 : v; // T2 перечитывает после коммита T1
      return String(v);
    });
  });

  it('unique-index-forms', () => {
    each(B.uniqueIndexForms, (_p, code) => {
      const [ddl, ...rest] = code.split('\n').filter((l) => l && !l.startsWith('--'));
      const failing: number[] = [];
      const seen = new Set<string>();
      rest.forEach((l, i) => {
        const m = /VALUES \((NULL|\d+), '([^']+)', (NULL|'[^']+')\)/.exec(l)!;
        const tenant = m[1] === 'NULL' ? null : m[1];
        const email = m[2]!;
        const deleted = m[3] !== 'NULL';
        let key: string | null;
        if (ddl!.includes('lower(email)')) key = email.toLowerCase();
        else if (ddl!.includes('WHERE deleted_at IS NULL')) key = deleted ? null : email;
        else if (ddl!.includes('(tenant_id, email)')) key = tenant === null ? null : `${tenant}/${email}`;
        else key = email;
        if (key === null) return;
        if (seen.has(key)) failing.push(i + 1);
        else seen.add(key);
      });
      return failing.join(',');
    });
  });

  it('sequence-gaps', () => {
    each(B.sequenceGaps, (_p, code) => {
      let seq = 0;
      let inTx = false;
      for (const l of code.split('\n')) {
        if (l === 'BEGIN;') inTx = true;
        else if (l === 'ROLLBACK;') inTx = false;
        else if (/^INSERT INTO orders \(id, ref\)/.test(l)) continue; // явный id: последовательность не трогаем
        else if (/^INSERT INTO orders \(ref\)|^SELECT nextval/.test(l)) seq++;
      }
      void inTx;
      return String(seq);
    });
  });
});
