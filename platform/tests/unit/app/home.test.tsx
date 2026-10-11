import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Landing } from '@/components/landing/Landing';
import { SHOWCASE } from '@/components/landing/showcase';
import type { LandingData } from '@/components/landing/types';
import { signSession, signUserSession } from '@/server/session';

const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === 'cid' && cookieValue.value ? { name, value: cookieValue.value } : undefined }) }));
const dbCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/server/db', () => ({ prisma: new Proxy({}, { get: () => { dbCalls.n++; throw new Error('главная не должна ходить в БД'); } }) }));
const DATA: LandingData = { companies: [
  { id: 'co1', name: 'Команда А', focus: 'Разработка', description: 'Цифровые продукты', logoSrc: '/assets/companies/yandex.png', careersUrl: 'https://yandex.ru/jobs/' },
  { id: 'co2', name: 'Команда Б', focus: 'Технологии', description: null },
] };

afterEach(() => { cleanup(); cookieValue.value = undefined; });
beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterAll(() => vi.unstubAllGlobals());

describe('главная', () => {
  it('показывает разделы нового макета и пять правил', () => {
    render(<Landing data={DATA} signedIn={false} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const title of ['Сейчас нанимают.', 'За каждым навыком есть доказательство.', 'От первого разговора до предложения.', 'ИИ поможет обеим сторонам.', 'Ищи под задачу. Выбирай по доказательствам.', 'Почему это работает.', 'Покажи, что умеешь.']) {
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(`^${title.replaceAll('.', '\\s*\\.')}$`) })).toBeDefined();
    }
    const why = within(screen.getByRole('region', { name: /^Почему это работает\s*\.$/ }));
    expect(why.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([
      'Навыки с источниками', 'Категория по тесту', 'Практика дополняет профиль', 'Зарплатная вилка заранее', 'Контакты после принятия',
    ]);
    const hero = within(screen.getByRole('region', { name: /Твой код\. Твоя карьера\s*\./ }));
    expect(hero.getByRole('list').textContent).toContain('ФСП ID и достижения');
    expect(screen.queryByRole('heading', { name: 'Достижения по ФСП ID' })).toBeNull();
    expect(screen.queryByText('Данные на этой странице - иллюстрация')).toBeNull();
  });
  it('сохраняет обе кнопки начала и вход существующего пользователя', () => {
    render(<Landing data={DATA} signedIn={false} />);
    const starts = screen.getAllByRole('link', { name: /Приступим/ });
    expect(starts).toHaveLength(2);
    for (const link of starts) expect(link.getAttribute('href')).toBe('/auth?next=%2Fconsultant');
    for (const link of starts) {
      const arrow = link.querySelector('svg path');
      expect(arrow?.getAttribute('fill')).toBe('currentColor');
      expect(arrow?.getAttribute('stroke')).toBeNull();
    }
    expect(screen.getByRole('link', { name: /Уже есть аккаунт/ }).getAttribute('href')).toBe('/auth');
  });
  it('с сессией открывает кабинет без отдельного стартового знакомства', () => {
    render(<Landing data={DATA} signedIn />);
    const cabinet = screen.getAllByRole('link', { name: 'В кабинет' });
    expect(cabinet).toHaveLength(2);
    for (const link of cabinet) expect(link.getAttribute('href')).toBe('/consultant');
    expect(screen.getByRole('link', { name: /Приступим/ }).getAttribute('href')).toBe('/consultant');
  });
  it('подборка явно демонстрационная и ведёт в существующий вход', () => {
    render(<Landing data={DATA} signedIn={false} />);
    const section = within(screen.getByRole('region', { name: /^Сейчас нанимают\s*\.$/ }));
    expect(section.getByText('Демо-подборка · вымышленные компании и вакансии')).toBeDefined();
    expect(section.getByRole('link', { name: /Аврора Лабс/ }).getAttribute('href')).toBe('/auth?next=%2Fconsultant');
    expect(section.queryByText('Команда А')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Платформа в цифрах' })).toBeNull();
    expect(section.getByRole('status').textContent).toBe('4 компании ищут Backend Middle');
  });
  it('граф показывает эти же логотипы без выдуманного процента соответствия', () => {
    const { container } = render(<Landing data={DATA} signedIn={false} />);
    const graph = container.querySelector('[aria-hidden="true"] > svg')?.parentElement;
    expect(graph).toBeTruthy();
    expect(graph?.textContent).not.toMatch(/\d+%/);
    expect(graph?.querySelectorAll('img[src^="/assets/companies/"]').length).toBe(8);
  });
  it('данные публичных примеров не превращаются в фиктивную живую ленту', () => {
    render(<Landing data={{ companies: [] }} signedIn={false} />);
    expect(screen.getByText('Демо-подборка · вымышленные компании и вакансии')).toBeDefined();
    expect(screen.queryByText(/1240|86%/)).toBeNull();
  });
  it('дубли каретки скрыты от ассистивных технологий', () => {
    const { container } = render(<Landing data={SHOWCASE} signedIn={false} />);
    const section = screen.getByRole('region', { name: /^Сейчас нанимают\s*\.$/ });
    const cards = section.querySelectorAll('a[data-match]');
    expect(cards).toHaveLength(18);
    const duplicates = [...container.querySelectorAll('#companies [aria-hidden="true"] a')];
    expect(duplicates).toHaveLength(9);
    for (const duplicate of duplicates) expect(duplicate.getAttribute('tabindex')).toBe('-1');
    expect(within(section).getAllByRole('link')).toHaveLength(9);
  });
  it('знаки ФСП в шапке, под стрелкой и в подвале ведут на официальный сайт', () => {
    render(<Landing data={DATA} signedIn={false} />);
    for (const name of ['ФСП, официальный сайт', 'ФСП ID и достижения', 'ФСП']) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe('https://fsp-russia.ru/');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});

describe('публичные логотипы', () => {
  it('все восемь оригинальных изображений локальны, ссылки ведут к публичным источникам', () => {
    expect(SHOWCASE.companies).toHaveLength(8);
    expect(new Set(SHOWCASE.companies.map(c => c.id)).size).toBe(8);
    for (const company of SHOWCASE.companies) {
      expect(company.logoSrc).toMatch(/^\/assets\/companies\//);
      expect(existsSync(join(process.cwd(), 'public', company.logoSrc!))).toBe(true);
      expect(company.careersUrl).toMatch(/^https:\/\//);
    }
  });
});

describe('страница /', () => {
  it('гость видит помеченную демо-подборку без обращения к БД', async () => {
    const { default: HomePage } = await import('@/app/page');
    render(await HomePage());
    const section = within(screen.getByRole('region', { name: /^Сейчас нанимают\s*\.$/ }));
    expect(section.getAllByRole('link')).toHaveLength(9);
    expect(section.getByText('Демо-подборка · вымышленные компании и вакансии')).toBeDefined();
    expect(screen.queryByText('Данные на этой странице - иллюстрация')).toBeNull();
    expect(dbCalls.n).toBe(0);
  });
  it('валидная сессия открывает кабинет', async () => {
    cookieValue.value = signSession('cand1');
    const { default: HomePage } = await import('@/app/page');
    render(await HomePage());
    expect(screen.getAllByRole('link', { name: 'В кабинет' })).toHaveLength(2);
  });
  it('работодатель и аккаунт без роли тоже видят кабинет, а не вход', async () => {
    for (const session of [
      signUserSession({ userId: 'user1', role: 'employer', employerProfileId: 'emp1' }),
      signUserSession({ userId: 'user2', role: 'pending' }),
    ]) {
      cleanup();
      cookieValue.value = session;
      const { default: HomePage } = await import('@/app/page');
      render(await HomePage());
      const links = screen.getAllByRole('link', { name: 'В кабинет' });
      expect(links).toHaveLength(2);
      for (const link of links) expect(link.getAttribute('href')).toBe('/consultant');
    }
    expect(dbCalls.n).toBe(0);
  });
  it('поддельная сессия остаётся гостевой', async () => {
    cookieValue.value = 'cand1.9999999999.forged';
    const { default: HomePage } = await import('@/app/page');
    render(await HomePage());
    expect(screen.queryByRole('link', { name: 'В кабинет' })).toBeNull();
  });
});
