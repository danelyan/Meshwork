import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Chat } from '@/components/Chat';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const enc = new TextEncoder();
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

function streamOf(parts: string[]) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

describe('Chat', () => {
  it('отправляет сообщение и рисует разрезанный по чанкам SSE-поток', async () => {
    const full = frame({ type: 'step', text: 'читаю резюме' }) + frame({ type: 'message', text: 'Готово, смотрите' }) + frame({ type: 'done' });
    const fetchMock = vi.fn(async () => new Response(streamOf([full.slice(0, 30), full.slice(30)]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<Chat />);
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'Собери профиль' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(screen.getByText('Готово, смотрите')).toBeDefined());
    expect(screen.getByText('читаю резюме')).toBeDefined();
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ text: 'Собери профиль', uploadIds: [], urls: [] });
  });

  it('событие conversation не рисуется, его id уходит в следующем ходе', async () => {
    const first = frame({ type: 'conversation', id: 'conv-1' }) + frame({ type: 'message', text: 'Первый ответ' }) + frame({ type: 'done' });
    const second = frame({ type: 'message', text: 'Второй ответ' }) + frame({ type: 'done' });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response(streamOf([first]), { status: 200 }))
      .mockImplementationOnce(async () => new Response(streamOf([second]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<Chat />);
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'раз' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(screen.getByText('Первый ответ')).toBeDefined());
    expect(screen.queryByText('conv-1')).toBeNull();
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'два' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(screen.getByText('Второй ответ')).toBeDefined());
    const body = (i: number) => JSON.parse((fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].body as string);
    expect(body(0).conversationId).toBeUndefined();
    expect(body(1).conversationId).toBe('conv-1');
  });

  it('невалидная ссылка не отправляется', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Chat />);
    fireEvent.click(screen.getByText('Файлы и ссылки'));
    fireEvent.change(screen.getByLabelText(/Ссылки/), { target: { value: 'слово' } });
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'привет' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(screen.getByRole('alert').textContent).toContain('слово');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ошибка сети включает упрощённый режим', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed'); }));
    render(<Chat />);
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'привет' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(screen.getByText('Упрощённый режим.')).toBeDefined());
  });

  it('пустое сообщение не отправляется', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Chat />);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(screen.getByRole('alert')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
