import { cleanup, render, screen, waitFor } from '@testing-library/react';

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
});

describe('ProfilePage: кнопка теста', () => {
  const rec = { test: { specialization: 'backend', grade: 'junior', reason: 'нужен тест', allowed: true }, targets: [], gaps: [], tasks: [] };
  function stubWithTest(testStatus: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/test') return { ok: testStatus < 400, status: testStatus, json: async () => ({}) };
        void init;
        const body = url.startsWith('/api/profile') ? { candidate: { id: 'x', name: 'Тест', specialization: null, fspState: 'linked' }, category: null, claims: [], byLevel: {} } : rec;
        return { ok: true, status: 200, json: async () => body };
      }),
    );
  }

  it('/test отвечает — кнопка «Пройти тест» ведёт на /test', async () => {
    stubWithTest(200);
    render(<ProfilePage />);
    const link = await screen.findByRole('link', { name: 'Пройти тест' });
    expect(link.getAttribute('href')).toBe('/test');
  });

  it('/test пока 404 — «Тест скоро» вместо ссылки', async () => {
    stubWithTest(404);
    render(<ProfilePage />);
    expect(await screen.findByTestId('test-soon')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Пройти тест' })).toBeNull();
  });
});
