// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { createReplica } from '../../src/board';

describe('доска (visible)', () => {
  it('локальные операции видны в snapshot, add выдаёт id реплики и счётчика', () => {
    const a = createReplica('a');
    const op = a.add('Задача', 'todo');
    expect(op).toMatchObject({ kind: 'add', id: 'a:1', ts: { c: 1, r: 'a' } });
    a.move('a:1', 'done');
    expect(a.snapshot()).toEqual([{ id: 'a:1', title: 'Задача', column: 'done' }]);
  });

  it('две реплики сходятся при обратном порядке доставки и повторах', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    const add = a.add('X', 'todo');
    const ren = a.rename('a:1', 'Y');
    const rem = a.remove('a:1');
    [rem, ren, add, add, rem].forEach((op) => b.apply(op));
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.snapshot()).toEqual([]);
  });

  it('параллельные rename и move одной карточки применяются оба', () => {
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

  it('повтор операции учтён в stats и не будит подписчика', () => {
    const a = createReplica('a');
    const b = createReplica('b');
    const op = a.add('X', 'todo');
    let calls = 0;
    b.subscribe(() => (calls += 1));
    b.apply(op);
    b.apply(op);
    expect(calls).toBe(1);
    expect(b.stats()).toEqual({ applied: 1, duplicates: 1, orphans: 0 });
  });
});
