// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectionStatus, RealtimeClient, ServerEvent } from '../../src/client';
import { ChatView } from '../../src/ChatView';

afterEach(cleanup);

function fakeClient() {
  let status: ConnectionStatus = 'open';
  const sl = new Set<(s: ConnectionStatus) => void>();
  const el = new Set<(e: ServerEvent) => void>();
  const client: RealtimeClient = {
    start() {},
    stop() {},
    status: () => status,
    lastEventId: () => null,
    onStatus: (l) => (sl.add(l), () => void sl.delete(l)),
    onEvent: (l) => (el.add(l), () => void el.delete(l)),
  };
  return {
    client,
    setStatus: (s: ConnectionStatus) => ((status = s), sl.forEach((l) => l(s))),
    emit: (id: number, data: unknown) => el.forEach((l) => l({ id, type: 'message', data })),
  };
}

const items = () => screen.queryAllByRole('listitem').map((li) => `${li.textContent}|${li.getAttribute('data-state')}`);

describe('чат (visible)', () => {
  it('оптимистичная отправка: pending, затем подтверждение событием сервера', () => {
    const fc = fakeClient();
    const sent: [string, string][] = [];
    render(<ChatView client={fc.client} send={async (id, text) => void sent.push([id, text])} makeId={() => 'c1'} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение' }), { target: { value: ' привет ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(sent).toEqual([['c1', 'привет']]);
    expect(items()).toEqual(['привет|pending']);
    act(() => fc.emit(1, { text: 'привет', clientId: 'c1' }));
    expect(items()).toEqual(['привет|sent']);
  });

  it('ошибка отправки: откат, алерт и возврат текста; статус «Переподключение…» блокирует кнопку', async () => {
    const fc = fakeClient();
    render(<ChatView client={fc.client} send={() => Promise.reject(new Error('нет'))} makeId={() => 'c1'} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение' }), { target: { value: 'текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await act(async () => {});
    expect(items()).toEqual([]);
    expect(screen.getByRole('alert').textContent).toBe('Не удалось отправить');
    expect((screen.getByRole('textbox', { name: 'Сообщение' }) as HTMLInputElement).value).toBe('текст');
    act(() => fc.setStatus('reconnecting'));
    expect(screen.getByRole('status').textContent).toBe('Переподключение…');
    expect((screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
