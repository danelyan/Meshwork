// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createReplica, type Op, type Replica } from '../src/board';

// Детерминированный генератор, чтобы тест не зависел от Math.random.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
const clone = (op: Op): Op => JSON.parse(JSON.stringify(op)) as Op;

describe('локальные операции и часы', () => {
  it('пустая реплика: пустой snapshot, log и stats', () => {
    const a = createReplica('a');
    expect(a.snapshot()).toEqual([]);
    expect(a.log()).toEqual([]);
    expect(a.stats()).toEqual({ applied: 0, duplicates: 0, orphans: 0 });
    expect(a.id).toBe('a');
  });

  it('счётчик растёт с каждой локальной операцией, id карточки строится из реплики и счётчика', () => {
    const a = createReplica('a');
    const o1 = a.add('Один', 'todo');
    const o2 = a.add('Два', 'todo');
    const o3 = a.rename('a:2', 'Два!');
    expect([o1.ts, o2.ts, o3.ts]).toEqual([{ c: 1, r: 'a' }, { c: 2, r: 'a' }, { c: 3, r: 'a' }]);
    expect(o2).toMatchObject({ kind: 'add', id: 'a:2', title: 'Два', column: 'todo' });
    expect(o3).toMatchObject({ kind: 'rename', id: 'a:2', title: 'Два!' });
  });

  it('принятая операция сдвигает счётчик: следующая локальная новее любой принятой', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    for (let i = 0; i < 4; i++) b.add(`t${i}`, 'todo');
    b.log().forEach((op) => a.apply(op));
    const next = a.add('после', 'todo');
    expect(next.ts).toEqual({ c: 5, r: 'a' });
    expect(next.id).toBe('a:5');
  });

  it('rename, move и remove неизвестной или удалённой карточки бросают Error и не двигают счётчик', () => {
    const a = createReplica('a');
    expect(() => a.rename('нет', 'x')).toThrow(Error);
    expect(() => a.move('нет', 'x')).toThrow(Error);
    expect(() => a.remove('нет')).toThrow(Error);
    expect(a.log()).toEqual([]);
    a.add('X', 'todo');
    a.remove('a:1');
    expect(() => a.rename('a:1', 'y')).toThrow(Error);
    expect(a.log()).toHaveLength(2);
    expect(a.add('Y', 'todo').ts.c).toBe(3);
  });

  it('snapshot — новые объекты при каждом вызове, правка снимка не портит реплику', () => {
    const a = createReplica('a');
    a.add('X', 'todo');
    const s1 = a.snapshot();
    s1[0]!.title = 'испорчено';
    s1.length = 0;
    expect(a.snapshot()).toEqual([{ id: 'a:1', title: 'X', column: 'todo' }]);
    expect(a.snapshot()).not.toBe(a.snapshot());
  });
});

describe('порядок доставки и идемпотентность', () => {
  it('rename и move раньше add: карточка невидима и считается сиротой, после add применяется всё', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    const add = a.add('X', 'todo');
    const ren = a.rename('a:1', 'Y');
    const mv = a.move('a:1', 'done');
    b.apply(mv);
    b.apply(ren);
    expect(b.snapshot()).toEqual([]);
    expect(b.stats().orphans).toBe(1);
    b.apply(add);
    expect(b.snapshot()).toEqual([{ id: 'a:1', title: 'Y', column: 'done' }]);
    expect(b.stats().orphans).toBe(0);
  });

  it('remove раньше add: карточка так и не появляется', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    const add = a.add('X', 'todo');
    const rem = a.remove('a:1');
    b.apply(rem);
    b.apply(add);
    expect(b.snapshot()).toEqual([]);
    expect(b.stats()).toMatchObject({ applied: 2, orphans: 0 });
  });

  it('повтор операции (в том числе копией) ничего не меняет и считается в duplicates', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    const add = a.add('X', 'todo');
    const ren = a.rename('a:1', 'Y');
    b.apply(add);
    b.apply(ren);
    const before = JSON.stringify(b.snapshot());
    b.apply(clone(add));
    b.apply(ren);
    b.apply(clone(ren));
    expect(JSON.stringify(b.snapshot())).toBe(before);
    expect(b.stats()).toEqual({ applied: 2, duplicates: 3, orphans: 0 });
    expect(b.log()).toHaveLength(2);
  });

  it('применение собственной операции повторно — тоже повтор', () => {
    const a = createReplica('a');
    const add = a.add('X', 'todo');
    a.apply(add);
    expect(a.stats()).toEqual({ applied: 1, duplicates: 1, orphans: 0 });
    expect(a.snapshot()).toHaveLength(1);
  });
});

