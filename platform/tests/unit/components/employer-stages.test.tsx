// Карточка кандидата: блоки ступеней 1–3 (ADR 0003), вопросы кандидату, комната защиты.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { CandidateMatchCard } from '@/components/employer/CandidateMatchCard';
import type { MatchItem } from '@/server/employer/matching';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = handler(url, init);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const BASE: MatchItem = {
  candidateId: 'c1',
  rank: 1,
  score: 0.9,
  coverageScore: 0.6,
  covered: 1,
  total: 2,
  provenCount: 0,
  categoryMatch: true,
  subcategoryFit: 'exact',
  boosts: { category: 0.1, fsp: 0, stack: 0, specPenalty: 0 },
  explanation: {
    summary: 'x',
    covered: [],
    proven: [],
    missing: [],
    fsp: 'не привязан',
    category: 'Backend · Middle (тест)',
    subcategory: '',
    stackMatched: [],
    depthMap: {
      confirmed: 1,
      matchedNeed: 1,
      topics: [
        { topic: 'Идемпотентность', catalogId: 'be.idempotency', claimed: true, probed: 3, confirmed: true, total: 7, forNeed: true },
        { topic: 'Очереди', catalogId: 'be.message-queue', claimed: true, probed: 2, confirmed: false, total: 2, forNeed: false },
        { topic: 'Деплой', catalogId: null, claimed: false, probed: 0, confirmed: false, total: 0, forNeed: false },
      ],
    },
    project: {
      own: {
        score: 0.8,
        tests: { passed: 4, total: 5 },
        late: false,
        checkedAt: '2026-10-10T10:00:00.000Z',
        flags: ['evidence_unverified'],
        criteria: [
          { id: 'r1', text: 'Идемпотентность платежа', source: 'required', passed: true, evidence: 'ключ хранится в таблице', file: 'src/pay.ts' },
          { id: 'r2', text: 'Ретраи с бэкоффом', source: 'wish', passed: false, evidence: '' },
        ],
      },
      others: [{ subcategoryId: 'backend.web-api', subcategory: 'Web API', score: 0.55 }],
    },
    defense: { score: 3, passed: false, flags: ['strong_project_weak_defense'], notes: ['Это пометка для разговора, а не штраф и не вывод о подлинности.'] },
  },
  candidate: {
    id: 'c1',
    displayName: 'Кандидат #ABC123',
    specialization: 'backend',
    category: { specialization: 'backend', grade: 'middle', label: 'Backend · Middle' },
    fsp: { state: 'not_linked', hasAchievements: false },
    claims: [],
    contacts: null,
  },
  invitation: null,
  defenseRoom: { sessionId: 'room-1', status: 'pending' },
};

const render1 = (item: MatchItem) => render(<ol><CandidateMatchCard item={item} vacancyId="v1" /></ol>);
const ACCEPTED: MatchItem = { ...BASE, candidate: { ...BASE.candidate, displayName: 'Иван', contacts: { name: 'Иван', contact: '@ivan' } } };

describe('карточка: ступени 1–3', () => {
  it('карта глубины: тема → подтверждено / не подтверждено / не спрашивали; цитат нет', () => {
    render1(BASE);
    const block = screen.getByRole('region', { name: 'Созвон: карта глубины' });
    expect(within(block).getByText(/Подтверждено 1 из 3 тем/)).toBeDefined();
    const items = within(block).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(items[0]).toMatch(/Идемпотентность - подтверждено.*оценка 7 из 8.*требование вакансии/);
    expect(items[1]).toMatch(/Очереди - не подтверждено/);
    expect(items[2]).toMatch(/Деплой - не спрашивали/);
  });

  it('проект: своя потребность — таблица критериев; чужая — только подкатегория и балл', () => {
    render1(BASE);
    const block = screen.getByRole('region', { name: 'Проект' });
    expect(within(block).getByText(/скрытые тесты 4 из 5 \(80%\)/)).toBeDefined();
    const table = within(block).getByRole('table', { name: 'Критерии проекта' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toMatch(/Идемпотентность платежа.*обязательный.*прошёл.*ключ хранится в таблице.*src\/pay\.ts/);
    expect(rows[2]!.textContent).toMatch(/Ретраи с бэкоффом.*пожелание.*не прошёл/);
    expect(within(block).getByText(/Флаги проверки: доказательство не нашли в коде/)).toBeDefined();
    expect(within(block).getByText('Есть проверенный проект в подкатегории Web API, балл 55%')).toBeDefined();
  });

  it('проект только под чужую потребность: таблицы нет', () => {
    const project = { own: null, others: BASE.explanation.project!.others };
    render1({ ...BASE, explanation: { ...BASE.explanation, project } });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/подкатегории Web API, балл 55%/)).toBeDefined();
  });

  it('защита: балл по рубрике и флаг как пометка', () => {
    render1(BASE);
    const block = screen.getByRole('region', { name: 'Защита' });
    expect(within(block).getByText(/Балл по рубрике A-02: 3 из 8 - ниже порога/)).toBeDefined();
    expect(within(block).getByText(/пометка для разговора, а не штраф/)).toBeDefined();
  });

  it('без ступеней блоков нет', () => {
    const ex = { ...BASE.explanation };
    delete ex.depthMap;
    delete ex.project;
    delete ex.defense;
    render1({ ...BASE, explanation: ex, defenseRoom: null });
    expect(screen.queryByRole('region', { name: /Созвон|Проект|Защита/ })).toBeNull();
  });
});

