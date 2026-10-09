import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TestPage } from '@/components/TestPage';
import type { AttemptView } from '@/server/test/types';

const replace = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockClear();
  search = '';
});

const item = (index: number): AttemptView['current'] => ({
  index,
  templateId: 'be.n-plus-one',
  title: 'Сколько запросов выполнит код',
  prompt: 'ORM выполняет каждый вызов отдельным запросом. Сколько запросов?',
  code: 'const a = 1;\nfor (const x of xs) {}',
  answerHint: 'число',
  format: 'number',
  timeLimitSec: 150,
  askedAt: new Date().toISOString(),
});

const active = (index: number): AttemptView => ({
  id: 'att1',
  specialization: 'backend',
  grade: 'middle',
  status: 'active',
  mode: 'demo',
  answered: index,
  minItems: 7,
  maxItems: 10,
  startedAt: '2026-10-09T08:00:00Z',
  expiresAt: '2026-10-10T08:00:00Z',
  current: item(index),
  result: null,
});

const finished = (over: Partial<NonNullable<AttemptView['result']>> = {}): AttemptView => ({
  ...active(8),
  status: 'not_confirmed',
  current: null,
  result: {
    status: 'not_confirmed',
    theta: -0.2,
    se: 0.4,
    pPass: 0.12,
    pJunior: 0.91,
    confirmed: false,
    juniorOffered: true,
    juniorConfirmedAt: null,
    answered: 8,
    correct: 5,
    explanation: 'Решено 5 из 8. Middle не подтверждён.',
    confirmedCatalogIds: ['be.orm'],
    items: [{ ...item(0)!, answer: '4', correct: true, answerKey: '4', explanation: 'N+1', catalogIds: ['be.orm'] }],
    finishedAt: '2026-10-09T08:10:00Z',
    ...over,
  },
});

type Route = (url: string, init?: RequestInit) => unknown;

function stubFetch(route: Route) {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const body = route(url, init);
      return { ok: true, status: 200, json: async () => body };
    }),
  );
  return calls;
}

describe('TestPage', () => {
  it('вступление: выбор направления и грейда, правила, кнопка старта с подписью выбора', async () => {
    stubFetch((url) => {
      if (url.startsWith('/api/recommendations')) return { test: { specialization: 'frontend', grade: 'middle', reason: 'заявлено 40%', allowed: true } };
      if (url.startsWith('/api/test/start?')) return { allowed: true, rules: 'Демо-режим: минуты.' };
      return {};
    });
    render(<TestPage />);
    expect(await screen.findByText('Подтвердим грейд')).toBeDefined();
    await waitFor(() => expect(screen.getByTestId('rec-hint').textContent).toContain('заявлено 40%'));
    // Рекомендация предзаполнила выбор
    expect(screen.getByTestId('start').textContent).toContain('Frontend · Middle');
    fireEvent.click(screen.getByRole('button', { name: 'Junior' }));
    expect(screen.getByTestId('start').textContent).toContain('Frontend · Junior');
    await waitFor(() => expect(screen.getByText('Демо-режим: минуты.')).toBeDefined());
  });

  it('интервал не прошёл → кнопка старта недоступна и видна причина', async () => {
    stubFetch((url) => {
      if (url.startsWith('/api/test/start?')) return { allowed: false, code: 'retake_too_soon', reason: 'Пересдать можно с завтра.', rules: 'r' };
      return { test: null };
    });
    render(<TestPage />);
    await waitFor(() => expect(screen.getByTestId('not-allowed').textContent).toContain('Пересдать можно с завтра.'));
    expect((screen.getByTestId('start') as HTMLButtonElement).disabled).toBe(true);
  });

  it('старт → задание с прогрессом и таймером; ответ → следующее задание; URL получает attempt', async () => {
    let step = 0;
    const calls = stubFetch((url) => {
      if (url.startsWith('/api/test/start?')) return { allowed: true, rules: 'r' };
      if (url === '/api/test/start') return { attemptId: 'att1', resumed: false };
      if (url === '/api/test/attempt/att1') return active(0);
      if (url === '/api/test/attempt/att1/answer') return active(++step);
      return { test: null };
    });
    search = 'specialization=backend&grade=middle';
    render(<TestPage />);
    fireEvent.click(await screen.findByTestId('start'));
    await waitFor(() => expect(screen.getByTestId('progress').textContent).toContain('Задание 1'));
    expect(replace).toHaveBeenCalledWith('/test?attempt=att1');
    expect(screen.getByTestId('timer').textContent).toMatch(/\d\d:\d\d/);
    expect(screen.getByText(/ORM выполняет/)).toBeDefined();
    expect(screen.queryByText(/answerKey/)).toBeNull();
    const input = screen.getByTestId('answer') as HTMLInputElement;
    expect((screen.getByTestId('submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => expect(screen.getByTestId('progress').textContent).toContain('Задание 2'));
    expect(calls.find((c) => c.url === '/api/test/attempt/att1/answer')?.body).toEqual({ answer: '4' });
    expect(input.value).toBe('');
  });

  it('итог: Middle не подтверждён, предложение Junior → клик подтверждает и показывает «Junior подтверждён»', async () => {
    stubFetch((url) => {
      if (url === '/api/test/attempt/att1') return finished();
      if (url === '/api/test/attempt/att1/confirm-junior') return finished({ juniorOffered: false, juniorConfirmedAt: '2026-10-09T08:11:00Z' });
      return {};
    });
    search = 'attempt=att1';
    render(<TestPage />);
    expect((await screen.findByTestId('result-title')).textContent).toBe('Middle не подтверждён');
    expect(screen.getByTestId('score').textContent).toBe('5 из 8');
    expect(screen.getByTestId('confirmed-claims').textContent).toContain('be.orm');
    fireEvent.click(screen.getByTestId('confirm-junior'));
    await waitFor(() => expect(screen.getByTestId('result-title').textContent).toBe('Junior подтверждён'));
    expect(screen.queryByTestId('junior-offer')).toBeNull();
    // Кнопки навигации и защита как флаг
    expect(screen.getByRole('link', { name: 'В профиль' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Защитить утверждение' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Разбор заданий' }));
    expect(screen.getByText(/верный: 4/)).toBeDefined();
  });

  it('итог: подтверждён', async () => {
    stubFetch(() => finished({ status: 'passed', confirmed: true, juniorOffered: false, pPass: 0.93, explanation: 'Грейд Middle подтверждён.' }));
    search = 'attempt=att1';
    render(<TestPage />);
    expect((await screen.findByTestId('result-title')).textContent).toBe('Middle подтверждён');
    expect(screen.getByText('категория записана')).toBeDefined();
  });
});