describe('конфликты', () => {
  it('параллельные rename: побеждает большая метка, при равном c — большая реплика, в любом порядке доставки', () => {
    for (const order of [0, 1]) {
      const a = createReplica('a');
      const b = createReplica('b');
      const c = createReplica('c');
      const add = a.add('X', 'todo');
      b.apply(add);
      c.apply(add);
      const ra = a.rename('a:1', 'от a');
      const rb = b.rename('a:1', 'от b');
      expect(ra.ts.c).toBe(rb.ts.c);
      (order ? [rb, ra] : [ra, rb]).forEach((op) => c.apply(op));
      expect(c.snapshot()[0]!.title).toBe('от b');
    }
  });

  it('метка с большим счётчиком побеждает независимо от имени реплики', () => {
    const a = createReplica('a');
    const z = createReplica('z');
    const add = a.add('X', 'todo');
    z.apply(add);
    const first = z.rename('a:1', 'z1');
    a.apply(first);
    const second = a.rename('a:1', 'a2');
    z.apply(second);
    expect(second.ts.c).toBeGreaterThan(first.ts.c);
    expect(a.snapshot()[0]!.title).toBe('a2');
    expect(z.snapshot()[0]!.title).toBe('a2');
  });

  it('title и column независимы: параллельные rename и move не затирают друг друга', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    const add = a.add('X', 'todo');
    b.apply(add);
    const ren = a.rename('a:1', 'Новое');
    const mv = b.move('a:1', 'done');
    a.apply(mv);
    b.apply(ren);
    expect(a.snapshot()).toEqual([{ id: 'a:1', title: 'Новое', column: 'done' }]);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it('более новая правка перекрывает title из add, более старая — нет', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    const add = a.add('исходное', 'todo');
    const ren = a.rename('a:1', 'правка');
    b.apply(ren);
    b.apply(add);
    expect(b.snapshot()[0]!.title).toBe('правка');
    const stale: Op = { kind: 'rename', id: 'a:1', title: 'старое', ts: { c: 0, r: 'z' } };
    b.apply(stale);
    expect(b.snapshot()[0]!.title).toBe('правка');
  });

  it('remove окончателен: поздние правки с большей меткой карточку не воскрешают', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    const add = a.add('X', 'todo');
    b.apply(add);
    const rem = a.remove('a:1');
    const late: Op = { kind: 'move', id: 'a:1', column: 'done', ts: { c: 99, r: 'b' } };
    b.apply(rem);
    b.apply(late);
    a.apply(late);
    expect(a.snapshot()).toEqual([]);
    expect(b.snapshot()).toEqual([]);
  });
});

describe('snapshot, log, подписка', () => {
  it('snapshot упорядочен по метке add: счётчик, затем реплика', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    const o1 = b.add('b1', 'x');
    const o2 = a.add('a1', 'x');
    const o3 = a.add('a2', 'x');
    const r = createReplica('r');
    [o3, o1, o2].forEach((op) => r.apply(op));
    expect(r.snapshot().map((c) => c.id)).toEqual(['a:1', 'b:1', 'a:2']);
  });

  it('log хранит принятые операции в порядке принятия и отдаёт копию', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    const add = a.add('X', 'todo');
    const ren = a.rename('a:1', 'Y');
    b.apply(ren);
    b.apply(add);
    const own = b.move('a:1', 'done');
    expect(b.log()).toEqual([ren, add, own]);
    b.log().length = 0;
    expect(b.log()).toHaveLength(3);
    expect(b.stats().applied).toBe(3);
  });

  it('подписчик: один вызов на видимое изменение, ни одного на повтор и на операции над невидимой карточкой', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    const add = a.add('X', 'todo');
    const ren = a.rename('a:1', 'Y');
    let calls = 0;
    const off = b.subscribe(() => (calls += 1));
    b.apply(ren);
    expect(calls).toBe(0);
    b.apply(add);
    expect(calls).toBe(1);
    b.apply(add);
    b.apply(ren);
    expect(calls).toBe(1);
    b.move('a:1', 'done');
    expect(calls).toBe(2);
    off();
    b.remove('a:1');
    expect(calls).toBe(2);
  });

  it('подписчик видит уже обновлённое состояние', () => {
    const a = createReplica('a');
    const seen: string[] = [];
    a.subscribe(() => seen.push(a.snapshot().map((c) => c.title).join(',')));
    a.add('X', 'todo');
    a.rename('a:1', 'Y');
    expect(seen).toEqual(['X', 'Y']);
  });
});

