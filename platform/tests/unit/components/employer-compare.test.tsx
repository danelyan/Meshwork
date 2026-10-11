import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MatchExplorer } from '@/components/employer/MatchExplorer';
import type { MatchItem } from '@/server/employer/matching';
import { compareCandidates } from '@/server/employer/compare';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const item = (id: string, rank: number, score: number, fsp: number): MatchItem => ({
  candidateId: id,
  rank,
  score,
  coverageScore: 0.5,
  covered: 2,
  total: 3,
  provenCount: 1,
  categoryMatch: true,
  subcategoryFit: 'exact',
  boosts: { category: 0.1, fsp, stack: 0, specPenalty: 0 },
  explanation: { summary: 's', covered: [], proven: [], missing: [], fsp: '', category: 'Backend · Middle (тест)', subcategory: '', stackMatched: [] },
  candidate: {
    id,
    displayName: `Кандидат ${id}`,
    specialization: 'backend',
    category: { specialization: 'backend', grade: 'middle', label: 'Backend · Middle' },
    fsp: { state: 'linked', hasAchievements: true },
    claims: [],
    contacts: null,
  },
  invitation: null,
});

const A = item('a', 1, 0.65, 0.05);
const B = item('b', 2, 0.6, 0);

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('подборка: сравнение «Почему A выше B»', () => {
  it('два отмеченных кандидата -> запрос к API и таблица фактор / A / B / разница', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => compareCandidates(A, B) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchExplorer items={[A, B]} vacancyId="v1" />);
    expect(screen.queryByText('Сравнить двоих')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Сравнить' }));
    fireEvent.click(screen.getByRole('button', { name: /Список/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Сравнить: Кандидат b' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сравнить двоих' }));

    await waitFor(() => expect(screen.getByTestId('compare-headline')).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith('/api/employer/vacancies/v1/compare?a=a&b=b');
    expect(screen.getByTestId('compare-headline').textContent).toMatch(/Разница \+5,0 п\. в пользу A.*достижения ФСП \+5,0/);
    const table = screen.getByRole('table');
    expect(table.querySelector('thead')?.textContent).toMatch(/Фактор.*A.*B.*Разница/);
    expect(screen.getByRole('rowheader', { name: 'Достижения ФСП' })).toBeDefined();
  });

  it('без потребности (поиск по банку) сравнения нет', () => {
    render(<MatchExplorer items={[A, B]} vacancyId={null} />);
    expect(screen.queryByRole('button', { name: 'Сравнить' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
