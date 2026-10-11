import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SimulatorScreen } from '@/components/simulator/SimulatorScreen';
import { CONFIRM_PROB, GRADE_CUT } from '@/server/test/policy';
import { SIM_LIMITS, simulate, simulatorSubcategories } from '@/server/validation/simulator';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const subs = simulatorSubcategories();
const initial = simulate({ subcategoryId: subs[0]!.id, claimed: 'middle', theta: 0.3, mode: 'ideal', seed: 1 });
const props = { subcategories: subs, cuts: { ...GRADE_CUT }, initial, limits: SIM_LIMITS, confirmProb: CONFIRM_PROB };

describe('SimulatorScreen', () => {
  it('рисует итог, таблицу шагов, график и пояснение со ссылкой на /validation', () => {
    render(<SimulatorScreen {...props} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Симулятор адаптивного теста' })).toBeDefined();
    expect(screen.getAllByRole('row').length).toBe(initial.length + 1);
    expect(screen.getByRole('img', { name: /График оценки θ/ })).toBeDefined();
    expect(screen.getByText(/симуляция по модели, а не реальный кандидат/)).toBeDefined();
    expect(screen.getByRole('link', { name: /2000 синтетических/ }).getAttribute('href')).toBe('/validation');
  });

  it('кнопка шлёт параметры на /api/simulator и показывает ответ', async () => {
    const next = simulate({ subcategoryId: subs[0]!.id, claimed: 'middle', theta: 2.5, mode: 'ideal', seed: 1 });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(next), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SimulatorScreen {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Прогнать тест' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/simulator');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ subcategoryId: subs[0]!.id, claimed: 'middle', mode: 'ideal', seed: 1 });
    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(next.length + 1));
  });

  it('ошибка сервера показывается текстом', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'плохой seed' } }), { status: 400 })));
    render(<SimulatorScreen {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Прогнать тест' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('плохой seed'));
  });
});
