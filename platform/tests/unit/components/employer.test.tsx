import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CandidateMatchCard } from '@/components/employer/CandidateMatchCard';
import { FilterForm } from '@/components/employer/FilterForm';
import { IncomingInvitations } from '@/components/employer/IncomingInvitations';
import { InviteForm } from '@/components/employer/InviteForm';
import { VacancyForm, type CatalogOption } from '@/components/employer/VacancyForm';
import type { MatchItem } from '@/server/employer/matching';
import type { CandidateInvitationView } from '@/server/employer/invitations';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
  refresh.mockReset();
});

function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const ITEM: MatchItem = {
  candidateId: 'c1',
  rank: 1,
  score: 0.71,
  coverageScore: 0.6,
  covered: 2,
  total: 3,
  provenCount: 1,
  categoryMatch: true,
  subcategoryFit: 'exact',
  boosts: { category: 0.1, fsp: 0.05, stack: 0, specPenalty: 0 },
  explanation: {
    summary: 'Закрывает 2 из 3',
    covered: [
      { statement: 'Идемпотентность', level: 'artifact' },
      { statement: 'Транзакции', level: 'self_reported' },
    ],
    proven: ['Идемпотентность'],
    missing: ['Очереди'],
    fsp: 'есть подтверждённые достижения',
    category: 'Backend · Middle (тест)',
    subcategory: '',
    stackMatched: ['Go'],
  },
  candidate: {
    id: 'c1',
    displayName: 'Кандидат #ABC123',
    specialization: 'backend',
    category: { specialization: 'backend', grade: 'middle', label: 'Backend · Middle' },
    fsp: { state: 'linked', hasAchievements: true },
    claims: [{ catalogId: 'be.idempotency', statement: 'Идемпотентность', level: 'artifact', sourceType: 'github' }],
    contacts: null,
  },
  invitation: null,
};

