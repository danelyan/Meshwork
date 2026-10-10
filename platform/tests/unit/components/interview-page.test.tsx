import { cleanup, render, screen } from '@testing-library/react';

import { Criteria, ResultCard, Stages } from '@/components/interview/InterviewPage';
import type { InterviewSummary } from '@/server/interview/types';

afterEach(() => cleanup());

const summary: InterviewSummary = {
  modelVersion: 'v',
  claimedGrade: 'middle',
  axes: [
    { axis: 'technical', score: 75, probed: 2, confirmed: 2 },
    { axis: 'systems', score: null, probed: 0, confirmed: 0 },
    { axis: 'communication', score: 60, probed: 1, confirmed: 1 },
    { axis: 'grade_fit', score: 100, probed: 2, confirmed: 0 },
  ],
  gradeFit: { share: 1, label: 'match', text: 'Соответствует Middle по интервью' },
  overall: 78,
  competencies: [
    { id: 'backend.code', title: 'Код и язык', axis: 'technical', status: 'confirmed', probed: 2, maxLevel: 3, demonstrated: 'senior', total: 7 },
    { id: 'backend.data', title: 'Данные и хранение', axis: 'technical', status: 'not_confirmed', probed: 1, maxLevel: 2, demonstrated: null, total: 3 },
    { id: 'backend.api', title: 'API и контракты', axis: 'technical', status: 'not_probed', probed: 0, maxLevel: 1, demonstrated: null, total: 0 },
  ],
  strengths: ['Код и язык'],
  growth: ['Данные и хранение'],
  blocks: ['intro', 'test'],
};

it('этапы: пройденные отмечены, текущий — «сейчас»', () => {
  render(<Stages current="systems" />);
  const cur = screen.getByText('Системный дизайн').closest('div')!;
  expect(cur.getAttribute('aria-current')).toBe('step');
  expect(cur.textContent).toContain('сейчас');
  expect(screen.getByText('Знакомство').closest('div')!.textContent).toContain('✓');
  expect(screen.getByText('Итоги').closest('div')!.getAttribute('aria-current')).toBeNull();
});

it('критерии: без вердикта — прочерки, с вердиктом — проценты и «не проверено» у пустой оси', () => {
  const { rerender } = render(<Criteria summary={null} />);
  expect(screen.getAllByText('—')).toHaveLength(4);
  rerender(<Criteria summary={summary} />);
  expect(screen.getByText('75%')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Системное мышление: не проверено' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Соответствие грейду: 100 из 100' })).toBeTruthy();
});

it('итог: соответствие по интервью, не «грейд подтверждён»; только проверенные компетенции; дисклеймер', () => {
  render(<ResultCard summary={summary} disclaimer="Категорию не меняет." />);
  expect(screen.getByText('Соответствует Middle по интервью')).toBeTruthy();
  expect(screen.getByText('итог 78 / 100')).toBeTruthy();
  expect(screen.queryByText(/подтверждён/)).toBeNull();
  expect(screen.getByText('Код и язык')).toBeTruthy();
  expect(screen.getByText('подтверждено · senior')).toBeTruthy();
  expect(screen.queryByText('API и контракты')).toBeNull();
  expect(screen.getByText('Категорию не меняет.')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Открыть профиль/ }).getAttribute('href')).toBe('/profile');
});

it('страница /interview: без интервью — карточка со ссылкой «Пройти в консультанте», без старта на месте', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ consent: { given: true, version: 'v', text: [] }, calls: [], mode: 'off' }), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
  HTMLElement.prototype.scrollTo = () => {};
  const { InterviewPage } = await import('@/components/interview/InterviewPage');
  render(<InterviewPage />);
  const link = await screen.findByText(/Пройти в консультанте/);
  expect(link.closest('a')?.getAttribute('href')).toBe('/consultant?call=1');
  expect(screen.queryByText('Начать ИИнтервью')).toBeNull();
  vi.unstubAllGlobals();
});
