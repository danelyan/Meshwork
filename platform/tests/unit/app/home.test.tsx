import { cleanup, render, screen, within } from '@testing-library/react';

import { Landing } from '@/components/landing/Landing';
import { SHOWCASE } from '@/components/landing/showcase';
import type { LandingData } from '@/components/landing/types';
import { signSession } from '@/server/session';

const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'cid' && cookieValue.value ? { name, value: cookieValue.value } : undefined) }),
}));
const dbCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/server/db', () => ({
  prisma: new Proxy({}, { get: () => { dbCalls.n++; throw new Error('главная не должна ходить в БД'); } }),
}));

const DATA: LandingData = {
  companies: [
    { id: 'co1', name: 'Нордстрим', focus: 'Backend, Frontend · Junior, Middle', description: 'Платежи', vacancies: 3, maxSalary: 280000 },
    { id: 'co2', name: 'Гранит', focus: 'Backend · Middle', description: null, vacancies: 1, maxSalary: 300000 },
  ],
  stats: { companies: 2, vacancies: 4, categorized: 7, maxSalary: 300000, responseRate: 91 },
};

afterEach(() => {
  cleanup();
  cookieValue.value = undefined;
});

beforeEach(() => {
  // jsdom: нет matchMedia/rAF-ритма; граф и фон работают в режиме reduced-motion (один статичный кадр)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterAll(() => vi.unstubAllGlobals());

describe('главная (лендинг)', () => {
  it('секции: hero с единственным h1, «Сейчас нанимают», 4 правила, финальный блок, футер', () => {
    render(<Landing data={DATA} signedIn={false} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Твой код.Твоя карьера.');
    expect(screen.getByRole('heading', { level: 2, name: 'Сейчас нанимают' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: 'Почему это работает' })).toBeDefined();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Тест вместо резюме', 'Вилка всегда', 'Контакты после «да»', 'ФСП в зачёт',
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Начни с профиля.' })).toBeDefined();
    expect(screen.getByText('Данные на этой странице - иллюстрация')).toBeDefined();
  });

  it('обе кнопки «Приступим →» ведут на /auth (шапка и подвал - общая оболочка, tests/unit/components/shell.test.tsx)', () => {
    render(<Landing data={DATA} signedIn={false} />);
    const start = screen.getAllByRole('link', { name: /Приступим/ });
    expect(start).toHaveLength(2);
    for (const a of start) expect(a.getAttribute('href')).toBe('/auth');
    expect(screen.getByRole('link', { name: /Уже есть аккаунт/ }).getAttribute('href')).toBe('/auth');
  });

  it('с сессией вход в hero ведёт в кабинет → /consultant', () => {
    render(<Landing data={DATA} signedIn />);
    expect(screen.getByRole('link', { name: /Ваш кабинет/ }).getAttribute('href')).toBe('/consultant');
    expect(screen.queryByRole('link', { name: /Уже есть аккаунт/ })).toBeNull();
  });

  it('числа берутся из пропсов: компании, вакансии, категоризованные, потолок вилки', () => {
    render(<Landing data={DATA} signedIn={false} />);
    const stats = within(screen.getByRole('list', { name: 'Платформа в цифрах' }));
    expect(stats.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '2компании с открытыми вакансиями',
      '4вакансии, у каждой указана зарплатная вилка',
      '7кандидатов с категорией, подтверждённой тестом',
      'до 300kверхняя граница вилки среди вакансий, ₽ в месяц',
      '91%приглашений получают ответ за сутки',
    ]);
    expect(screen.getByText('2 компании на платформе')).toBeDefined();
    // карточки компаний - реальные имена и вакансии
    const section = within(screen.getByRole('region', { name: 'Сейчас нанимают' }));
    expect(section.getByText('Нордстрим')).toBeDefined();
    expect(section.getByText(/3 вакансии/)).toBeDefined();
    expect(section.getByText('до 280k')).toBeDefined();
  });

  it('карточки витрины не используют иллюстративные цифры графа', () => {
    render(<Landing data={DATA} signedIn={false} />);
    const text = screen.getByRole('region', { name: 'Сейчас нанимают' }).textContent ?? '';
    for (const fake of ['6 940', '186', '≈ 68', '3 / нед', '92%', '84%', 'ФСП ID']) expect(text).not.toContain(fake);
  });
  it('граф соответствует исходному макету и скрыт от скринридера', () => {
    render(<Landing data={DATA} signedIn={false} />);
    expect(screen.getByText('North').closest('[aria-hidden="true"]')).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.getByText('Kernel')).toBeTruthy();
  });

  it('без вакансий: пустое состояние и без плитки «до …k»', () => {
    const empty: LandingData = { companies: [], stats: { companies: 0, vacancies: 0, categorized: 0, maxSalary: 0, responseRate: 0 } };
    render(<Landing data={empty} signedIn={false} />);
    expect(screen.getByText('Вакансий пока нет.')).toBeDefined();
    expect(screen.queryByText(/верхняя граница вилки/)).toBeNull();
  });

  it('5+ компаний: лента дублируется для бесконечной прокрутки, дубли скрыты от ассистивных технологий', () => {
    const many: LandingData = {
      ...DATA,
      companies: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, name: `Компания ${i}`, focus: 'Backend · Middle', description: null, vacancies: 1, maxSalary: 200000 })),
    };
    const { container } = render(<Landing data={many} signedIn={false} />);
    expect(container.querySelectorAll('[data-tile]')).toHaveLength(10);
    expect(container.querySelectorAll('[data-tile][aria-hidden="true"]')).toHaveLength(5);
  });
});

