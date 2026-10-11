import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Landing } from '@/components/landing/Landing';
import { SHOWCASE } from '@/components/landing/showcase';
import type { LandingData } from '@/components/landing/types';
import { signSession } from '@/server/session';

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
  it('показывает шесть правил, ИИ-помощника и честное описание демореестра ФСП', () => {
    render(<Landing data={DATA} signedIn={false} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Сейчас нанимают' })).toBeDefined();
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([
      'Тест вместо резюме', 'Вилка всегда', 'Контакты после «да»', 'Достижения по ФСП ID', 'ИИ-помощник рядом', 'Навыки на практике',
    ]);
    expect(screen.getByText(/демонстрационный реестр/)).toBeDefined();
    expect(screen.queryByText('Данные на этой странице - иллюстрация')).toBeNull();
  });
  it('сохраняет обе кнопки начала и вход существующего пользователя', () => {
    render(<Landing data={DATA} signedIn={false} />);
    const starts = screen.getAllByRole('link', { name: /Приступим/ });
    expect(starts).toHaveLength(2);
    for (const link of starts) expect(link.getAttribute('href')).toBe('/auth');
    expect(screen.getByRole('link', { name: /Уже есть аккаунт/ }).getAttribute('href')).toBe('/auth');
  });
  it('с сессией ведёт в кабинет', () => {
    render(<Landing data={DATA} signedIn />);
    expect(screen.getByRole('link', { name: /Ваш кабинет/ }).getAttribute('href')).toBe('/consultant');
    for (const link of screen.getAllByRole('link', { name: /Приступим/ })) expect(link.getAttribute('href')).toBe('/consultant');
  });
  it('компании ведут к публичному источнику и не выдаются за участников платформы', () => {
    render(<Landing data={DATA} signedIn={false} />);
    const section = within(screen.getByRole('region', { name: 'Сейчас нанимают' }));
    expect(section.getByRole('link', { name: /Команда А/ }).getAttribute('href')).toBe('https://yandex.ru/jobs/');
    expect(section.getByText('Команда Б')).toBeDefined();
    expect(screen.queryByRole('list', { name: 'Платформа в цифрах' })).toBeNull();
    expect(section.queryByText(/на платформе|ваканси|до \d+k/i)).toBeNull();
  });
  it('граф показывает эти же логотипы без выдуманного процента соответствия', () => {
    const { container } = render(<Landing data={DATA} signedIn={false} />);
    const graph = container.querySelector('[aria-hidden="true"] > svg')?.parentElement;
    expect(graph).toBeTruthy();
    expect(graph?.textContent).not.toMatch(/\d+%/);
    expect(graph?.querySelectorAll('img[src^="/assets/companies/"]').length).toBe(8);
  });
  it('пустая лента не создаёт вымышленных компаний', () => {
    render(<Landing data={{ companies: [] }} signedIn={false} />);
    expect(screen.getByText('Компании скоро появятся.')).toBeDefined();
    expect(screen.queryByText(/1240|86%/)).toBeNull();
  });
  it('дубли каретки скрыты от ассистивных технологий', () => {
    const { container } = render(<Landing data={SHOWCASE} signedIn={false} />);
    expect(container.querySelectorAll('[data-tile]')).toHaveLength(16);
    const duplicates = [...container.querySelectorAll('[data-tile][aria-hidden="true"]')];
    expect(duplicates).toHaveLength(8);
    for (const duplicate of duplicates) expect(duplicate.getAttribute('tabindex')).toBe('-1');
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
  it('гость видит компании без обращения к БД и без вымышленных показателей', async () => {
    const { default: HomePage } = await import('@/app/page');
    render(await HomePage());
    const section = within(screen.getByRole('region', { name: 'Сейчас нанимают' }));
    for (const company of SHOWCASE.companies) expect(section.getAllByText(company.name).length).toBeGreaterThan(0);
    expect(screen.queryByText('Данные на этой странице - иллюстрация')).toBeNull();
    expect(dbCalls.n).toBe(0);
  });
  it('валидная сессия открывает кабинет', async () => {
    cookieValue.value = signSession('cand1');
    const { default: HomePage } = await import('@/app/page');
    render(await HomePage());
    expect(screen.getByRole('link', { name: /Ваш кабинет/ })).toBeDefined();
  });
  it('поддельная сессия остаётся гостевой', async () => {
    cookieValue.value = 'cand1.9999999999.forged';
    const { default: HomePage } = await import('@/app/page');
    render(await HomePage());
    expect(screen.queryByRole('link', { name: /Ваш кабинет/ })).toBeNull();
  });
});
