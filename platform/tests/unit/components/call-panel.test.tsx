import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AvatarScene } from '@/components/avatar/AvatarScene';
import { Composer } from '@/components/chat/Composer';
import { useCallMode } from '@/components/call/CallContext';
import type { CallView, TranscriptEntry } from '@/server/call/types';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/avatar/HeadView', () => ({ HeadView: () => <div data-testid="head-view" /> }));

const q = (index: number, text: string): TranscriptEntry => ({ index, role: 'ai', text, at: '2026-10-10T12:00:00.000Z', tMs: index * 1000, meta: { topic: 'Индексы', catalogId: 'be.idx', level: 1, routedBy: null } });
const view = (over: Partial<CallView> = {}): CallView => ({
  id: 'call-1',
  kind: 'qualifying',
  status: 'active',
  projectSubmissionId: null,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  access: 'full',
  transcript: [q(0, 'Привет! Что такое индекс?')],
  verdict: null,
  hasRecording: false,
  progress: { answered: 0, minQuestions: 4, maxQuestions: 6, canFinish: false, awaitingAnswer: true },
  participants: [],
  policyVersion: 'v',
  disclaimer: 'd',
  ...over,
});

type Handler = (url: string, init?: RequestInit) => unknown;
let routes: Record<string, Handler>;
const calls: { url: string; body?: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
      calls.push({ url: key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const h = routes[key];
      if (!h) return new Response(JSON.stringify({ mode: 'off' }), { status: 200 });
      const out = h(url, init);
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  routes = {
    'GET /api/call': () => ({ consent: { given: false, version: 'cv-1', text: ['Созвон записывается.'] }, calls: [] }),
    'POST /api/call/consent': () => ({ version: 'cv-1', acceptedAt: 'x' }),
    'POST /api/call/start': () => ({ sessionId: 'call-1', resumed: false, webrtc: { iceServers: [] }, call: view() }),
    'POST /api/call/call-1/turn': () => ({
      candidate: { index: 1, role: 'candidate', text: 'B-дерево', at: 'x', tMs: 1 },
      ai: q(2, 'Почему именно B-дерево?'),
      text: 'Почему именно B-дерево?',
      done: false,
    }),
    'POST /api/call/call-1/finish': () =>
      view({
        status: 'finished',
        verdict: {
          kind: 'qualifying',
          depthMap: [{ topic: 'Индексы', catalogId: 'be.idx', claimed: true, claimStatement: null, probed: 2, maxLevel: 2, confirmed: true, status: 'confirmed', scores: { depth: 2, why: 2, boundary: 1, completion: 1 }, total: 6, quote: 'B-дерево', runs: [] }],
          runs: 3,
          validRuns: 3,
          upgradedCatalogIds: ['be.idx'],
          summary: 'Подтверждено тем: 1 из 1.',
          evaluatedAt: 'x',
          thresholdVersion: 'v',
          disclaimer: 'Созвон не меняет категорию.',
        },
      }),
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function OpenButton() {
  const call = useCallMode();
  return (
    <button type="button" onClick={() => call?.start()}>
      открыть
    </button>
  );
}

function renderScene(kind?: 'interview') {
  return render(
    <AvatarScene variant="call-side" call callKind={kind}>
      <div data-testid="feed">
        лента <OpenButton />
      </div>
    </AvatarScene>,
  );
}

describe('CallPanel — режим звонка в сцене консультанта', () => {
  it('согласие → старт → ответ текстом → завершить → карта глубины; лента на паузе', async () => {
    renderScene();
    expect(screen.queryByTestId('call-panel')).toBeNull();
    fireEvent.click(screen.getByText('открыть'));
    expect(await screen.findByTestId('call-consent')).toBeTruthy();
    expect(screen.getByText('Созвон записывается.')).toBeTruthy();
    expect(screen.getByTestId('side-panel').hasAttribute('inert')).toBe(true);

    fireEvent.click(screen.getByText('Согласен, начать созвон'));
    expect(await screen.findByText('Привет! Что такое индекс?')).toBeTruthy();
    expect(calls.find((c) => c.url === 'POST /api/call/consent')?.body).toEqual({ version: 'cv-1' });
    expect(screen.getByTestId('call-rec').textContent).toContain('Запись');
    expect((screen.getByTestId('call-finish') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('Текстом'));
    fireEvent.change(screen.getByLabelText('Ответ текстом'), { target: { value: 'B-дерево' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Ответить'));
    });
    expect(await screen.findByText('Почему именно B-дерево?')).toBeTruthy();
    expect(calls.find((c) => c.url === 'POST /api/call/call-1/turn')?.body).toEqual({ text: 'B-дерево' });

    await waitFor(() => expect((screen.getByTestId('call-finish') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('call-finish'));
    expect(await screen.findByTestId('depth-map')).toBeTruthy();
    expect(screen.getByText('Подтверждено тем: 1 из 1.')).toBeTruthy();
    expect(screen.getByText('подтверждено')).toBeTruthy();

    fireEvent.click(screen.getByText('Вернуться в чат'));
    expect(screen.queryByTestId('call-panel')).toBeNull();
    expect(screen.getByTestId('side-panel').hasAttribute('inert')).toBe(false);
  });

  it('согласие уже дано — созвон стартует сразу', async () => {
    routes['GET /api/call'] = () => ({ consent: { given: true, version: 'cv-1', text: [] }, calls: [] });
    renderScene();
    fireEvent.click(screen.getByText('открыть'));
    expect(await screen.findByText('Привет! Что такое индекс?')).toBeTruthy();
    expect(screen.queryByTestId('call-consent')).toBeNull();
  });

  it('кнопка «Созвониться» в композере — только когда передан onCall', () => {
    const onCall = vi.fn();
    const { rerender } = render(<Composer label="m" value="" onChange={() => {}} onSubmit={() => {}} />);
    expect(screen.queryByTestId('call-button')).toBeNull();
    rerender(<Composer label="m" value="" onChange={() => {}} onSubmit={() => {}} onCall={onCall} />);
    fireEvent.click(screen.getByTestId('call-button'));
    expect(onCall).toHaveBeenCalledOnce();
  });

  it('кнопка входа в композере: «Созвониться» до теста, «ИИнтервью» после', () => {
    const { rerender } = render(<Composer label="m" value="" onChange={() => {}} onSubmit={() => {}} onCall={() => {}} />);
    expect(screen.getByTestId('call-button').getAttribute('aria-label')).toBe('Созвониться');
    rerender(<Composer label="m" value="" onChange={() => {}} onSubmit={() => {}} onCall={() => {}} callKind="interview" />);
    expect(screen.getByTestId('call-button').getAttribute('aria-label')).toBe('ИИнтервью');
  });

  it('созвон недоступен (readiness): кнопка disabled, причина в title; готовая — с подсказкой про смысл', () => {
    const { rerender } = render(<Composer label="m" value="" onChange={() => {}} onSubmit={() => {}} onCall={() => {}} callBlocked="ИИнтервью откроется после теста" />);
    const btn = screen.getByTestId('call-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('ИИнтервью откроется после теста');
    rerender(<Composer label="m" value="" onChange={() => {}} onSubmit={() => {}} onCall={() => {}} />);
    expect((screen.getByTestId('call-button') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('call-button').title).toContain('проверено платформой');
  });
});

const iq = (index: number, text: string): TranscriptEntry => ({
  index,
  role: 'ai',
  text,
  at: '2026-10-10T12:00:00.000Z',
  tMs: index * 1000,
  meta: { topic: 'Данные и хранение', catalogId: 'be.data', competencyId: 'backend.data', block: 'test', level: 1, routedBy: null },
});

describe('CallPanel — вид «ИИнтервью» (после теста на грейд)', () => {
  beforeEach(() => {
    routes['GET /api/call'] = () => ({ consent: { given: true, version: 'cv-1', text: [] }, calls: [] });
    routes['POST /api/call/start'] = () => ({ sessionId: 'call-1', resumed: false, webrtc: { iceServers: [] }, call: view({ kind: 'interview', transcript: [iq(0, 'Расскажи, как ты проектировал схему данных?')] }) });
    routes['POST /api/call/call-1/turn'] = () => ({
      candidate: { index: 1, role: 'candidate', text: 'Пропускаю этот вопрос.', at: 'x', tMs: 1 },
      ai: iq(2, 'Как устроены индексы?'),
      text: 'Как устроены индексы?',
      done: false,
    });
  });

  it('стартует интервью, показывает блок и этапы, «Пропустить» шлёт ответ-пропуск, «Уточнить» — подсказку', async () => {
    renderScene('interview');
    fireEvent.click(screen.getByText('открыть'));
    expect(await screen.findByText('Расскажи, как ты проектировал схему данных?')).toBeTruthy();
    expect(calls.find((c) => c.url === 'POST /api/call/start')?.body).toEqual({ kind: 'interview' });
    expect(screen.getByText('ИИнтервью')).toBeTruthy();
    expect(screen.getByTestId('call-block').textContent).toBe('Разбор теста');
    expect(screen.getByTestId('interview-progress').textContent).toContain('вопрос 1 из');
    expect(screen.getByTestId('interview-steps')).toBeTruthy();

    await waitFor(() => expect((screen.getByText('Уточнить вопрос') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Уточнить вопрос'));
    expect(screen.getByTestId('call-hint').textContent).toContain('Поясню');
    expect(calls.some((c) => c.url === 'POST /api/call/call-1/turn')).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByText('Пропустить'));
    });
    expect(await screen.findByText('Как устроены индексы?')).toBeTruthy();
    expect(calls.find((c) => c.url === 'POST /api/call/call-1/turn')?.body).toEqual({ text: 'Пропускаю этот вопрос.' });
  });

  it('прошлый завершённый интервью показывается итогом, без нового старта', async () => {
    routes['GET /api/call'] = () => ({
      consent: { given: true, version: 'cv-1', text: [] },
      calls: [view({ kind: 'interview', status: 'finished', verdict: null })],
    });
    renderScene('interview');
    fireEvent.click(screen.getByText('открыть'));
    expect(await screen.findByText('Интервью закрыто без оценки: ответов не было или оценщик был недоступен.')).toBeTruthy();
    expect(calls.some((c) => c.url === 'POST /api/call/start')).toBe(false);
    expect(screen.getByText('Пройти ещё раз')).toBeTruthy();
  });
});