describe('некорректные операции', () => {
  it('TypeError и неизменное состояние для мусора', () => {
    const a = createReplica('a');
    a.add('X', 'todo');
    const before = JSON.stringify([a.snapshot(), a.log(), a.stats()]);
    const bad: unknown[] = [
      null,
      42,
      'add',
      { kind: 'nope', id: 'a:9', ts: { c: 1, r: 'z' } },
      { kind: 'add', id: 'a:9', title: 1, column: 'x', ts: { c: 1, r: 'z' } },
      { kind: 'rename', id: 5, title: 'x', ts: { c: 1, r: 'z' } },
      { kind: 'move', id: 'a:1', column: 'x', ts: { c: 1.5, r: 'z' } },
      { kind: 'remove', id: 'a:1', ts: { c: -1, r: 'z' } },
      { kind: 'remove', id: 'a:1', ts: { c: 1, r: '' } },
      { kind: 'remove', id: 'a:1' },
    ];
    for (const op of bad) expect(() => a.apply(op as Op), JSON.stringify(op)).toThrow(TypeError);
    expect(JSON.stringify([a.snapshot(), a.log(), a.stats()])).toBe(before);
  });
});

describe('сходимость', () => {
  function scenario(seed: number) {
    const rand = rng(seed);
    const names = ['a', 'b', 'c'];
    const reps = names.map((n) => createReplica(n));
    const all: Op[] = [];
    for (let step = 0; step < 90; step++) {
      const r = reps[Math.floor(rand() * reps.length)]!;
      // Часть операций реплика узнаёт от других между собственными правками.
      if (rand() < 0.3) {
        const o = reps[Math.floor(rand() * reps.length)]!;
        shuffle(o.log(), rand).slice(0, 5).forEach((op) => r.apply(op));
      }
      const cards = r.snapshot();
      const roll = rand();
      let op: Op;
      if (cards.length === 0 || roll < 0.3) op = r.add(`карточка ${step}`, ['todo', 'doing', 'done'][Math.floor(rand() * 3)]!);
      else {
        const card = cards[Math.floor(rand() * cards.length)]!;
        if (roll < 0.55) op = r.rename(card.id, `имя ${step}`);
        else if (roll < 0.85) op = r.move(card.id, ['todo', 'doing', 'done'][Math.floor(rand() * 3)]!);
        else op = r.remove(card.id);
      }
      all.push(op);
    }
    return { reps, all, rand };
  }

  it('три реплики после перемешанной доставки с повторами приходят к одному состоянию (20 прогонов)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { reps, all, rand } = scenario(seed);
      const reference = createReplica('ref');
      all.forEach((op) => reference.apply(op));
      const expected = JSON.stringify(reference.snapshot());
      for (const r of reps) {
        const delivery = shuffle([...all, ...all.filter(() => rand() < 0.4).map(clone)], rand);
        delivery.forEach((op) => r.apply(op));
        expect(JSON.stringify(r.snapshot()), `seed ${seed}, реплика ${r.id}`).toBe(expected);
        expect(r.stats().orphans).toBe(0);
      }
    }
  });

  it('обмен журналами после раздельной работы: обе реплики одинаковы, повторный обмен ничего не меняет', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    a.add('A1', 'todo');
    a.add('A2', 'todo');
    b.add('B1', 'doing');
    b.apply(a.log()[0]!);
    b.rename('a:1', 'переименовано в b');
    a.move('a:2', 'done');
    const exchange = (from: Replica, to: Replica) => from.log().forEach((op) => to.apply(op));
    exchange(a, b);
    exchange(b, a);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.snapshot().map((c) => c.id)).toEqual(['a:1', 'b:1', 'a:2']);
    const settled = JSON.stringify(a.snapshot());
    exchange(a, b);
    exchange(b, a);
    expect(JSON.stringify(a.snapshot())).toBe(settled);
    expect(JSON.stringify(b.snapshot())).toBe(settled);
    expect(a.stats().applied).toBe(b.stats().applied);
  });
});

describe('DESIGN.md', () => {
  it('разделы «Решения», «Компромиссы», «Границы применимости» не короче 200 символов', () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../DESIGN.md');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    for (const h of ['Решения', 'Компромиссы', 'Границы применимости']) {
      const m = new RegExp(`^## ${h}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text);
      expect(m, h).not.toBeNull();
      expect(m![1]!.trim().length, h).toBeGreaterThanOrEqual(200);
    }
  });
});
