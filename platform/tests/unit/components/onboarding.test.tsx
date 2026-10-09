import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CHAR_MS, typingMs } from '@/components/chat/motion';
import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import type { OnboardingView, StepView } from '@/server/onboarding/types';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
    current: { id: 'specialization', kind: 'one', eyebrow: 'Направление', label: 'Направление', question: 'В каком направлении работаешь?', lead: 'Теперь про работу.', allowCustom: false, required: false, ...current } as StepView,
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
const question = () => document.getElementById('ob-q')?.textContent;

const OPTS = [
  { value: 'backend', label: 'Backend', note: 'серверная разработка' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'mobile', label: 'Mobile', note: 'скоро', disabled: true },
];

it('лента: реплика и вопрос помощника, прошлые ответы пузырями, тонкий прогресс без «1 / 10» и без «Далее»', () => {
  stubFetch();
  render(<OnboardingChat initial={makeView({ options: OPTS })} consentText={[]} />);
  expect(question()).toBe('В каком направлении работаешь?');
  expect(screen.getByText('Теперь про работу.')).toBeDefined();
  expect(screen.getByText('Ищу работу')).toBeDefined();
  expect(screen.getByRole('progressbar', { name: 'Пройдено 3 из 10' })).toBeDefined();
  expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Дальше|Далее/ })).toBeNull();
  expect(screen.getByRole('list', { name: 'Переписка с помощником' })).toBeDefined();
});

it('чип: ответ становится пузырём справа, чипы исчезают, приходит следующая реплика', async () => {
  const next = makeView({ id: 'grade', question: 'На какой грейд претендуешь?', options: [{ value: 'junior', label: 'Junior' }] });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetchFn = vi.fn(async () => {
    await gate;
    return { ok: true, status: 200, json: async () => next };
  });
  vi.stubGlobal('fetch', fetchFn);
  render(<OnboardingChat initial={makeView({ options: OPTS })} consentText={[]} />);
  expect((screen.getByRole('button', { name: /Mobile/ }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: /Backend/ }));
  expect(screen.queryByTestId('quick-replies')).toBeNull();
  expect(screen.getByText('Backend')).toBeDefined();
  expect(screen.getByTestId('typing')).toBeDefined();
  release();
  await waitFor(() => expect(question()).toBe('На какой грейд претендуешь?'));
  expect(sent(fetchFn as never)).toEqual({ action: 'answer', stepId: 'specialization', value: 'backend' });
});

it('«Пропустить» — тихая ссылка у поля ввода, шлёт skip; у обязательного шага её нет', async () => {
  const fetchFn = stubFetch(makeView({ id: 'grade', question: 'Грейд?' }));
  const { unmount } = render(<OnboardingChat initial={makeView({ options: OPTS })} consentText={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }));
  await waitFor(() => expect(question()).toBe('Грейд?'));
  expect(sent(fetchFn)).toEqual({ action: 'skip', stepId: 'specialization' });
  unmount();
  render(<OnboardingChat initial={makeView({ id: 'consent', kind: 'consent', required: true, question: 'Согласие?' })} consentText={['Я даю согласие']} />);
  expect(screen.queryByRole('button', { name: 'Пропустить' })).toBeNull();
  expect(screen.getByText('Я даю согласие')).toBeDefined();
  expect(screen.getByRole('link', { name: /странице согласия/ }).getAttribute('href')).toBe('/consent');
});

