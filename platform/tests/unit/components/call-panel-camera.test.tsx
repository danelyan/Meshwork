// Камера в созвоне с Кирой (kind=qualifying): по умолчанию включена (разрешение запрашивается на шаге проверки устройств), галочка снимается
// или кнопкой в панели; отказ в доступе — созвон идёт без видео; сегменты уходят на POST /api/call/{id}/video до finish.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AvatarScene } from '@/components/avatar/AvatarScene';
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
  // Один ответ уже есть — «Завершить» доступна сразу.
  transcript: [q(0, 'Как устроен индекс?'), { index: 1, role: 'candidate', text: 'B-дерево', at: 'x', tMs: 1 }, q(2, 'Привет! Что такое индекс?')],
  verdict: null,
  hasRecording: false,
  videoSegments: [],
  progress: { answered: 1, minQuestions: 1, maxQuestions: 6, canFinish: true, awaitingAnswer: true },
  participants: [],
  policyVersion: 'v',
  disclaimer: 'd',
  ...over,
});

let routes: Record<string, () => unknown>;
const calls: { key: string; url: string; body?: unknown }[] = [];

const track = () => ({ stop: vi.fn(), getSettings: () => ({ deviceId: 'dev' }) });
const stream = () => {
  const t = track();
  return { getTracks: () => [t], getAudioTracks: () => [t], getVideoTracks: () => [t] } as unknown as MediaStream;
};
let gum: ReturnType<typeof vi.fn>;
let camDenied = false;

/** MediaRecorder по MDN: stop() → dataavailable с Blob → stop. */
class FakeRecorder {
  static isTypeSupported = () => true;
  static made: FakeRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: ((e: Event) => void) | null = null;
  constructor(
    public stream: MediaStream,
    public opts: unknown,
  ) {
    FakeRecorder.made.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45])], { type: 'video/webm' }) });
    this.onstop?.(new Event('stop'));
  }
}

