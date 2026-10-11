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

  it('после успешного «Да» элемент не остаётся занятым: «Сохранить формулировку» доступна без перезагрузки', async () => {
    let confirmed = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/claims/c1/confirm') confirmed = true;
      const body = url === '/api/profile'
        ? { candidate: { id: 'x', name: 'Тест', specialization: null, fspState: 'not_linked' }, category: null, claims: [claim(confirmed ? 'confirmed' : 'proposed')], byLevel: {} }
        : url.startsWith('/api/test') ? { attempts: [] } : { targets: [], gaps: [], tasks: [], calls: [] };
      return { ok: true, status: 200, json: async () => body };
    }));
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Да' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Да' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Изменить формулировку' }));
    const save = screen.getByRole('button', { name: 'Сохранить формулировку' }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(save.getAttribute('aria-busy')).toBeNull();
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

describe('ProfilePage: индекс честности и история опроса (аудит 11.10)', () => {
  const attempt = (over: Record<string, unknown>) => ({
    id: 'att-held', specialization: 'backend', subcategoryId: 'backend.web-api', grade: 'middle', status: 'passed', theta: 0.4, pPass: 0.86,
    answered: 8, correct: 7, juniorConfirmedAt: null, kind: 'grade', confirmsAttemptId: null, rankingHold: false, startedAt: '2026-10-10T09:00:00Z', finishedAt: '2026-10-10T09:20:00Z', ...over,
  });
  function stubAll(attempts: unknown[], revisions: unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url === '/api/profile'
          ? { candidate: { id: 'x', name: 'Тест', specialization: 'backend', fspState: 'not_linked' }, category: null, claims: [claim('confirmed')], byLevel: {} }
          : url === '/api/test/attempts' ? { attempts }
          : url === '/api/onboarding/history' ? { revisions }
          : { targets: [], gaps: [], tasks: [], calls: [] };
        return { ok: true, status: 200, json: async () => body };
      }),
    );
  }

  it('категория с rankingHold: уведомление без уровня и причин ведёт к попытке; строка истории помечена', async () => {
    stubAll([attempt({ rankingHold: true })], []);
    render(<ProfilePage />);
    const note = await screen.findByTestId('ranking-hold-notice');
    expect(note.textContent).toContain('в подборках и поиске компаний пока не учитывается');
    expect(note.textContent).toContain('Это не снятие грейда');
    expect(note.textContent).not.toMatch(/списыва|высокий|индекс/i);
    expect(screen.getByRole('link', { name: 'Открыть попытку и подтвердить' }).getAttribute('href')).toBe('/test?attempt=att-held');
    expect(screen.getByTestId('test-history').textContent).toContain('в подборках пока не учитывается');
  });

  it('без rankingHold уведомления нет; история ответов опроса показывает «было → стало» и источник', async () => {
    stubAll([attempt({})], [
      { id: 'r2', stepId: 'grade', label: 'Грейд', previous: 'Junior', value: 'Middle', source: 'user', createdAt: '2026-10-11T10:00:00Z' },
      { id: 'r1', stepId: 'city', label: 'Город', previous: null, value: 'Казань', source: 'user', createdAt: '2026-10-10T10:00:00Z' },
      { id: 'r0', stepId: 'goal', label: 'Цель', previous: 'Ищу работу', value: null, source: 'reset', createdAt: '2026-10-09T10:00:00Z' },
    ]);
    render(<ProfilePage />);
    const history = await screen.findByTestId('onboarding-history');
    expect(screen.queryByTestId('ranking-hold-notice')).toBeNull();
    expect(history.textContent).toContain('История ответов опроса');
    expect(history.textContent).toContain('Грейд - Junior → Middle');
    expect(history.textContent).toContain('Город - не было → Казань');
    expect(history.textContent).toContain('Цель - Ищу работу → удалено (сброс опроса)');
  });
});

it('downloads the server PDF from every profile PDF action', async () => {
  stub([], { attempts: [], revisions: [], targets: [], gaps: [], tasks: [] });
  render(<ProfilePage />);
  const links = await screen.findAllByRole('link', { name: 'PDF-профиль' });
  for (const link of links) {
    expect(link.getAttribute('href')).toBe('/api/profile/pdf');
    expect(link.getAttribute('download')).toBe('fsp-career-profile.pdf');
  }
  expect(screen.queryByRole('button', { name: /PDF-профиль/ })).toBeNull();
});
