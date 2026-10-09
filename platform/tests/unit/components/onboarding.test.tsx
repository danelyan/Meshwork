import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import type { OnboardingView, StepView } from '@/server/onboarding/types';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

function makeView(current: Partial<StepView>, over: Partial<OnboardingView> = {}): OnboardingView {
  return {
    name: 'Иван',
    role: 'candidate',
    scenario: 'candidate',
    consent: { version: 'v1', docUrl: '/consent' },
    progress: { done: 3, total: 10 },
    history: [{ stepId: 'goal', lead: 'Начнём.', question: 'Зачем ты здесь?', answer: 'Ищу работу', editable: true }],
    current: { id: 'specialization', kind: 'one', eyebrow: 'Направление', label: 'Направление', question: 'В каком направлении работаете?', lead: 'Теперь про работу.', allowCustom: false, required: false, ...current } as StepView,
    summary: null,
    laterTarget: '/consultant',
    test: { href: '/profile', ready: false },
    onboarded: false,
    ...over,
  };
}

/** fetch: каждый POST возвращает следующий вид из очереди (или { next }). */
function stubFetch(...responses: unknown[]) {
  const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => responses.shift() }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const sent = (fn: ReturnType<typeof stubFetch>, i = 0) => JSON.parse((fn.mock.calls[i] as unknown as [string, RequestInit])[1].body as string);

const OPTS = [
  { value: 'backend', label: 'Backend', note: 'серверная разработка' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'mobile', label: 'Mobile', note: 'скоро', disabled: true },
];

it('шаг: реплика, вопрос, лента ответов, прогресс; выбор варианта отправляет ответ и показывает следующий шаг', async () => {
  const next = makeView({ id: 'grade', question: 'На какой грейд претендуете?', options: [{ value: 'junior', label: 'Junior' }] });
  const fetchFn = stubFetch(next);
  render(<OnboardingChat initial={makeView({ options: OPTS })} consentText={['Текст']} />);
  expect(screen.getByRole('heading', { name: 'В каком направлении работаете?' })).toBeDefined();
  expect(screen.getByText('Теперь про работу.')).toBeDefined();
  expect(screen.getByText('Ищу работу')).toBeDefined();
  expect(screen.getByRole('img', { name: 'Пройдено 3 из 10' })).toBeDefined();
  expect((screen.getByRole('button', { name: /Mobile/ }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: /Backend/ }));
  expect(await screen.findByRole('heading', { name: 'На какой грейд претендуете?' })).toBeDefined();
  expect(sent(fetchFn)).toEqual({ action: 'answer', stepId: 'specialization', value: 'backend' });
});

it('«Пропустить» шлёт skip; у обязательного шага кнопки нет', async () => {
  const fetchFn = stubFetch(makeView({ id: 'grade', question: 'Грейд?' }));
  const { unmount } = render(<OnboardingChat initial={makeView({ options: OPTS })} consentText={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }));
  await screen.findByRole('heading', { name: 'Грейд?' });
  expect(sent(fetchFn)).toEqual({ action: 'skip', stepId: 'specialization' });
  unmount();
  render(<OnboardingChat initial={makeView({ id: 'consent', kind: 'consent', required: true, question: 'Согласие?' })} consentText={['Я даю согласие']} />);
  expect(screen.queryByRole('button', { name: 'Пропустить' })).toBeNull();
  expect(screen.getByText('Я даю согласие')).toBeDefined();
});

it('согласие отправляет текущую версию текста', async () => {
  const fetchFn = stubFetch(makeView({ options: OPTS }));
  render(<OnboardingChat initial={makeView({ id: 'consent', kind: 'consent', required: true, question: 'Согласие?' })} consentText={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /Согласен/ }));
  await waitFor(() => expect(fetchFn).toHaveBeenCalled());
  expect(sent(fetchFn)).toEqual({ action: 'answer', stepId: 'consent', value: { version: 'v1' } });
});

