// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatView } from '../src/ChatView';

import { fakeClient, sender } from './helpers/fakes';

afterEach(cleanup);

const input = () => screen.getByRole('textbox', { name: 'Сообщение' }) as HTMLInputElement;
const button = () => screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement;
const items = () => screen.queryAllByRole('listitem').map((li) => `${li.textContent}|${li.getAttribute('data-state')}`);
const typeText = (v: string) => fireEvent.change(input(), { target: { value: v } });
const submit = () => fireEvent.click(button());
const status = () => screen.getByRole('status').textContent;

let n = 0;
function setup(initial: 'open' | 'connecting' | 'reconnecting' | 'closed' = 'open') {
  n = 0;
  const fc = fakeClient(initial);
  const s = sender();
  const view = render(<ChatView client={fc.client} send={s.send} makeId={() => `id${++n}`} />);
  return { fc, s, view };
}

describe('статус и подписки', () => {
  it('текст статуса следует за состоянием клиента, начиная с момента монтирования', () => {
    const { fc } = setup('connecting');
    expect(status()).toBe('Подключение…');
    act(() => fc.setStatus('open'));
    expect(status()).toBe('Подключено');
    act(() => fc.setStatus('reconnecting'));
    expect(status()).toBe('Переподключение…');
    act(() => fc.setStatus('closed'));
    expect(status()).toBe('Отключено');
  });

  it('кнопка недоступна, пока статус не open', () => {
    const { fc } = setup('reconnecting');
    expect(button().disabled).toBe(true);
    act(() => fc.setStatus('open'));
    expect(button().disabled).toBe(false);
    act(() => fc.setStatus('closed'));
    expect(button().disabled).toBe(true);
  });

  it('отписка при размонтировании', () => {
    const { fc, view } = setup();
    expect(fc.listeners()).toEqual({ status: 1, event: 1 });
    view.unmount();
    expect(fc.listeners()).toEqual({ status: 0, event: 0 });
  });
});

describe('входящие сообщения', () => {
  it('message добавляется в конец с data-state=sent; прочие типы и некорректные данные не показываются', () => {
    const { fc } = setup();
    act(() => {
      fc.emit(1, { text: 'привет' });
      fc.emit(2, { text: 'тик' }, 'typing');
      fc.emit(3, { text: 5 });
      fc.emit(4, null);
      fc.emit(5, 'строка');
      fc.emit(6, { text: 'пока', clientId: 'чужой' });
    });
    expect(items()).toEqual(['привет|sent', 'пока|sent']);
  });
});

describe('оптимистичная отправка', () => {
  it('текст обрезается, сообщение сразу pending в конце, поле очищено, send вызван один раз', () => {
    const { fc, s } = setup();
    act(() => fc.emit(1, { text: 'старое' }));
    typeText('  новое  ');
    submit();
    expect(items()).toEqual(['старое|sent', 'новое|pending']);
    expect(input().value).toBe('');
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ clientId: 'id1', text: 'новое' });
  });

  it('пустой текст и статус не open: отправки нет', () => {
    const { fc, s } = setup();
    typeText('   ');
    submit();
    act(() => fc.setStatus('reconnecting'));
    typeText('текст');
    fireEvent.submit(input().closest('form')!);
    expect(s.calls).toHaveLength(0);
    expect(items()).toEqual([]);
    expect(input().value).toBe('текст');
  });

  it('submit формы (Enter) отправляет так же, как кнопка', () => {
    const { s } = setup();
    typeText('через форму');
    fireEvent.submit(input().closest('form')!);
    expect(s.calls).toHaveLength(1);
    expect(items()).toEqual(['через форму|pending']);
  });

  it('успех send сам по себе не подтверждает: пункт остаётся pending до события сервера', async () => {
    const { s } = setup();
    typeText('x');
    submit();
    await act(async () => s.calls[0]!.resolve());
    expect(items()).toEqual(['x|pending']);
  });

  it('событие с clientId заменяет ожидающее: один пункт, серверный текст, на месте прихода события', () => {
    const { fc } = setup();
    typeText('мой');
    submit();
    act(() => fc.emit(1, { text: 'чужой раньше' }));
    expect(items()).toEqual(['мой|pending', 'чужой раньше|sent']);
    act(() => fc.emit(2, { text: 'мой (сервер)', clientId: 'id1' }));
    expect(items()).toEqual(['чужой раньше|sent', 'мой (сервер)|sent']);
  });

  it('два ожидающих подтверждаются независимо, в любом порядке', () => {
    const { fc } = setup();
    typeText('один');
    submit();
    typeText('два');
    submit();
    act(() => fc.emit(1, { text: 'два', clientId: 'id2' }));
    expect(items()).toEqual(['один|pending', 'два|sent']);
    act(() => fc.emit(2, { text: 'один', clientId: 'id1' }));
    expect(items()).toEqual(['два|sent', 'один|sent']);
  });
});

describe('откат при ошибке', () => {
  it('отказ до подтверждения: пункт убран, алерт, текст возвращён в пустое поле', async () => {
    const { s } = setup();
    typeText('важное');
    submit();
    await act(async () => s.calls[0]!.reject(new Error('сеть')));
    expect(items()).toEqual([]);
    expect(screen.getByRole('alert').textContent).toBe('Не удалось отправить');
    expect(input().value).toBe('важное');
  });

  it('если пользователь уже набирает другое, поле не трогаем', async () => {
    const { s } = setup();
    typeText('первое');
    submit();
    typeText('второе');
    await act(async () => s.calls[0]!.reject(new Error('x')));
    expect(input().value).toBe('второе');
    expect(items()).toEqual([]);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('отказ после подтверждения ничего не меняет', async () => {
    const { fc, s } = setup();
    typeText('ok');
    submit();
    act(() => fc.emit(1, { text: 'ok', clientId: 'id1' }));
    await act(async () => s.calls[0]!.reject(new Error('поздно')));
    expect(items()).toEqual(['ok|sent']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input().value).toBe('');
  });

  it('алерт исчезает при следующей принятой отправке; откатывается только упавшее', async () => {
    const { s } = setup();
    typeText('a');
    submit();
    typeText('b');
    submit();
    await act(async () => s.calls[0]!.reject(new Error('x')));
    expect(items()).toEqual(['b|pending']);
    expect(screen.getByRole('alert')).toBeTruthy();
    typeText('пусто');
    fireEvent.submit(input().closest('form')!);
    expect(screen.queryByRole('alert')).toBeNull();
    typeText('   ');
    submit();
    expect(s.calls).toHaveLength(3);
  });
});