class FakeAudioCtx {
  state = 'running';
  sampleRate = 16_000;
  destination = {};
  createMediaStreamSource() {
    return { connect: () => undefined, disconnect: () => undefined };
  }
  createAnalyser() {
    return { fftSize: 512, connect: () => undefined, disconnect: () => undefined, getByteTimeDomainData: (a: Uint8Array) => a.fill(128) };
  }
  createScriptProcessor() {
    return { onaudioprocess: null, connect: () => undefined, disconnect: () => undefined };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

beforeEach(() => {
  calls.length = 0;
  camDenied = false;
  FakeRecorder.made = [];
  routes = {
    'GET /api/call': () => ({ consent: { given: true, mode: 'audio', version: 'cv-1', text: [] }, calls: [] }),
    'POST /api/call/start': () => ({ sessionId: 'call-1', resumed: false, webrtc: { iceServers: [] }, call: view() }),
    'POST /api/call/call-1/video': () => new Response(JSON.stringify({ name: '000-0.webm', startMs: 0 }), { status: 201 }),
    'POST /api/call/call-1/finish': () => view({ status: 'finished' }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
      calls.push({ key, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
      const h = routes[key];
      if (!h) return new Response(JSON.stringify({ mode: 'off' }), { status: 200 });
      const out = h();
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  vi.stubGlobal('SpeechRecognition', class {});
  // Свободный разговор (useRoomMic.canRecord) требует AudioContext - без него шаг устройств пропускается.
  vi.stubGlobal('AudioContext', FakeAudioCtx);
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  gum = vi.fn(async (c: MediaStreamConstraints) => {
    if (c.video && camDenied) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    return stream();
  });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: gum, enumerateDevices: vi.fn(async () => []) } });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

function OpenButton() {
  const call = useCallMode();
  return (
    <button type="button" onClick={() => call?.start()}>
      открыть
    </button>
  );
}

const renderScene = () =>
  render(
    <AvatarScene variant="call-side" call>
      <div>
        лента <OpenButton />
      </div>
    </AvatarScene>,
  );

const videoCalls = () => gum.mock.calls.filter((c) => (c[0] as MediaStreamConstraints).video);

async function toDevices() {
  renderScene();
  fireEvent.click(screen.getByText('открыть'));
  expect(await screen.findByTestId('call-devices')).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('granted'));
}

describe('CallPanel — камера в созвоне с Кирой', () => {
  it('галочка снята: после старта камеру не просим, кнопка «Камера» есть', async () => {
    await toDevices();
    const box = screen.getByTestId('call-devices-camera') as HTMLInputElement;
    expect(box.checked).toBe(true); // по умолчанию включена — разрешение запрашивается сразу
    await waitFor(() => expect(videoCalls()).toHaveLength(1));
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByTestId('call-devices-go'));
    expect(await screen.findByText('Привет! Что такое индекс?')).toBeTruthy();
    expect(videoCalls()).toHaveLength(1); // только превью на шаге устройств, в созвоне не просили
    expect(screen.queryByTestId('call-camera-preview')).toBeNull();
    const btn = screen.getByTestId('call-camera');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('камера по умолчанию → превью на шаге устройств, камера включается в созвоне; finish сначала отправляет сегмент видео', async () => {
    await toDevices();
    await waitFor(() => expect(videoCalls()).toHaveLength(1)); // превью на шаге проверки (галочка стоит по умолчанию)
    fireEvent.click(screen.getByTestId('call-devices-go'));
    expect(await screen.findByTestId('call-camera-preview')).toBeTruthy();
    expect(videoCalls()).toHaveLength(2);
    expect(screen.getByTestId('call-camera').getAttribute('aria-pressed')).toBe('true');
    expect(FakeRecorder.made).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId('call-finish'));
    });
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/call/call-1/finish')).toBe(true));
    const keys = calls.map((c) => c.key);
    const vIdx = keys.indexOf('POST /api/call/call-1/video');
    expect(vIdx).toBeGreaterThan(-1);
    expect(vIdx).toBeLessThan(keys.indexOf('POST /api/call/call-1/finish'));
    const up = calls[vIdx]!;
    expect(up.url).toMatch(/\/api\/call\/call-1\/video\?startMs=\d+$/);
    expect(up.body).toBeInstanceOf(Blob);
  });

  it('включение кнопкой в панели; отказ в разрешении (NotAllowedError) — подсказка, созвон идёт без видео', async () => {
    await toDevices();
    fireEvent.click(screen.getByTestId('call-devices-camera')); // снять галочку: созвон начинается без камеры
    fireEvent.click(screen.getByTestId('call-devices-go'));
    expect(await screen.findByText('Привет! Что такое индекс?')).toBeTruthy();
    camDenied = true;
    await act(async () => {
      fireEvent.click(screen.getByTestId('call-camera'));
    });
    expect((await screen.findByTestId('call-camera-error')).textContent).toContain('Созвон идёт без видео');
    expect(screen.queryByTestId('call-camera-preview')).toBeNull();
    expect(screen.getByTestId('call-panel').dataset.phase).toBe('live');
    expect(calls.some((c) => c.key === 'POST /api/call/call-1/video')).toBe(false);

    camDenied = false;
    await act(async () => {
      fireEvent.click(screen.getByTestId('call-camera'));
    });
    expect(await screen.findByTestId('call-camera-preview')).toBeTruthy();
    expect(screen.getByTestId('call-camera').getAttribute('aria-pressed')).toBe('true');
  });

  it('согласие на запись отозвано (созвон текстом): ни галочки, ни кнопки камеры', async () => {
    routes['GET /api/call'] = () => ({ consent: { given: false, mode: 'text', version: 'cv-1', text: [] }, calls: [] });
    renderScene();
    fireEvent.click(screen.getByText('открыть'));
    expect(await screen.findByText('Привет! Что такое индекс?')).toBeTruthy();
    expect(screen.queryByTestId('call-devices-camera')).toBeNull();
    expect(screen.queryByTestId('call-camera')).toBeNull();
    expect(videoCalls()).toHaveLength(0);
  });
});
