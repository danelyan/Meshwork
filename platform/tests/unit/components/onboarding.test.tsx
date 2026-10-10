import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { typingMs } from '@/components/chat/motion';
import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import type { OnboardingView, StepView } from '@/server/onboarding/types';

const push = vi.fn();
// Вход и переходы — полная навигация (window.location.assign), см. DemoScreen.enter.
beforeEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: push } });
});
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
  expect(screen.getByTestId('reply-skeleton')).toBeDefined();
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
  expect(screen.getByText(/реестр ФНС - демо/)).toBeDefined();
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

it('итог: сводка — обычная реплика помощника (без карточки), пропущенное — чипом «Ответить», без «Настроить позже»', async () => {
  const fetchFn = stubFetch(makeView({ id: 'stack', kind: 'chips', question: 'Стек?', options: [] }));
  render(<OnboardingChat initial={summaryView()} consentText={[]} />);
  expect(screen.getByText('Предполагаемый грейд: Middle')).toBeDefined();
  expect(screen.getByText(/Пропущено: Стек/)).toBeDefined();
  expect(screen.queryByRole('region', { name: 'Что я узнал' })).toBeNull();
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

it('работодатель: та же лента продолжается помощником по подбору; «Открыть подборку» — переход, текст — ход помощника', async () => {
  const enc = new TextEncoder();
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/auth/onboarding/complete') return new Response(JSON.stringify({ onboarded: true, next: '/employer' }), { status: 200, headers: { 'content-type': 'application/json' } });
      const body = `data: ${JSON.stringify({ type: 'message', text: 'Под «Backend» нашлось 6' })}\n\ndata: {"type":"done"}\n\n`;
      return new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(body)), c.close()) }), { status: 200 });
    }),
  );
  render(<OnboardingChat initial={summaryView({ scenario: 'employer', role: 'employer' })} consentText={[]} consultant={{}} employerAssistant={{}} />);
  expect(screen.getByText(/твой помощник по подбору/)).toBeDefined();
  expect(screen.getByRole('button', { name: 'Открыть подборку' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Подбери под потребность' }));
  await waitFor(() => expect(screen.getByText('Под «Backend» нашлось 6')).toBeDefined());
  expect(calls[0]).toBe('/api/auth/onboarding/complete');
  expect(calls[1]).toBe('/api/employer/assistant/messages');
});

const RANGE = { min: 40, max: 600, step: 10, unit: 'тыс ₽ / мес', scale: 1000, fromLabel: 'Минимум', toLabel: 'Ожидаю', defaults: { from: 120, to: 180 } };

it('зарплата: чипы вилок вместо ползунков, свой вариант — числом в композере', async () => {
  const fetchFn = stubFetch(makeView({ id: 'fspParticipation', question: 'Участвовал?' }));
  render(<OnboardingChat initial={makeView({ id: 'salary', kind: 'range', question: 'Сколько хочешь получать?', range: RANGE })} consentText={[]} />);
  expect(screen.queryByRole('slider')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '150–200 тыс' }));
  await waitFor(() => expect(question()).toBe('Участвовал?'));
  expect(sent(fetchFn)).toEqual({ action: 'answer', stepId: 'salary', value: { from: 150, to: 200 } });
});

