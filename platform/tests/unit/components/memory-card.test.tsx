import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MemoryCard, NEW_HIGHLIGHT_MS } from '@/components/consultant/MemoryCard';
import type { KnownFact } from '@/server/consultant/aside';

const onboardingAct = vi.fn();
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), onboardingAct: (b: unknown) => onboardingAct(b) }));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ item: {} }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  onboardingAct.mockReset();
  onboardingAct.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const facts: KnownFact[] = [
  { id: 'step:goal', source: 'onboarding', stepId: 'goal', label: 'Цель', value: 'Ищу работу', editable: true },
  { id: 'm1', source: 'chat', label: '', value: 'Пишет на Go', editable: true, createdAt: '2026-10-10T10:00:00.000Z' },
  { id: 'm2', source: 'user', label: '', value: 'Только удалёнка', editable: true },
];

describe('MemoryCard', () => {
  it('shows each item with its source and the count in the title', () => {
    render(<MemoryCard facts={facts} role="candidate" limit={20} />);
    expect(screen.getByRole('button', { name: /Что я о тебе знаю · 3/ })).toBeTruthy();
    expect(screen.getByText('Цель')).toBeTruthy();
    expect(screen.getByTitle('только тебе').textContent).toBe('только тебе');
    expect(screen.getByText('из чата')).toBeTruthy();
    expect(screen.getByText('добавлено вручную')).toBeTruthy();
    // у ответа знакомства нет «удалить»
    expect(screen.queryByRole('button', { name: 'Удалить: Ищу работу' })).toBeNull();
  });

  it('«Как видит компания»: превью анонимной карточки — публичные ответы видны, личные нет', () => {
    const withPublic: KnownFact[] = [
      ...facts,
      { id: 'step:specialization', source: 'onboarding', stepId: 'specialization', label: 'Направление', value: 'Backend', editable: true },
      { id: 'step:candidateContact', source: 'onboarding', stepId: 'candidateContact', label: 'Контакт', value: 'me@example.com', editable: true },
    ];
    render(<MemoryCard facts={withPublic} role="candidate" limit={20} />);
    expect(screen.getByText('me@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Как видит компания' }));
    expect(screen.getByText(/АНОНИМНАЯ КАРТОЧКА/)).toBeTruthy();
    expect(screen.getAllByText('Backend').length).toBeGreaterThan(0);
    expect(screen.queryByText('me@example.com')).toBeNull();
    expect(screen.queryByText('Ищу работу')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ добавить' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Как вижу я' }));
    expect(screen.getByText('me@example.com')).toBeTruthy();
  });

  it('edits a memory item inline with PATCH', async () => {
    render(<MemoryCard facts={facts} role="candidate" />);
    fireEvent.click(screen.getByRole('button', { name: 'Изменить: Пишет на Go' }));
    const input = screen.getByRole('textbox', { name: 'Поправить заметку' });
    fireEvent.change(input, { target: { value: 'Пишет на Go 3 года' } });
    fireEvent.click(screen.getByRole('button', { name: 'сохранить' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/consultant/memory/m1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ text: 'Пишет на Go 3 года' });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('deletes a memory item and hides it', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<MemoryCard facts={facts} role="candidate" />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить: Только удалёнка' }));
    await waitFor(() => expect(screen.queryByText('Только удалёнка')).toBeNull());
    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE');
  });

  it('shows the server error when deleting fails', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'not_found', message: 'Заметка не найдена' } }), { status: 404 }));
    render(<MemoryCard facts={facts} role="candidate" />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить: Только удалёнка' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Заметка не найдена');
    expect(screen.getByText('Только удалёнка')).toBeTruthy();
  });

  it('onboarding «изменить» opens the step in the feed', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<MemoryCard facts={facts} role="candidate" />);
    fireEvent.click(screen.getByTitle('Откроется этот шаг знакомства в ленте'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/consultant'));
    expect(onboardingAct).toHaveBeenCalledWith({ action: 'goto', stepId: 'goal' });
  });

  it('adds a note with POST; «+ добавить» is disabled at the limit', async () => {
    const { rerender } = render(<MemoryCard facts={facts} role="candidate" limit={20} />);
    fireEvent.click(screen.getByRole('button', { name: '+ добавить' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Новая заметка' }), { target: { value: 'Живёт в Казани' } });
    fireEvent.click(screen.getByRole('button', { name: 'сохранить' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/consultant/memory');
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
    rerender(<MemoryCard facts={facts} role="candidate" limit={2} />);
    await waitFor(() => expect((screen.getByRole('button', { name: '+ добавить' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('highlights a new item from chat for a short time', () => {
    vi.useFakeTimers();
    const { rerender } = render(<MemoryCard facts={facts} role="candidate" />);
    expect(screen.queryByText('новое')).toBeNull();
    const next: KnownFact[] = [...facts, { id: 'm3', source: 'chat', label: '', value: 'Хочет в финтех', editable: true }];
    rerender(<MemoryCard facts={next} role="candidate" />);
    expect(screen.getByText('новое')).toBeTruthy();
    expect(screen.getByTestId('memory-m3').getAttribute('data-new')).toBe('true');
    act(() => {
      vi.advanceTimersByTime(NEW_HIGHLIGHT_MS + 10);
    });
    expect(screen.queryByText('новое')).toBeNull();
  });

  it('employer title and empty state', () => {
    render(<MemoryCard facts={[]} role="employer" />);
    expect(screen.getByRole('button', { name: 'Что я знаю о компании' })).toBeTruthy();
    expect(screen.getByText(/Пока ничего/)).toBeTruthy();
  });
});
