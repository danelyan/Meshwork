// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { createFeed, type Message } from '../../src/feed';

const msg = (id: string, sentAt: number, text = id, author = 'ann'): Message => ({ id, author, text, sentAt });

describe('лента (visible)', () => {
  it('сообщения идут по серверному времени, а не по порядку прихода', () => {
    const feed = createFeed();
    feed.apply({ type: 'message', message: msg('b', 20) });
    feed.apply({ type: 'message', message: msg('a', 10) });
    expect(feed.messages().map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('повтор события с тем же id игнорируется', () => {
    const feed = createFeed();
    feed.apply({ type: 'message', message: msg('a', 10, 'первое') });
    feed.apply({ type: 'message', message: msg('a', 10, 'второе') });
    expect(feed.messages()).toEqual([msg('a', 10, 'первое')]);
  });

  it('правка меняет текст, удаление убирает сообщение', () => {
    const feed = createFeed();
    feed.apply({ type: 'message', message: msg('a', 10) });
    feed.apply({ type: 'message', message: msg('b', 20) });
    feed.apply({ type: 'edit', id: 'a', text: 'новый', editedAt: 30 });
    feed.apply({ type: 'delete', id: 'b' });
    expect(feed.messages()).toEqual([{ ...msg('a', 10, 'новый'), editedAt: 30 }]);
  });

  it('непрочитанные считаются, markRead обнуляет', () => {
    const feed = createFeed({ me: 'me' });
    feed.apply({ type: 'message', message: msg('a', 10) });
    feed.apply({ type: 'message', message: msg('b', 20, 'мой', 'me') });
    expect(feed.unreadCount()).toBe(1);
    feed.markRead();
    expect(feed.unreadCount()).toBe(0);
  });
});
