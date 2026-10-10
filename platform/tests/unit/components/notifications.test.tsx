import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Notifications } from '@/components/shell/Notifications';
import type { NotificationFeed } from '@/server/auth/notifications';

const feed: NotificationFeed = { through: '2026-10-10T15:00:00Z', unread: 1, items: [{ id: 'i1', text: 'Новое приглашение', detail: 'Backend', href: '/invitations', at: '2026-10-10T14:00:00Z', unread: true }] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('notification menu', () => {
  it('shows loading failure and retries when the user reopens the menu', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ error: { code: 'unavailable', message: 'Нет соединения' } }, 503)).mockResolvedValueOnce(response(feed));
    vi.stubGlobal('fetch', fetchMock);
    render(<Notifications role="candidate" />);
    fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Нет соединения');
    fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }));
    fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }));
    expect((await screen.findByRole('link', { name: /Новое приглашение/ })).getAttribute('href')).toBe('/invitations');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('marks only the loaded watermark, preserves feed after failure and allows retry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(feed)).mockResolvedValueOnce(response({ error: { code: 'unavailable', message: 'Не сохранено' } }, 503)).mockResolvedValueOnce(response({ ...feed, unread: 0, items: [{ ...feed.items[0]!, unread: false }] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<Notifications role="candidate" />);
    fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }));
    await screen.findByRole('link', { name: /Новое приглашение/ });
    fireEvent.click(screen.getByRole('button', { name: 'Прочитать все' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Не сохранено');
    expect(screen.getByRole('link', { name: /Новое приглашение/ })).toBeDefined();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ through: feed.through });
    fireEvent.click(screen.getByRole('button', { name: 'Прочитать все' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Прочитать все' })).toHaveProperty('disabled', true));
    expect(screen.getByRole('link', { name: /Новое приглашение/ }).getAttribute('data-unread')).toBe('false');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Уведомления' }), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Последние уведомления' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Уведомления' }));
  });
});
