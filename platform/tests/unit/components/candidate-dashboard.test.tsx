import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { CandidateInvitations } from '@/components/candidate/CandidateInvitations';
import { CareerPage, filterTargets } from '@/components/candidate/CareerPage';
import type { CandidateInvitationView } from '@/server/employer/invitations';
import type { TargetRec } from '@/server/recommend/types';
import { CONSENT_TEXTS } from '@/server/consent/texts';
import type { CareerVacancy } from '@/server/recommend/career';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest}>{children}</a> }));

const target = (id: string, extra: Partial<TargetRec> = {}): CareerVacancy => ({ vacancyId: id, companyId: 'company', companyName: 'Альфа', title: 'Разработчик API', specialization: 'backend', grade: 'middle', salaryFrom: 150000, salaryTo: 200000, covered: 3, total: 5, reason: 'Закрыто 3 из 5 требований', missing: [{ catalogId: 'sql', statement: 'Оптимизация SQL' }], description: null, teamDescription: null, stack: [], matched: [], projectTaskId: null, ...extra });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); refresh.mockClear(); });

function recommendations(targets: TargetRec[]) {
  let ids: string[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/favorites') {
      if (init?.method === 'PUT') { const body = JSON.parse(String(init.body)) as { targetId: string; saved: boolean }; ids = body.saved ? [...ids, body.targetId] : ids.filter((id) => id !== body.targetId); }
      return { ok: true, status: 200, json: async () => ({ kind: 'vacancy', ids }) };
    }
    return { ok: true, status: 200, json: async () => ({ targets: url.includes('saved=true') ? targets.filter((t) => ids.includes(t.vacancyId)) : targets, truncated: false, gaps: [], tasks: [] }) };
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

it('filters real recommendations by skill, direction, grade and salary overlap', () => {
  const rows = [target('a'), target('b', { grade: 'junior', salaryFrom: 70000, salaryTo: 100000 }), target('c', { specialization: 'frontend', missing: [], title: 'React' })];
  expect(filterTargets(rows, { query: 'SQL', specialization: 'backend', grade: 'middle', salary: '180000' }).map((row) => row.vacancyId)).toEqual(['a']);
  expect(filterTargets(rows, { query: '', specialization: '', grade: '', salary: '250000' })).toEqual([]);
});

it('search and list selection update the detail panel from real vacancy IDs', async () => {
  const fetcher = recommendations([target('a'), target('b', { companyName: 'Бета', title: 'Data API' })]);
  render(<CareerPage />);
  await screen.findByText('Вакансий: 2');
  fireEvent.click(screen.getByRole('button', { name: 'Список' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Компания, роль или навык' }), { target: { value: 'Бета' } });
  expect(screen.getByText('Вакансий: 1')).toBeDefined();
  expect(within(screen.getByLabelText('Выбранная вакансия')).getAllByText('Data API')[0]).toBeDefined();
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/recommendations?target=vacancy%3Ab', expect.anything()));
});

it('persists bookmarks through the authenticated server and loads saved-only catalogue', async () => {
  const fetcher = recommendations([target('a'), target('b')]);
  const view = render(<CareerPage />);
  await screen.findByText('Вакансий: 2');
  fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить вакансию' })[0]!);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Убрать из избранного' })).toHaveLength(2));
  expect(fetcher).toHaveBeenCalledWith('/api/favorites', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ kind: 'vacancy', targetId: 'a', saved: true }) }));
  view.unmount();
  render(<CareerPage savedOnly />);
  await screen.findByText('Вакансий: 1');
  expect(fetcher).toHaveBeenCalledWith('/api/career/vacancies?saved=true', expect.anything());
  expect(screen.getByText(/с любого устройства/)).toBeDefined();
});

it('shows server failures with retry instead of invented vacancy results', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<CareerPage />);
  expect((await screen.findByRole('alert')).textContent).toContain('Нет связи с сервером');
  expect(screen.queryByText('Альфа')).toBeNull();
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeDefined();
});

