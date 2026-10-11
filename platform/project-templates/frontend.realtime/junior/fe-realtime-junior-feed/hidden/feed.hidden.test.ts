// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { describe, expect, it, vi } from 'vitest';

import { createFeed, type FeedEvent, type Message } from '../src/feed';

const msg = (id: string, sentAt: number, text = id, author = 'ann'): Message => ({ id, author, text, sentAt });
const add = (m: Message): FeedEvent => ({ type: 'message', message: m });
const ids = (f: ReturnType<typeof createFeed>) => f.messages().map((m) => m.id);

describe('добавление и порядок', () => {
  it('пустая лента: нет сообщений и непрочитанных', () => {
    const f = createFeed();
    expect(f.messages()).toEqual([]);
    expect(f.unreadCount()).toBe(0);
  });

  it('порядок по sentAt, при равенстве – по id', () => {
    const f = createFeed();
    [add(msg('c', 5)), add(msg('b', 5)), add(msg('z', 1)), add(msg('a', 9))].forEach((e) => f.apply(e));
    expect(ids(f)).toEqual(['z', 'b', 'c', 'a']);
  });

  it('повтор с другим текстом не перезаписывает сообщение', () => {
    const f = createFeed();
    f.apply(add(msg('a', 1, 'первое')));
    f.apply(add(msg('a', 99, 'второе')));
    expect(f.messages()).toEqual([msg('a', 1, 'первое')]);
  });

  it('messages() возвращает копии, у сообщения без правок нет поля editedAt', () => {
    const f = createFeed();
    f.apply(add(msg('a', 1)));
    const first = f.messages();
    first[0]!.text = 'испорчено';
    first.pop();
    expect(f.messages()).toEqual([msg('a', 1)]);
    expect('editedAt' in f.messages()[0]!).toBe(false);
  });
});

describe('правки', () => {
  it('правка ставит text и editedAt, порядок и sentAt не меняются', () => {
    const f = createFeed();
    f.apply(add(msg('a', 1)));
    f.apply(add(msg('b', 2)));
    f.apply({ type: 'edit', id: 'a', text: 'исправлено', editedAt: 50 });
    expect(f.messages()).toEqual([{ ...msg('a', 1, 'исправлено'), editedAt: 50 }, msg('b', 2)]);
  });

  it('устаревшая или равная правка игнорируется', () => {
    const f = createFeed();
    f.apply(add(msg('a', 1)));
    f.apply({ type: 'edit', id: 'a', text: 'v2', editedAt: 20 });
    f.apply({ type: 'edit', id: 'a', text: 'v1', editedAt: 10 });
    f.apply({ type: 'edit', id: 'a', text: 'v2-bis', editedAt: 20 });
    expect(f.messages()[0]).toMatchObject({ text: 'v2', editedAt: 20 });
    f.apply({ type: 'edit', id: 'a', text: 'v3', editedAt: 21 });
    expect(f.messages()[0]).toMatchObject({ text: 'v3', editedAt: 21 });
  });

  it('правка неизвестного id игнорируется и не запоминается', () => {
    const f = createFeed();
    f.apply({ type: 'edit', id: 'a', text: 'раньше времени', editedAt: 5 });
    f.apply(add(msg('a', 1, 'оригинал')));
    expect(f.messages()).toEqual([msg('a', 1, 'оригинал')]);
  });
});

describe('удаление', () => {
  it('удаление убирает сообщение, повторное безвредно', () => {
    const f = createFeed();
    f.apply(add(msg('a', 1)));
    f.apply(add(msg('b', 2)));
    f.apply({ type: 'delete', id: 'a' });
    f.apply({ type: 'delete', id: 'a' });
    expect(ids(f)).toEqual(['b']);
  });

  it('удалённое сообщение не воскресает от повтора и от опоздавшего message', () => {
    const f = createFeed();
    f.apply({ type: 'delete', id: 'ghost' });
    f.apply(add(msg('ghost', 1)));
    f.apply(add(msg('a', 2)));
    f.apply({ type: 'delete', id: 'a' });
    f.apply(add(msg('a', 2)));
    expect(f.messages()).toEqual([]);
  });

  it('правка удалённого сообщения ничего не возвращает', () => {
    const f = createFeed();
    f.apply(add(msg('a', 1)));
    f.apply({ type: 'delete', id: 'a' });
    f.apply({ type: 'edit', id: 'a', text: 'зомби', editedAt: 9 });
    expect(f.messages()).toEqual([]);
  });
});