it('зарплата текстом: «от 180 до 250 тыс» уходит диапазоном, «5 млн» — реплика об ошибке без запроса', async () => {
  const fetchFn = stubFetch(makeView({ id: 'fspParticipation', question: 'Участвовал?' }));
  render(<OnboardingChat initial={makeView({ id: 'salary', kind: 'range', question: 'Сколько?', range: RANGE })} consentText={[]} />);
  const box = screen.getByLabelText('Ответ');
  fireEvent.change(box, { target: { value: '5000000' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(screen.getByRole('alert').textContent).toContain('от 40 до 600');
  expect(fetchFn).not.toHaveBeenCalled();
  fireEvent.change(box, { target: { value: 'от 180 до 250 тыс' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => expect(question()).toBe('Участвовал?'));
  expect(sent(fetchFn)).toEqual({ action: 'answer', stepId: 'salary', value: { from: 180, to: 250 } });
});

it('документы: файл скрепкой и ссылка текстом в общем композере → разбор в ленте → «Дальше» отвечает шагу', async () => {
  const enc = new TextEncoder();
  const bodies: Record<string, unknown>[] = [];
  const next = makeView({ id: 'fsp', question: 'Привяжем ФСП ID?' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/uploads') return new Response(JSON.stringify({ uploadId: 'up1', deduplicated: false, doc: { title: 'cv.pdf' } }), { status: 201, headers: { 'content-type': 'application/json' } });
      if (url === '/api/consultant/messages') {
        bodies.push(JSON.parse(String(init?.body)));
        const sse = [
          { type: 'conversation', id: 'c1' },
          { type: 'step', text: 'читаю cv.pdf…' },
          { type: 'claims', proposed: [], rejected: 0 },
          { type: 'delta', id: 'm', text: 'Прочитал резюме.' },
          { type: 'message', id: 'm', text: 'Прочитал резюме.' },
          { type: 'done' },
        ]
          .map((e) => `data: ${JSON.stringify(e)}\n\n`)
          .join('');
        return new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(sse)), c.close()) }), { status: 200 });
      }
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const { container } = render(<OnboardingChat initial={makeView({ id: 'documents', kind: 'files', question: 'Пришли резюме или ссылки' })} consentText={[]} />);
  expect(screen.queryByRole('button', { name: 'Разобрать' })).toBeNull();
  const box = screen.getByLabelText('Ответ');
  fireEvent.change(container.querySelector('input[type=file]') as HTMLInputElement, { target: { files: [new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' })] } });
  await waitFor(() => expect(screen.getByRole('list', { name: 'Вложения' }).textContent).toMatch(/КБ/));
  fireEvent.change(box, { target: { value: 'и код тут github.com/demo-ryabinin' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => expect(screen.getByText('Прочитал резюме.')).toBeDefined());
  expect(bodies[0]).toMatchObject({ uploadIds: ['up1'], urls: ['https://github.com/demo-ryabinin'], text: 'и код тут github.com/demo-ryabinin', onboardingStep: 'documents' });
  expect(screen.getByText('читаю cv.pdf…')).toBeDefined();

  fireEvent.click(screen.getByRole('button', { name: /Дальше/ }));
  await waitFor(() => expect(question()).toBe('Привяжем ФСП ID?'));
  expect(bodies[1]).toEqual({ action: 'answer', stepId: 'documents', value: { uploadIds: ['up1'], urls: ['https://github.com/demo-ryabinin'], claims: 0 } });
});

describe('появление реплики', () => {
  beforeEach(() => {
    // Раскрытие идёт в requestAnimationFrame: подделываем и его, и performance.now.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  });

  it('сначала «печатает», затем текст раскрывается по словам; чипы — только после реплики', () => {
    stubFetch();
    render(<OnboardingChat initial={makeView({ options: OPTS, lead: '', question: 'Кто ты?' })} consentText={[]} />);
    expect(screen.getAllByTestId('typing')).toHaveLength(1);
    expect(screen.queryByTestId('quick-replies')).toBeNull();
    act(() => vi.advanceTimersByTime(typingMs('Кто ты?'.length)));
    expect(screen.queryByTestId('typing')).toBeNull();
    act(() => vi.advanceTimersByTime(32));
    expect(question()?.trim()).toBe('Кто');
    expect(screen.queryByTestId('quick-replies')).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(question()).toBe('Кто ты?');
    expect(screen.getByTestId('quick-replies')).toBeDefined();
  });

  it('тап по реплике показывает её целиком', () => {
    stubFetch();
    render(<OnboardingChat initial={makeView({ options: OPTS, lead: '', question: 'Длинный вопрос про направление' })} consentText={[]} />);
    act(() => vi.advanceTimersByTime(typingMs('Длинный вопрос про направление'.length)));
    act(() => vi.advanceTimersByTime(80));
    expect(screen.queryByTestId('quick-replies')).toBeNull();
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

describe('свободный текст посреди онбординга', () => {
  const enc = new TextEncoder();
  const sse = (events: unknown[]) =>
    new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''))), c.close()) }), { status: 200 });

  it('текст совпал с вариантом шага (без регистра) — ответ тем же путём, что клик', async () => {
    const fetchFn = stubFetch(makeView({ id: 'grade', question: 'Грейд?' }));
    render(<OnboardingChat initial={makeView({ options: OPTS })} consentText={[]} />);
    const box = screen.getByLabelText('Ответ') as HTMLTextAreaElement;
    expect(box.disabled).toBe(false);
    expect(box.placeholder).toBe('Выбери вариант выше или задай вопрос');
    fireEvent.change(box, { target: { value: '  backend! ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(question()).toBe('Грейд?'));
    expect(sent(fetchFn)).toEqual({ action: 'answer', stepId: 'specialization', value: 'backend' });
  });

  it('не совпал — вопрос консультанту в ту же ленту (тот же разговор), под ответом фраза-возврат и снова кнопки шага', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        bodies.push({ url, ...JSON.parse(String(init?.body)) });
        return sse([
          { type: 'conversation', id: 'conv-1' },
          { type: 'delta', id: 'm1', text: 'Fullstack — выбери, где сильнее.' },
          { type: 'message', id: 'm1', text: 'Fullstack — выбери, где сильнее.' },
          { type: 'done' },
        ]);
      }),
    );
    render(<OnboardingChat initial={makeView({ options: OPTS })} consentText={[]} consultant={{ restored: { conversationId: 'conv-1', items: [] } }} />);
    const box = screen.getByLabelText('Ответ');
    fireEvent.change(box, { target: { value: 'А если я fullstack?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Fullstack — выбери, где сильнее.')).toBeDefined());
    expect(bodies[0]).toEqual({ url: '/api/consultant/messages', text: 'А если я fullstack?', onboardingStep: 'specialization', conversationId: 'conv-1' });
    expect(screen.getByText('А если я fullstack?')).toBeDefined();
    expect(screen.getByTestId('ob-return').textContent).toContain('Вернёмся к вопросу: В каком направлении работаешь?');
    expect(screen.getByRole('button', { name: /Backend/ })).toBeDefined();
    expect(question()).toBe('В каком направлении работаешь?');
  });

  it('граница доверия: на согласии поле выключено; на роли — совпадение отвечает, иначе заготовка без запроса', async () => {
    const fetchFn = stubFetch(makeView({ id: 'goal', question: 'Зачем ты здесь?' }));
    const { unmount } = render(<OnboardingChat initial={makeView({ id: 'consent', kind: 'consent', required: true, question: 'Согласие?' }, { role: 'pending', scenario: null })} consentText={[]} />);
    expect((screen.getByLabelText('Ответ') as HTMLTextAreaElement).disabled).toBe(true);
    unmount();

    const ROLE = [
      { value: 'candidate', label: 'Я специалист' },
      { value: 'employer', label: 'Я работодатель' },
    ];
    render(<OnboardingChat initial={makeView({ id: 'role', kind: 'role', required: true, question: 'Ты здесь как кто?', options: ROLE }, { role: 'pending', scenario: null })} consentText={[]} />);
    const box = screen.getByLabelText('Ответ');
    fireEvent.change(box, { target: { value: 'а что вы делаете с данными?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText(/Сначала выбери вариант кнопкой выше/)).toBeDefined();
    expect(fetchFn).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'я специалист' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    // Роль выбрана — /consultant перерисовывается под роль (решение владельца 10.10).
    await waitFor(() => expect(push).toHaveBeenCalledWith('/consultant'));
    expect(sent(fetchFn)).toEqual({ action: 'answer', stepId: 'role', value: 'candidate' });
  });

  it('после перезагрузки вопросы стоят под своим шагом, а встроенный консультант их не дублирует', () => {
    stubFetch();
    const restored = {
      conversationId: 'conv-1',
      items: [
        { id: 'r-1', role: 'user' as const, text: 'Зачем цель?', stepId: 'goal' },
        { id: 'r-2', role: 'agent' as const, event: { type: 'message' as const, text: 'Чтобы подстроить шаги.' }, stepId: 'goal' },
        { id: 'r-3', role: 'user' as const, text: 'Обычный вопрос консультанту' },
      ],
    };
    render(<OnboardingChat initial={summaryView({ onboarded: true })} consentText={[]} consultant={{ restored }} />);
    expect(screen.getAllByText('Зачем цель?')).toHaveLength(1);
    expect(screen.getAllByText('Чтобы подстроить шаги.')).toHaveLength(1);
    expect(screen.getAllByText('Обычный вопрос консультанту')).toHaveLength(1);
    // Вопрос — между репликой шага «Зачем ты здесь?» и ответом «Ищу работу».
    const text = document.body.textContent ?? '';
    expect(text.indexOf('Зачем ты здесь?')).toBeLessThan(text.indexOf('Зачем цель?'));
    expect(text.indexOf('Чтобы подстроить шаги.')).toBeLessThan(text.indexOf('Ищу работу'));
  });
});

describe('лента внутри /consultant (онбординг и консультант — одна страница, решение владельца 10.10)', () => {
  it('роль «работодатель» в ленте /consultant — перерисовка под роль; у работодателя свой заголовок', async () => {
    const ROLE = [
      { value: 'candidate', label: 'Я специалист' },
      { value: 'employer', label: 'Я работодатель' },
    ];
    const fetchFn = stubFetch(makeView({ id: 'companyName', kind: 'text', question: 'Как называется компания?' }, { role: 'employer', scenario: 'employer' }));
    render(<OnboardingChat variant="consultant" initial={makeView({ id: 'role', kind: 'role', required: true, question: 'Ты здесь как кто?', options: ROLE }, { role: 'pending', scenario: null })} consentText={[]} />);
    fireEvent.click(await screen.findByRole('button', { name: /Я работодатель/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/consultant'));
    expect(sent(fetchFn)).toEqual({ action: 'answer', stepId: 'role', value: 'employer' });
    cleanup();
    render(<OnboardingChat variant="consultant" initial={makeView({ id: 'companyName', kind: 'text', question: 'Как называется компания?' }, { role: 'employer', scenario: 'employer' })} consentText={[]} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Помощник по подбору');
  });

  it('заголовок консультанта, без своей шапки сайта и второго main; «Настроить позже» — пауза: сервер ведёт сюда же', async () => {
    const fetchFn = stubFetch({ next: '/consultant' });
    render(<OnboardingChat variant="consultant" initial={makeView({ options: OPTS })} consentText={[]} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Карьерный консультант');
    expect(document.querySelector('main')).toBeNull();
    expect(question()).toBe('В каком направлении работаешь?');
    fireEvent.click(screen.getByRole('button', { name: 'Настроить позже' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/consultant'));
    expect(sent(fetchFn)).toEqual({ action: 'later' });
  });

  it('после итога та же лента продолжается консультантом: шаги онбординга выше, разговор ниже, без перехода', () => {
    stubFetch();
    const restored = { conversationId: 'conv-1', items: [{ id: 'r-3', role: 'user' as const, text: 'Что подтянуть до мидла?' }] };
    render(<OnboardingChat variant="consultant" initial={summaryView({ onboarded: true })} consentText={[]} consultant={{ restored }} />);
    const text = document.body.textContent ?? '';
    expect(text.indexOf('Ищу работу')).toBeGreaterThan(-1);
    expect(text.indexOf('Ищу работу')).toBeLessThan(text.indexOf('Что подтянуть до мидла?'));
    expect(screen.getByRole('link', { name: 'Тест' })).toBeDefined();
    expect(push).not.toHaveBeenCalled();
  });
});