describe('витрина (showcase.ts)', () => {
  it('8–10 вымышленных компаний с уникальными id и именами, цифры согласованы', () => {
    const { companies, stats } = SHOWCASE;
    expect(companies.length).toBeGreaterThanOrEqual(8);
    expect(companies.length).toBeLessThanOrEqual(10);
    expect(new Set(companies.map((c) => c.id)).size).toBe(companies.length);
    expect(new Set(companies.map((c) => c.name)).size).toBe(companies.length);
    expect(stats.vacancies).toBe(companies.reduce((s, c) => s + c.vacancies, 0));
    expect(stats.maxSalary).toBe(Math.max(...companies.map((c) => c.maxSalary)));
    expect(stats.responseRate).toBeGreaterThan(0);
    expect(stats.responseRate).toBeLessThanOrEqual(100);
  });
});

describe('страница /', () => {
  it('гость: рисует витрину из фикстур, БД не вызывается', async () => {
    const { default: HomePage } = await import('@/app/page');
    render(await HomePage());
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    const section = within(screen.getByRole('region', { name: 'Сейчас нанимают' }));
    for (const c of SHOWCASE.companies) expect(section.getAllByText(c.name).length).toBeGreaterThan(0);
    expect(screen.getByText(`${SHOWCASE.stats.companies} компаний на платформе`)).toBeDefined();
    expect(screen.getByText('Данные на этой странице - иллюстрация')).toBeDefined();
    expect(dbCalls.n).toBe(0);
    expect(screen.getByRole('link', { name: /Уже есть аккаунт/ })).toBeDefined();
  });

  it('с валидной кукой cid - «Ваш кабинет»', async () => {
    cookieValue.value = signSession('cand1');
    const { default: HomePage } = await import('@/app/page');
    render(await HomePage());
    expect(screen.getByRole('link', { name: /Ваш кабинет/ })).toBeDefined();
  });

  it('с поддельной кукой - как гость', async () => {
    cookieValue.value = 'cand1.9999999999.forged';
    const { default: HomePage } = await import('@/app/page');
    render(await HomePage());
    expect(screen.queryByRole('link', { name: /Ваш кабинет/ })).toBeNull();
  });
});
