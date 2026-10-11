import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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

describe('ProfilePage: у блоков один дом', () => {
  it('карта глубины, пробелы и вакансии не дублируются, вместо них ссылки на дом', async () => {
    stub([claim('confirmed')], { targets: [{ vacancyId: 'v1', companyName: 'Альфа', title: 'Backend', reason: 'r' }], gaps: [], tasks: [] });
    render(<ProfilePage />);
    await screen.findByText('Писал эндпоинты');
    expect(screen.queryByText('Альфа, Backend')).toBeNull();
    expect(screen.queryByText('Карта пробелов к цели')).toBeNull();
    expect(screen.getByRole('link', { name: /Карта глубины и пробелы/ }).getAttribute('href')).toBe('/skills');
    expect(screen.getByRole('link', { name: /Подходящие вакансии/ }).getAttribute('href')).toBe('/career');
    expect(screen.getByText('Что видят компании')).toBeDefined();
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

it('refreshes anonymous employer preview immediately after confirming a claim', async () => {
  let confirmed = false;
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/claims/c1/confirm') confirmed = true;
    const body = url === '/api/profile/details' ? { basics: null, employerPreview: { displayName: 'Кандидат #ABC', category: null, specialization: null, fsp: { hasAchievements: false }, claims: confirmed ? [{ catalogId: 'be.framework', statement: 'Публичный навык' }] : [] } }
      : url === '/api/profile' ? { candidate: { id: 'x', name: 'Тест', specialization: null, fspState: 'not_linked' }, category: null, claims: [claim(confirmed ? 'confirmed' : 'proposed')], byLevel: {} }
      : url.startsWith('/api/test') ? { attempts: [] } : { targets: [], gaps: [], tasks: [], calls: [] };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ProfilePage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Да' }));
  expect(await screen.findByText('Публичный навык')).toBeDefined();
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/profile/details')).toHaveLength(2);
});