describe('карточка: вопросы кандидату и комната защиты', () => {
  it('до принятого приглашения вопросов и комнаты нет', () => {
    const f = stubFetch(() => ({ body: { questions: [] } }));
    render1(BASE);
    expect(screen.queryByRole('region', { name: 'Вопросы кандидату' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Комната защиты' })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('после принятия: ссылка в комнату, список своих вопросов со статусом, отправка нового', async () => {
    const asked = { id: 'q1', text: 'Как хранится ключ?', status: 'queued', askedAt: 'x', answer: null };
    const answered = { id: 'q0', text: 'Почему Kafka?', status: 'answered', askedAt: 'x', answer: 'Из-за порядка' };
    let questions: unknown[] = [answered];
    const f = stubFetch((url, init) => {
      if (init?.method === 'POST') {
        questions = [asked, answered];
        return { status: 201, body: asked };
      }
      return { body: { questions } };
    });
    render1(ACCEPTED);
    const link = screen.getByRole('link', { name: 'Комната защиты' });
    expect(link.getAttribute('href')).toBe('/employer/calls/room-1');
    expect(screen.getByText(/ждёт кандидата/)).toBeDefined();
    const block = screen.getByRole('region', { name: 'Вопросы кандидату' });
    expect(await within(block).findByText('Почему Kafka?')).toBeDefined();
    expect(within(block).getByText('есть ответ')).toBeDefined();
    expect(within(block).getByText(/Ответ кандидата: Из-за порядка/)).toBeDefined();
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/employer/questions?candidateId=c1');

    fireEvent.click(within(block).getByRole('button', { name: 'Задать вопрос' }));
    expect(await within(block).findByText('Вопрос хотя бы из 5 символов')).toBeDefined();
    fireEvent.change(within(block).getByLabelText('Ваш вопрос'), { target: { value: 'Как хранится ключ?' } });
    fireEvent.click(within(block).getByRole('button', { name: 'Задать вопрос' }));
    expect(await within(block).findByText('Как хранится ключ?')).toBeDefined();
    expect(within(block).getByText('в очереди')).toBeDefined();
    const post = f.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST') as unknown as [string, RequestInit];
    expect(post[0]).toBe('/api/employer/questions');
    expect(JSON.parse(post[1].body as string)).toEqual({ candidateId: 'c1', text: 'Как хранится ключ?' });
  });

  it('нет сессии защиты — кнопки нет; ошибка отправки показывается текстом сервера', async () => {
    stubFetch((url, init) =>
      init?.method === 'POST' ? { status: 429, body: { error: { code: 'rate_limited', message: 'В очереди уже 10 вопросов' } } } : { body: { questions: [] } },
    );
    render1({ ...ACCEPTED, defenseRoom: null });
    expect(screen.queryByRole('link', { name: 'Комната защиты' })).toBeNull();
    const block = screen.getByRole('region', { name: 'Вопросы кандидату' });
    await waitFor(() => expect(within(block).getByText(/Вопросов пока нет/)).toBeDefined());
    fireEvent.change(within(block).getByLabelText('Ваш вопрос'), { target: { value: 'Расскажи про ретраи' } });
    fireEvent.click(within(block).getByRole('button', { name: 'Задать вопрос' }));
    expect(await within(block).findByText('В очереди уже 10 вопросов')).toBeDefined();
  });
});
