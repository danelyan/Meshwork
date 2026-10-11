import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BlindEvaluate } from '@/components/evaluate/BlindEvaluate';
import { EvaluateModes } from '@/components/evaluate/EvaluateModes';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const M = { meanRating: 2.5, p3: 0.5, ndcg3: 0.9, cards: 4 };
const SESSION = {
  token: 't1',
  vacancy: { id: 'v1', title: 'Backend middle', specialization: 'backend', grade: 'middle', needs: [{ statement: 'Идемпотентность', weight: 3 }], stack: ['Go'] },
  cards: [
    { key: 'a', category: { label: 'Backend middle' }, specialization: 'backend', fsp: true, stack: ['Go'], claims: [{ statement: 'Писал очереди', evidence: 'platform' }, { statement: 'Люблю Go', evidence: 'self_reported' }] },
    { key: 'b', category: null, specialization: null, fsp: false, stack: [], claims: [] },
  ],
};

function mockFetch(opts: { empty?: boolean } = {}) {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
      if (url.endsWith('/vacancies')) return json({ vacancies: opts.empty ? [] : [{ id: 'v1', title: 'Backend middle', specialization: 'backend', grade: 'middle', needsCount: 3 }] });
      if (url.endsWith('/start')) return json(SESSION);
      return json({ n: 2, methods: { ours: M, bm25: M, random: M }, verdict: 'Наш порядок лучше' });
    }),
  );
  return calls;
}

describe('BlindEvaluate', () => {
  it('проходит две карточки клавишей и кнопкой, показывает итог', async () => {
    const calls = mockFetch();
    render(<BlindEvaluate />);
    fireEvent.click(await screen.findByRole('button', { name: /Backend middle/ }));
    expect(await screen.findByText('1 из 2')).toBeDefined();
    expect(screen.getByText('Подтверждено платформой')).toBeDefined();
    expect(screen.getByText('Со слов кандидата')).toBeDefined();
    fireEvent.keyDown(document, { key: '3' });
    expect(await screen.findByText('2 из 2')).toBeDefined();
    expect(screen.getByText('без теста')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /^Назад$/ }));
    expect(screen.getByText('1 из 2')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /^2/ }));
    fireEvent.click(screen.getByRole('button', { name: /^1/ }));
    expect(await screen.findByText('Наш порядок лучше')).toBeDefined();
    expect(screen.getByText('Наш подбор')).toBeDefined();
    expect(screen.getByRole('link', { name: /validation/ }).getAttribute('href')).toBe('/validation');
    expect(calls.at(-1)).toEqual({ url: '/api/evaluate/blind/score', body: { token: 't1', ratings: { a: 2, b: 1 } } });
  });

  it('пустой список и ошибка сети', async () => {
    mockFetch({ empty: true });
    render(<BlindEvaluate />);
    expect(await screen.findByText(/Список потребностей пуст/)).toBeDefined();
    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => null }) as Response));
    render(<BlindEvaluate />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/404/));
  });
});

describe('EvaluateModes', () => {
  it('по умолчанию «Разметить самому», вторая вкладка показывает JSON-форму', async () => {
    mockFetch();
    render(<EvaluateModes><p>JSON-форма</p></EvaluateModes>);
    expect(screen.getByRole('tab', { name: 'Разметить самому' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('JSON-форма')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Загрузить JSON' }));
    expect(screen.getByText('JSON-форма')).toBeDefined();
  });
});