describe('кабинет работодателя: компоненты', () => {
  it('карточка: псевдоним, обоснование, контакты скрыты, кнопка приглашения', () => {
    render(<ol><CandidateMatchCard item={ITEM} vacancyId="v1" defaultSalary={{ from: 200000, to: 260000 }} /></ol>);
    expect(screen.getByRole('heading', { name: /Кандидат #ABC123/ })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Закрыто 2 из 3 требований' })).toBeDefined();
    const covered = screen.getByRole('list', { name: 'Закрытые требования' });
    expect(covered.querySelectorAll('li')).toHaveLength(2);
    expect(covered.querySelector('[data-level="artifact"]')).not.toBeNull();
    expect(screen.getByText(/доказано артефактами и выше - 1/)).toBeDefined();
    expect(screen.getAllByText(/доказано: GitHub/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Очереди/)).toBeDefined();
    expect(screen.getByText(/контакты откроются/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Пригласить: Кандидат #ABC123' })).toBeDefined();
  });

  it('карточка после принятия: контакты, без кнопки; открытое приглашение — статус', () => {
    const accepted = { ...ITEM, candidate: { ...ITEM.candidate, displayName: 'Иван', contacts: { name: 'Иван', contact: '@ivan_dev' } } };
    render(<ol><CandidateMatchCard item={accepted} vacancyId="v1" /></ol>);
    expect(screen.getByText('@ivan_dev')).toBeDefined();
    cleanup();
    // контакта нет — явный текст, а не пустое место (Q-35)
    render(<ol><CandidateMatchCard item={{ ...accepted, candidate: { ...accepted.candidate, contacts: { name: 'Иван', contact: null } } }} vacancyId="v1" /></ol>);
    expect(screen.getByText('Кандидат не указал контакт')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Пригласить/ })).toBeNull();
    cleanup();
    render(<ol><CandidateMatchCard item={{ ...ITEM, invitation: { id: 'i', status: 'viewed', vacancyId: 'v1' } }} vacancyId="v1" /></ol>);
    expect(screen.getByText('просмотрено')).toBeDefined();
  });

  it('приглашение: без описания и вилки не уходит, «до» меньше «от» — ошибка; с ними — POST с потребностью', async () => {
    const fetchFn = stubFetch({ id: 'inv', status: 'sent' });
    render(<InviteForm candidateId="c1" candidateName="Кандидат #A" vacancyId="v1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить: Кандидат #A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить приглашение' }));
    expect(await screen.findByText(/хотя бы в 10 символах/)).toBeDefined();
    expect(screen.getAllByText('Укажи сумму в рублях')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Что предлагаешь'), { target: { value: 'Платёжная команда, Go' } });
    fireEvent.change(screen.getByLabelText('Зарплата от, ₽ в месяц'), { target: { value: '260 000' } });
    fireEvent.change(screen.getByLabelText('до, ₽ в месяц'), { target: { value: '230000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить приглашение' }));
    expect(await screen.findByText('«До» не может быть меньше «от»')).toBeDefined();
    expect(fetchFn).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Зарплата от, ₽ в месяц'), { target: { value: '230 000' } });
    fireEvent.change(screen.getByLabelText('до, ₽ в месяц'), { target: { value: '260 000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить приглашение' }));
    expect(await screen.findByText(/Приглашение отправлено/)).toBeDefined();
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/employer/invitations');
    expect(JSON.parse(init.body as string)).toEqual({ candidateId: 'c1', vacancyId: 'v1', message: 'Платёжная команда, Go', salaryFrom: 230000, salaryTo: 260000 });
  });

  it('ошибка лимита показывается текстом сервера', async () => {
    stubFetch({ error: { code: 'rate_limited', message: 'Лимит: не больше 20 приглашений от компании за сутки' } }, 429);
    render(<InviteForm candidateId="c1" candidateName="К" vacancyId={null} defaultSalaryFrom={100000} defaultSalaryTo={150000} />);
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить: К' }));
    fireEvent.change(screen.getByLabelText('Что предлагаешь'), { target: { value: 'Платёжная команда, Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить приглашение' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Лимит: не больше 20 приглашений от компании за сутки');
  });

  it('фильтры: GET-форма с текущими значениями', () => {
    const { container } = render(<FilterForm action="/employer/search" filters={{ specialization: 'frontend', stack: ['React'], fsp: true }} />);
    const form = container.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('get');
    expect(form.getAttribute('action')).toBe('/employer/search');
    expect((screen.getByLabelText('Направление') as HTMLSelectElement).value).toBe('frontend');
    expect((screen.getByLabelText(/Стек/) as HTMLInputElement).value).toBe('React');
    expect((screen.getByLabelText('есть достижения ФСП') as HTMLInputElement).checked).toBe(true);
  });

  it('форма потребности: требования из каталога, проверка вилки, POST', async () => {
    const catalog: CatalogOption[] = [
      { id: 'be.orm', specialization: 'backend', statement: 'ORM', grades: ['junior'], weight: 2 },
      { id: 'fe.a11y', specialization: 'frontend', statement: 'Доступность', grades: ['junior'], weight: 2 },
      { id: 'common.git', specialization: 'common', statement: 'Git', grades: ['junior'], weight: 1 },
    ];
    const fetchFn = stubFetch({ id: 'v9' });
    render(<VacancyForm catalog={catalog} />);
    expect(screen.getByRole('button', { name: 'ORM' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Доступность' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Кого ищешь'), { target: { value: 'Backend' } });
    fireEvent.change(screen.getByLabelText('Зарплата от, ₽'), { target: { value: '200000' } });
    fireEvent.change(screen.getByLabelText('Зарплата до, ₽'), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать и показать подборку' }));
    expect(await screen.findByText('Верхняя граница меньше нижней')).toBeDefined();
    expect(screen.getByText('Выбери подкатегорию: подборка ищет по ней')).toBeDefined();
    fireEvent.change(screen.getByLabelText(/^Подкатегория/), { target: { value: 'backend.integrations' } });
    fireEvent.change(screen.getByLabelText('Зарплата до, ₽'), { target: { value: '250000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Git' }));
    fireEvent.click(screen.getByRole('button', { name: 'Git' }));
    fireEvent.change(screen.getByLabelText(/^Стек/), { target: { value: 'Go, Kafka' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать и показать подборку' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/employer/needs/v9'));
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ title: 'Backend', subcategoryId: 'backend.integrations', salaryFrom: 200000, salaryTo: 250000, stack: ['Go', 'Kafka'] });
    expect(body.needs.map((n: { catalogId: string }) => n.catalogId).sort()).toEqual(['be.orm', 'common.git']);
  });
});

describe('входящие приглашения кандидата', () => {
  const INV: CandidateInvitationView = {
    id: 'i1',
    status: 'viewed',
    salaryFrom: 230000,
    salaryTo: 260000,
    message: 'Платёжная команда',
    createdAt: '2026-10-09T08:00:00.000Z',
    respondedAt: null,
    company: { name: 'Северный Поток', description: null, contact: '@northstream_hr' },
    vacancy: { title: 'Backend платежей', specialization: 'backend', grade: 'middle', salaryFrom: 200000, salaryTo: 280000, teamDescription: 'Переводы', stack: ['Go'] },
  };

  it('пусто — честное пустое состояние', () => {
    render(<IncomingInvitations invitations={[]} />);
    expect(screen.getByRole('status').textContent).toMatch(/Приглашений пока нет/);
  });

  it('до принятия видны компания, описание, вилка и способ связи; принять — POST и статус «принято»', async () => {
    const fetchFn = stubFetch({ id: 'i1', status: 'accepted' });
    render(<IncomingInvitations invitations={[INV]} />);
    expect(screen.getByRole('heading', { name: 'Backend платежей' })).toBeDefined();
    expect(screen.getByText('Северный Поток')).toBeDefined();
    expect(screen.getByText('Платёжная команда')).toBeDefined();
    expect(screen.getByText('230 000 - 260 000 ₽ в месяц')).toBeDefined();
    expect(screen.getByText('Связь с компанией: @northstream_hr')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Принять' }));
    expect(await screen.findByText('принято')).toBeDefined();
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('/api/invitations/i1');
    expect(screen.queryByRole('button', { name: 'Отклонить' })).toBeNull();
  });

  it('компания без способа связи — явный текст', () => {
    render(<IncomingInvitations invitations={[{ ...INV, company: { ...INV.company, contact: null } }]} />);
    expect(screen.getByText('Связь с компанией: Компания не указала способ связи')).toBeDefined();
  });
});