describe('непрочитанные', () => {
  it('свои сообщения не считаются, чужие считаются', () => {
    const f = createFeed({ me: 'me' });
    f.apply(add(msg('a', 1, 'a', 'ann')));
    f.apply(add(msg('b', 2, 'b', 'me')));
    f.apply(add(msg('c', 3, 'c', 'bob')));
    expect(f.unreadCount()).toBe(2);
  });

  it('без options.me все сообщения непрочитанные', () => {
    const f = createFeed();
    f.apply(add(msg('a', 1, 'a', 'me')));
    expect(f.unreadCount()).toBe(1);
  });

  it('повтор, правка не меняют счётчик; удаление непрочитанного уменьшает; после markRead новые считаются заново', () => {
    const f = createFeed();
    f.apply(add(msg('a', 1)));
    f.apply(add(msg('a', 1)));
    f.apply(add(msg('b', 2)));
    f.apply({ type: 'edit', id: 'a', text: 'x', editedAt: 3 });
    expect(f.unreadCount()).toBe(2);
    f.apply({ type: 'delete', id: 'b' });
    expect(f.unreadCount()).toBe(1);
    f.markRead();
    f.apply({ type: 'delete', id: 'a' });
    expect(f.unreadCount()).toBe(0);
    f.apply(add(msg('c', 4)));
    expect(f.unreadCount()).toBe(1);
  });
});

describe('подписка', () => {
  it('слушатель вызывается на изменения и не вызывается на игнорируемые события', () => {
    const f = createFeed();
    const spy = vi.fn();
    f.subscribe(spy);
    f.apply(add(msg('a', 1)));
    expect(spy).toHaveBeenCalledTimes(1);
    f.apply(add(msg('a', 1)));
    f.apply({ type: 'edit', id: 'zzz', text: 'x', editedAt: 1 });
    f.apply({ type: 'delete', id: 'zzz' });
    expect(spy).toHaveBeenCalledTimes(1);
    f.apply({ type: 'edit', id: 'a', text: 'x', editedAt: 5 });
    f.apply({ type: 'edit', id: 'a', text: 'y', editedAt: 4 });
    f.apply({ type: 'delete', id: 'a' });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('markRead уведомляет только при ненулевом счётчике; к моменту вызова состояние уже новое', () => {
    const f = createFeed();
    const seen: number[] = [];
    f.apply(add(msg('a', 1)));
    f.subscribe(() => seen.push(f.unreadCount()));
    f.markRead();
    f.markRead();
    expect(seen).toEqual([0]);
  });

  it('отписка работает, несколько слушателей независимы', () => {
    const f = createFeed();
    const a = vi.fn();
    const b = vi.fn();
    const off = f.subscribe(a);
    f.subscribe(b);
    f.apply(add(msg('a', 1)));
    off();
    f.apply(add(msg('b', 2)));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});

describe('валидация', () => {
  it('некорректные события бросают TypeError и не меняют ленту', () => {
    const f = createFeed();
    f.apply(add(msg('a', 1)));
    const bad: unknown[] = [
      null,
      'message',
      { type: 'unknown', id: 'a' },
      { type: 'delete', id: '' },
      { type: 'delete', id: 5 },
      { type: 'edit', id: 'a', text: 5, editedAt: 1 },
      { type: 'edit', id: 'a', text: 'x', editedAt: Number.NaN },
      { type: 'message', message: { id: 'b', author: 'x', text: 'x', sentAt: Number.POSITIVE_INFINITY } },
      { type: 'message', message: { id: 'b', author: 'x', text: 7, sentAt: 1 } },
      { type: 'message', message: { id: '', author: 'x', text: 'x', sentAt: 1 } },
    ];
    for (const e of bad) expect(() => f.apply(e as FeedEvent), JSON.stringify(e)).toThrow(TypeError);
    expect(f.messages()).toEqual([msg('a', 1)]);
    expect(f.unreadCount()).toBe(1);
  });
});