const invite: CandidateInvitationView = { id: 'i1', status: 'viewed', salaryFrom: 150000, salaryTo: 200000, message: 'Подходит ваш опыт API', createdAt: '2026-10-10T09:00:00Z', respondedAt: null, company: { name: 'Альфа', description: null, contact: 'hiring@example.test' }, vacancy: { title: 'Backend', specialization: 'backend', grade: 'middle', salaryFrom: 150000, salaryTo: 200000, teamDescription: null, stack: ['Python'] } };

it('opens contacts only after successful acceptance and updates status filters', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'i1', status: 'accepted' }) }));
  vi.stubGlobal('fetch', fetcher);
  render(<CandidateInvitations invitations={[invite]} contact="@candidate" />);
  expect(screen.getByText('Связь с компанией: hiring@example.test')).toBeDefined();
  // Г5 (ADR 0005): принять можно только с отдельной неотмеченной галочкой раскрытия.
  expect((screen.getByRole('button', { name: 'Принять' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/Раскрыть этому работодателю/));
  fireEvent.click(screen.getByRole('button', { name: 'Принять' }));
  expect(await screen.findByText(/Контакты открыты/)).toBeDefined();
  expect(fetcher).toHaveBeenCalledWith('/api/invitations/i1', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'accept', disclosureVersion: CONSENT_TEXTS.identity_disclosure.version }) }));
  expect(refresh).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Жду ответа · 0' }));
  expect(screen.getByText('Здесь пока пусто.')).toBeDefined();
});

it('keeps invitation open and contacts hidden on server error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'Не удалось сохранить ответ' } }) })));
  render(<CandidateInvitations invitations={[invite]} contact={null} />);
  fireEvent.click(screen.getByLabelText(/Раскрыть этому работодателю/));
  fireEvent.click(screen.getByRole('button', { name: 'Принять' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Не удалось сохранить ответ');
  expect(screen.queryByText(/Контакты открыты/)).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});

it('loads selected saved vacancy outside first catalogue page instead of showing a different one', async () => {
  vi.stubGlobal('location', { ...window.location, search: '?vacancy=saved-late' });
  const late = target('saved-late', { companyName: 'За пределами страницы' });
  const fetcher = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url === '/api/favorites' ? { kind: 'vacancy', ids: ['saved-late'] } : url === '/api/career/vacancies?saved=true' ? { targets: [late], truncated: false } : { targets: [target('first')], truncated: true, gaps: [], tasks: [] } }));
  vi.stubGlobal('fetch', fetcher);
  render(<CareerPage />);
  await screen.findByText('Вакансий: 2');
  expect(within(screen.getByLabelText('Выбранная вакансия')).getByRole('heading', { name: 'За пределами страницы' })).toBeDefined();
  expect(fetcher).toHaveBeenCalledWith('/api/career/vacancies?saved=true', expect.anything());
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/recommendations?target=vacancy%3Asaved-late', expect.anything()));
});

it('does not silently substitute another vacancy for an unavailable saved link', async () => {
  vi.stubGlobal('location', { ...window.location, search: '?vacancy=closed' });
  const fetcher = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url === '/api/favorites' ? { kind: 'vacancy', ids: ['closed'] } : { targets: url.includes('saved=true') ? [] : [target('first')], truncated: false } }));
  vi.stubGlobal('fetch', fetcher);
  render(<CareerPage />);
  await screen.findByText(/Вакансия по ссылке недоступна/);
  expect(screen.queryByLabelText('Выбранная вакансия')).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => url.startsWith('/api/recommendations'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать другую вакансию' }));
  expect(within(screen.getByLabelText('Выбранная вакансия')).getByRole('heading', { name: 'Альфа' })).toBeDefined();
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/recommendations?target=vacancy%3Afirst', expect.anything()));
});
