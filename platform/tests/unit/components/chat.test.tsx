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

  it('восстановленный разговор виден после загрузки, его id уходит в следующем ходе', async () => {
    const fetchMock = vi.fn(async () => new Response(streamOf([frame({ type: 'done' })]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <Chat
        initial={{
          conversationId: 'conv-old',
          items: [
            { id: 'r1', role: 'user', text: 'старый вопрос' },
            { id: 'r2', role: 'agent', event: { type: 'message', text: 'старый ответ' } },
            {
              id: 'r3',
              role: 'agent',
              event: { type: 'claims', rejected: 0, proposed: [{ id: 'cl1', statement: 'Кэш', quote: 'q', sourceRef: 'cv#1', level: 'self_reported', limits: '', status: 'proposed' }] },
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('старый вопрос')).toBeDefined();
    expect(screen.getByText('старый ответ')).toBeDefined();
    expect(screen.getByText('Кэш')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'новое' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.conversationId).toBe('conv-old');
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

describe('Chat: общая лента с онбордингом', () => {
  it('приветствие — реплика помощника со знаком ФСП, ответ пользователя — пузырь; Enter отправляет', async () => {
    const fetchMock = vi.fn(async () => new Response(streamOf([frame({ type: 'message', text: 'Принял' }) + frame({ type: 'done' })]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<Chat />);
    const greeting = screen.getByTestId('chat-greeting');
    expect(greeting.textContent).toMatch(/Пришли резюме/);
    expect(greeting.querySelector('img[src="/assets/fsp-mark.svg"]')).not.toBeNull();
    const input = screen.getByLabelText('Сообщение');
    fireEvent.change(input, { target: { value: 'привет' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Принял')).toBeDefined());
    expect(screen.getByRole('list', { name: 'Переписка с консультантом' }).textContent).toContain('привет');
  });

  it('вопрос агента с вариантами — чипы, выбор уходит ответом', async () => {
    const ask = frame({ type: 'ask', question: 'Какой стек?', options: ['Go', 'Java'] }) + frame({ type: 'done' });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response(streamOf([ask]), { status: 200 }))
      .mockImplementationOnce(async () => new Response(streamOf([frame({ type: 'done' })]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<Chat />);
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'старт' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go' })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).text).toBe('Go');
  });
});

describe('Chat: демо', () => {
  it('в демо без модели одна честная пометка в шапке; без demo — нет', () => {
    const { unmount } = render(<Chat demo={{ noLlm: true, resume: null }} />);
    expect(screen.getAllByText(/Демо-режим без языковой модели/)).toHaveLength(1);
    unmount();
    render(<Chat />);
    expect(screen.queryByText(/Демо-режим без языковой модели/)).toBeNull();
  });

  it('«Загрузить демо-резюме»: тянет PDF с сервера, грузит как обычный файл и подставляет ссылку', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url === '/api/demo/resume') return new Response(new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }), { status: 200 });
        if (url === '/api/uploads') {
          const file = (init?.body as FormData).get('file') as File;
          expect(file.name).toBe('demo-1.pdf');
          return new Response(JSON.stringify({ uploadId: 'up1', deduplicated: false, doc: { title: 'demo-1.pdf' } }), { status: 201, headers: { 'content-type': 'application/json' } });
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    render(<Chat demo={{ noLlm: true, resume: { fileName: 'demo-1.pdf', link: 'https://github.com/demo-ryabinin' } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить демо-резюме' }));
    await waitFor(() => expect(screen.getByText(/загружен/)).toBeDefined());
    expect(calls).toEqual(['GET /api/demo/resume', 'POST /api/uploads']);
    expect((screen.getByLabelText(/Ссылки/) as HTMLTextAreaElement).value).toBe('https://github.com/demo-ryabinin');
  });

  it('нет demo.resume → кнопки нет', () => {
    render(<Chat demo={{ noLlm: true, resume: null }} />);
    expect(screen.queryByRole('button', { name: 'Загрузить демо-резюме' })).toBeNull();
  });
});
