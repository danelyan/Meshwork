import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ProfilePage } from '@/components/ProfilePage';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const claim = (status: string) => ({
  id: 'c1', catalogId: 'be.framework', statement: 'Писал эндпоинты', level: 'self_reported', quote: 'q', sourceRef: 'r',
  sourceKind: 'resume', limits: '', suggestedProof: [], status, createdAt: '2026-10-01T00:00:00Z', confirmedAt: null,
});

function stub(claims: unknown[], recs: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.startsWith('/api/profile') ? { candidate: { id: 'x', name: 'Тест', specialization: null, fspState: 'linked' }, category: null, claims, byLevel: {} } : recs;
      return { ok: true, status: 200, json: async () => body };
    }),
  );
}

describe('ProfilePage: вакансии', () => {
  it('нет подтверждённых утверждений → объясняет, почему вакансий нет', async () => {
    stub([claim('proposed')], { targets: [], gaps: [], tasks: [] });
    render(<ProfilePage />);
    const note = await screen.findByTestId('targets-empty');
    expect(note.textContent).toContain('пока подтверждённых нет');
    expect(note.textContent).toContain('Подтвердите карточки');
  });

  it('утверждения подтверждены, вакансий нет → другая фраза', async () => {
    stub([claim('confirmed')], { targets: [], gaps: [], tasks: [] });
    render(<ProfilePage />);
    const note = await screen.findByTestId('targets-empty');
    expect(note.textContent).toContain('подходящих вакансий пока нет');
    expect(note.textContent).not.toContain('пока подтверждённых нет');
  });

  it('есть цели → список вакансий', async () => {
    stub([claim('confirmed')], { targets: [{ vacancyId: 'v1', companyName: 'Альфа', title: 'Backend', reason: 'закрываешь 4 из 6' }], gaps: [], tasks: [] });
    render(<ProfilePage />);
    await waitFor(() => expect(screen.getByText('Альфа, Backend')).toBeDefined());
    expect(screen.queryByTestId('targets-empty')).toBeNull();
  });

  it('сохраняет пользовательскую формулировку через API и обновляет профиль', async () => {
    let edited = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/claims/c1/edit') edited = true;
      const body = url === '/api/profile'
        ? { candidate: { id: 'x', name: 'Тест', specialization: null, fspState: 'not_linked' }, category: null, claims: [{ ...claim('confirmed'), statement: edited ? 'Разработал API для заказов' : 'Писал эндпоинты' }], byLevel: {} }
        : url.startsWith('/api/test') ? { attempts: [] } : { targets: [], gaps: [], tasks: [], calls: [] };
      void init;
      return { ok: true, status: 200, json: async () => body };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить формулировку' }));
    fireEvent.change(screen.getByLabelText('Уточните формулировку'), { target: { value: 'Разработал API для заказов' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить формулировку' }));
    await screen.findByText('Разработал API для заказов');
    expect(fetcher).toHaveBeenCalledWith('/api/claims/c1/edit', expect.objectContaining({ method: 'POST', body: JSON.stringify({ statement: 'Разработал API для заказов' }) }));
    expect(screen.queryByLabelText('Уточните формулировку')).toBeNull();
    expect(screen.queryByText(/профиль виден только вам/)).toBeNull();
  });
});
