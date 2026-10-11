import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { EvaluateScreen } from '@/components/validation/EvaluateScreen';
import { ValidationView } from '@/components/validation/ValidationView';
import { GRADE_TEST_COMMANDS, GRADE_TEST_DOC, GRADE_TEST_POLICY, LENGTH_BLOCK, PERSONAS, SYNTHETIC, TARGETS } from '@/server/validation/grade-test-figures';
import type { EvaluateReport } from '@/server/validation/evaluate';
import { EVAL_LIMITS } from '@/server/validation/evaluate';
import { parseMatchingResults } from '@/server/validation/matching-results';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const grade = { doc: GRADE_TEST_DOC, policy: GRADE_TEST_POLICY, personas: PERSONAS, synthetic: SYNTHETIC, targets: TARGETS, commands: GRADE_TEST_COMMANDS };
const matching = parseMatchingResults({
  summary: { k: 5, profiles: 17, vacancies: 1, precisionAt5: 0.675, precisionAt5Ceiling: 0.75, ndcgAt5: 0.9689, baseline: { precisionAt5: 0.475, ndcgAt5: 0.6152 } },
  rows: [{ vacancy: 'demo-vac-be-j-1', p: 0.6, pMax: 1, ndcg: 0.82, bP: 0.4, bNdcg: 0.7, top: [] }],
});

describe('ValidationView', () => {
  it('оговорки до цифр, числа подбора из results.json, тест и команды', () => {
    render(<ValidationView grade={grade} matching={matching} />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/Оговорки/);
    expect(screen.getByText('0,675')).toBeDefined();
    expect(screen.getByText(/Тест не защищён от нейросети/)).toBeDefined();
    expect(screen.getByText('0,475')).toBeDefined();
    expect(screen.getByText('demo-vac-be-j-1')).toBeDefined();
    expect(screen.getByText(/npx tsx eval\/matching\/run\.ts/)).toBeDefined();
    expect(screen.getByText(/eval\/test\/run\.ts --n 2000/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Проверить подбор на своих данных' }).getAttribute('href')).toBe('/evaluate');
  });

  it('расширенный блок рисуется, только если он есть', () => {
    const ext = parseMatchingResults({ ...matching, extended: { vacancies: 24, profiles: 247, methods: { ours: { p5: 0.9 }, bm25: { p5: 0.5 } } } });
    render(<ValidationView grade={grade} matching={ext} />);
    expect(screen.getByText('Расширенная синтетика')).toBeDefined();
    expect(screen.getByText('BM25 по тексту')).toBeDefined();
    cleanup();
    render(<ValidationView grade={grade} matching={matching} />);
    expect(screen.queryByText('Расширенная синтетика')).toBeNull();
  });

  it('«Длина теста и надёжность»: перебор лимитов и ширина банка из results.json; без данных блока нет', () => {
    render(<ValidationView grade={grade} matching={matching} length={LENGTH_BLOCK} itemLimits={{ min: 9, max: 12 }} />);
    expect(screen.getByText('Длина теста и надёжность')).toBeDefined();
    expect(screen.getByText(/Сейчас основная фаза – 9–12 заданий/)).toBeDefined();
    expect(screen.getByText(/7–10 \(сейчас\)/)).toBeDefined();
    expect(screen.getByText('12–16')).toBeDefined();
    expect(screen.getByText(/Ширина банка/)).toBeDefined();
    cleanup();
    render(<ValidationView grade={grade} matching={matching} />);
    expect(screen.queryByText('Длина теста и надёжность')).toBeNull();
  });
});

const SAMPLE = { k: 5, vacancies: [{ id: 'v1', specialization: 'backend' as const, grade: 'middle' as const, needs: [{ catalogId: 'be.idempotency', weight: 3 }] }], candidates: [{ id: 'c1', claims: [] }], relevance: {} };
const REPORT: EvaluateReport = {
  k: 5,
  candidates: 1,
  vacancies: 1,
  scored: 1,
  mean: { ours: { precision: 0.2, ndcg: 1, mrr: 1 }, baseline: { precision: 0, ndcg: 0, mrr: 0 }, precisionCeiling: 0.2 },
  rows: [
    {
      id: 'v1',
      title: 'Платежи',
      specialization: 'backend',
      grade: 'middle',
      relevantCount: 1,
      shown: 1,
      precisionCeiling: 0.2,
      ours: { precision: 0.2, ndcg: 1, mrr: 1 },
      baseline: { precision: 0, ndcg: 0, mrr: 0 },
      top: [{ candidateId: 'c1', score: 0.5, relevance: 2, summary: '<b>Закрывает 1 из 1</b>' }],
      baselineTop: [],
    },
  ],
  warnings: [],
};

describe('EvaluateScreen', () => {
  const view = () => render(<EvaluateScreen sample={SAMPLE} catalog={[{ id: 'be.idempotency', statement: 'Идемпотентность', specialization: 'backend' }]} limits={EVAL_LIMITS} />);

  it('«Загрузить пример» → POST /api/evaluate → метрики и топ; текст из ответа – как текст, не HTML', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => REPORT }));
    vi.stubGlobal('fetch', fetchMock);
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить пример' }));
    expect((screen.getByLabelText('Набор в JSON') as HTMLTextAreaElement).value).toContain('be.idempotency');
    fireEvent.click(screen.getByRole('button', { name: 'Посчитать метрики' }));
    await screen.findByText('Платежи');
    expect(fetchMock).toHaveBeenCalledWith('/api/evaluate', expect.objectContaining({ method: 'POST' }));
    const top = screen.getByRole('list', { name: 'Топ-5 нашего подбора' });
    expect(within(top).getByText('<b>Закрывает 1 из 1</b>')).toBeDefined();
    expect(within(top).getByText('подходит')).toBeDefined();
  });

  it('не JSON – ошибка без запроса; ошибка сервера – его текст', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Нет в каталоге утверждений: x' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    view();
    const area = screen.getByLabelText('Набор в JSON');
    fireEvent.change(area, { target: { value: '{oops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Посчитать метрики' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/не JSON/);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(area, { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Посчитать метрики' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Нет в каталоге/));
  });

  it('каталог утверждений показан для составления набора', () => {
    view();
    expect(screen.getByText(/Каталог утверждений \(1 id\)/)).toBeDefined();
    expect(screen.getByText('be.idempotency')).toBeDefined();
  });
});