it('«Настроить позже» уводит туда, куда сказал сервер, без завершения', async () => {
  const fetchFn = stubFetch({ next: '/consultant' });
  render(<OnboardingChat initial={makeView({ options: OPTS })} consentText={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Настроить позже' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/consultant'));
  expect(sent(fetchFn)).toEqual({ action: 'later' });
});

it('чипы: свой вариант добавляется и уходит вместе с выбранными', async () => {
  const fetchFn = stubFetch(makeView({ id: 'formats', question: 'Формат?' }));
  render(
    <OnboardingChat
      initial={makeView({ id: 'stack', kind: 'chips', question: 'Стек?', allowCustom: true, options: [{ value: 'Go', label: 'Go' }, { value: 'SQL', label: 'SQL' }] })}
      consentText={[]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Go' }));
  fireEvent.change(screen.getByPlaceholderText('Своё'), { target: { value: 'Erlang' } });
  fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
  fireEvent.click(screen.getByRole('button', { name: /Дальше · выбрано 2/ }));
  await screen.findByRole('heading', { name: 'Формат?' });
  expect(sent(fetchFn)).toEqual({ action: 'answer', stepId: 'stack', value: ['Go', 'Erlang'] });
});

it('ИНН: опечатка — ошибка и кнопка неактивна; верный — пометка «демо» про реестр', () => {
  stubFetch();
  render(<OnboardingChat initial={makeView({ id: 'inn', kind: 'text', eyebrow: 'Компания', label: 'ИНН', question: 'ИНН компании', maxLength: 12 })} consentText={[]} />);
  const input = screen.getByLabelText('ИНН');
  fireEvent.change(input, { target: { value: '7707083894' } });
  expect(screen.getByRole('alert').textContent).toMatch(/контрольная/);
  expect((screen.getByRole('button', { name: 'Дальше' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: '7707083893' } });
  expect(screen.getByText(/найдено в реестре · демо/)).toBeDefined();
});

it('ФСП: демо-достижения помечены «демо: API ФСП не предоставлен»', () => {
  stubFetch();
  render(
    <OnboardingChat
      initial={makeView({ id: 'fsp', question: 'ФСП?', options: [{ value: 'linked', label: 'Привязать' }], fspDemo: [{ event: 'Кубок', year: 2025, result: 'финалист', role: 'backend' }] })}
      consentText={[]}
    />,
  );
  expect(screen.getByText('демо: API ФСП не предоставлен')).toBeDefined();
  expect(screen.getByText(/Кубок, 2025: финалист/)).toBeDefined();
});

it('итог: сводка, пропущенное с возвратом, тест ведёт в профиль с пометкой, пока роута теста нет', async () => {
  const summaryView = makeView(
    { id: 'summary', kind: 'summary', question: 'Вот что я понял' },
    { summary: { items: [{ stepId: 'grade', label: 'Предполагаемый грейд', value: 'Middle' }], skipped: [{ stepId: 'stack', label: 'Стек' }], warnings: [] } },
  );
  const fetchFn = stubFetch(makeView({ id: 'stack', kind: 'chips', question: 'Стек?', options: [] }), { onboarded: true, next: '/consultant' });
  render(<OnboardingChat initial={summaryView} consentText={[]} />);
  expect(screen.getByText('Middle')).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Настроить позже' })).toBeNull();
  expect(screen.getByText(/Тест на грейд скоро появится/)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Вернуться' }));
  await screen.findByRole('heading', { name: 'Стек?' });
  expect(sent(fetchFn)).toEqual({ action: 'goto', stepId: 'stack' });
});

it('итог: «Пройти тест» завершает онбординг и ведёт по адресу теста', async () => {
  const fetchFn = stubFetch({ onboarded: true, next: '/consultant' });
  render(
    <OnboardingChat
      initial={makeView({ id: 'summary', kind: 'summary', question: 'Итог' }, { summary: { items: [], skipped: [], warnings: [] } })}
      consentText={[]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Пройти тест на грейд' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/profile'));
  expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('/api/auth/onboarding/complete');
});