it('согласие: чип «Согласен(на)» отправляет текущую версию текста', async () => {
  const fetchFn = stubFetch(makeView({ options: OPTS }));
  render(<OnboardingChat initial={makeView({ id: 'consent', kind: 'consent', required: true, question: 'Согласие?' })} consentText={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Согласен(на)' }));
  await waitFor(() => expect(fetchFn).toHaveBeenCalled());
  expect(sent(fetchFn)).toEqual({ action: 'answer', stepId: 'consent', value: { version: 'v1' } });
});

it('«изменить» на прошлом ответе возвращает к шагу (goto)', async () => {
  const fetchFn = stubFetch(makeView({ id: 'goal', question: 'Зачем ты здесь?' }, { history: [] }));
  render(<OnboardingChat initial={makeView({ options: OPTS })} consentText={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'изменить' }));
  await waitFor(() => expect(question()).toBe('Зачем ты здесь?'));
  expect(sent(fetchFn)).toEqual({ action: 'goto', stepId: 'goal' });
});

it('«Настроить позже» уводит туда, куда сказал сервер, без завершения', async () => {
  const fetchFn = stubFetch({ next: '/consultant' });
  render(<OnboardingChat initial={makeView({ options: OPTS })} consentText={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Настроить позже' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/consultant'));
  expect(sent(fetchFn)).toEqual({ action: 'later' });
});

it('мультивыбор: чипы-тогглы, своё — из поля ввода, тихое «Готово» отправляет всё', async () => {
  const fetchFn = stubFetch(makeView({ id: 'formats', question: 'Формат?' }));
  render(
    <OnboardingChat
      initial={makeView({ id: 'stack', kind: 'chips', question: 'Стек?', allowCustom: true, options: [{ value: 'Go', label: 'Go' }, { value: 'SQL', label: 'SQL' }] })}
      consentText={[]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Go' }));
  fireEvent.change(screen.getByLabelText('Ответ'), { target: { value: 'Erlang' } });
  fireEvent.keyDown(screen.getByLabelText('Ответ'), { key: 'Enter' });
  expect(screen.getByRole('button', { name: 'Erlang' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Готово · 2' }));
  await waitFor(() => expect(question()).toBe('Формат?'));
  expect(sent(fetchFn)).toEqual({ action: 'answer', stepId: 'stack', value: ['Go', 'Erlang'] });
});

it('текстовый шаг: Enter отправляет; ИНН с опечаткой — реплика помощника, на сервер не уходит', async () => {
  const fetchFn = stubFetch(makeView({ id: 'company', question: 'Компания?' }));
  render(<OnboardingChat initial={makeView({ id: 'inn', kind: 'text', eyebrow: 'Компания', label: 'ИНН', question: 'ИНН компании', maxLength: 12 })} consentText={[]} />);
  const input = screen.getByLabelText('ИНН');
  fireEvent.change(input, { target: { value: '7707083894' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByRole('alert').textContent).toMatch(/контрольн/i);
  expect(fetchFn).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '7707083893' } });
  expect(screen.getByText(/реестр ФНС — демо/)).toBeDefined();
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(question()).toBe('Компания?'));
  expect(sent(fetchFn)).toEqual({ action: 'answer', stepId: 'inn', value: '7707083893' });
});

it('ФСП: демо-достижения карточкой в сообщении с пометкой «демо: API ФСП не предоставлен»', () => {
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

const summaryView = (over: Partial<OnboardingView> = {}) =>
  makeView(
    { id: 'summary', kind: 'summary', question: 'Вот что я понял' },
    { summary: { items: [{ stepId: 'grade', label: 'Предполагаемый грейд', value: 'Middle' }], skipped: [{ stepId: 'stack', label: 'Стек' }], warnings: [] }, ...over },
  );

it('итог: сводка в ленте, пропущенное — чипом «Ответить», без «Настроить позже»', async () => {
  const fetchFn = stubFetch(makeView({ id: 'stack', kind: 'chips', question: 'Стек?', options: [] }));
  render(<OnboardingChat initial={summaryView()} consentText={[]} />);
  expect(screen.getByText('Middle')).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Настроить позже' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ответить: Стек' }));
  await waitFor(() => expect(question()).toBe('Стек?'));
  expect(sent(fetchFn)).toEqual({ action: 'goto', stepId: 'stack' });
});

it('итог: чип теста завершает онбординг и ведёт по адресу теста (пока роута нет — в профиль)', async () => {
  const fetchFn = stubFetch({ onboarded: true, next: '/consultant' });
  render(<OnboardingChat initial={summaryView()} consentText={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /Тест на грейд \(скоро\)/ }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/profile'));
  expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('/api/auth/onboarding/complete');
});

it('итог кандидата: та же лента продолжается консультантом; первое сообщение сначала завершает знакомство', async () => {
  const enc = new TextEncoder();
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/auth/onboarding/complete') return new Response(JSON.stringify({ onboarded: true, next: '/consultant' }), { status: 200, headers: { 'content-type': 'application/json' } });
      const body = `data: ${JSON.stringify({ type: 'message', text: 'Начнём с резюме' })}\n\ndata: {"type":"done"}\n\n`;
      return new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(body)), c.close()) }), { status: 200 });
    }),
  );
  render(<OnboardingChat initial={summaryView()} consentText={[]} consultant={{}} />);
  expect(screen.getByText(/твой карьерный консультант/)).toBeDefined();
  expect(screen.getByRole('button', { name: 'Открыть профиль' })).toBeDefined();
  fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'Что подтянуть до middle?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
  await waitFor(() => expect(screen.getByText('Начнём с резюме')).toBeDefined());
  expect(calls[0]).toBe('/api/auth/onboarding/complete');
  expect(calls[1]).toMatch(/consultant/);
  expect(screen.queryByRole('button', { name: 'Открыть профиль' })).toBeNull();
});

it('работодатель: консультант не подключается, дальше — «Открыть подборку»', () => {
  stubFetch();
  render(<OnboardingChat initial={summaryView({ scenario: 'employer', role: 'employer' })} consentText={[]} consultant={{}} />);
  expect(screen.getByRole('button', { name: 'Открыть подборку' })).toBeDefined();
  expect(screen.queryByLabelText('Сообщение')).toBeNull();
});

describe('появление реплики', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  });

  it('сначала «печатает», затем текст посимвольно; чипы — только после реплики', () => {
    stubFetch();
    render(<OnboardingChat initial={makeView({ options: OPTS, lead: '', question: 'Кто ты?' })} consentText={[]} />);
    expect(screen.getAllByTestId('typing')).toHaveLength(1);
    expect(screen.queryByTestId('quick-replies')).toBeNull();
    act(() => vi.advanceTimersByTime(typingMs('Кто ты?'.length)));
    expect(screen.queryByTestId('typing')).toBeNull();
    act(() => vi.advanceTimersByTime(CHAR_MS * 3));
    expect(question()).toBe('Кто');
    act(() => vi.advanceTimersByTime(1000));
    expect(question()).toBe('Кто ты?');
    expect(screen.getByTestId('quick-replies')).toBeDefined();
  });

  it('тап по реплике показывает её целиком', () => {
    stubFetch();
    render(<OnboardingChat initial={makeView({ options: OPTS, lead: '', question: 'Длинный вопрос про направление' })} consentText={[]} />);
    act(() => vi.advanceTimersByTime(700 + CHAR_MS * 2));
    fireEvent.click(document.getElementById('ob-q')!);
    expect(question()).toBe('Длинный вопрос про направление');
    expect(screen.getByTestId('quick-replies')).toBeDefined();
  });

  it('prefers-reduced-motion — без анимации', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    stubFetch();
    render(<OnboardingChat initial={makeView({ options: OPTS })} consentText={[]} />);
    expect(screen.queryByTestId('typing')).toBeNull();
    expect(question()).toBe('В каком направлении работаешь?');
  });
});
