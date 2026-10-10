import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CompanionStage, ReplayButton } from '@/components/avatar/CompanionStage';
import { COMPANION_SAY_EVENT, CompanionVoiceProvider } from '@/components/avatar/voice';
import { detectWebGL } from '@/components/avatar/webgl';
import { Chat } from '@/components/Chat';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

/** Web Audio без звука: decode → буфер, source.start → сразу onended (через микрозадачу). */
class FakeAudioContext {
  static created = 0;
  static started: number[] = [];
  state = 'suspended';
  destination = {};
  constructor() {
    FakeAudioContext.created++;
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => undefined);
  createAnalyser() {
    return { fftSize: 0, connect: vi.fn(), getFloatTimeDomainData: (a: Float32Array) => a.fill(0.1) };
  }
  decodeAudioData = vi.fn(async (b: ArrayBuffer) => ({ duration: 1, bytes: b.byteLength }));
  createBufferSource() {
    const src = {
      buffer: null as unknown,
      onended: null as null | (() => void),
      connect: vi.fn(),
      stop: vi.fn(() => src.onended?.()),
      start: vi.fn(() => {
        FakeAudioContext.started.push(Date.now());
        queueMicrotask(() => src.onended?.());
      }),
    };
    return src;
  }
}

const enc = new TextEncoder();
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const streamOf = (s: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(s));
      c.close();
    },
  });

function stubFetch(mode: 'yandex' | 'off', sse?: string) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/tts' && !init) return Response.json({ mode, maxChars: 1000 });
    if (url === '/api/tts') return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    return new Response(streamOf(sse ?? frame({ type: 'done' })), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const ttsPosts = (fn: ReturnType<typeof stubFetch>) =>
  fn.mock.calls.filter(([u, i]) => u === '/api/tts' && i?.method === 'POST').map(([, i]) => JSON.parse(String(i!.body)).text as string);

beforeEach(() => {
  FakeAudioContext.created = 0;
  FakeAudioContext.started = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('детектор WebGL', () => {
  const win = (getContext: () => unknown, ctor = true) =>
    ({ WebGLRenderingContext: ctor ? function () {} : undefined, document: { createElement: () => ({ getContext }) } }) as never;

  it('нет окна, нет WebGLRenderingContext, контекст не создался или бросил — нет', () => {
    expect(detectWebGL(undefined)).toBe(false);
    expect(detectWebGL(win(() => ({}), false))).toBe(false);
    expect(detectWebGL(win(() => null))).toBe(false);
    expect(
      detectWebGL(
        win(() => {
          throw new Error('blocked');
        }),
      ),
    ).toBe(false);
  });

  it('контекст создался — да (и пробный контекст освобождается)', () => {
    const lose = vi.fn();
    expect(detectWebGL(win(() => ({ getExtension: () => ({ loseContext: lose }) })))).toBe(true);
    expect(lose).toHaveBeenCalled();
  });

  it('jsdom без WebGL — сцена рисует запасной знак ФСП', () => {
    render(
      <CompanionVoiceProvider>
        <CompanionStage />
      </CompanionVoiceProvider>,
    );
    expect(screen.getByTestId('avatar-fallback')).toBeDefined();
  });
});

describe('кнопка «Озвучивать ответы»', () => {
  it('без провайдера голоса аватара и кнопок нет', () => {
    render(
      <>
        <CompanionStage />
        <ReplayButton text="привет" />
      </>,
    );
    expect(screen.queryByTestId('companion-stage')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Озвучить ответ' })).toBeNull();
  });

  it('выключена по умолчанию; клик создаёт и будит AudioContext, спрашивает режим', async () => {
    const fn = stubFetch('yandex');
    render(
      <CompanionVoiceProvider>
        <CompanionStage />
      </CompanionVoiceProvider>,
    );
    const btn = screen.getByRole('button', { name: 'Озвучивать ответы' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(FakeAudioContext.created).toBe(0); // до жеста звук не трогаем
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(FakeAudioContext.created).toBe(1);
    await waitFor(() => expect(fn).toHaveBeenCalledWith('/api/tts'));
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('озвучка выключена на стенде — кнопка отжимается, пояснение текстом', async () => {
    stubFetch('off');
    render(
      <CompanionVoiceProvider>
        <CompanionStage />
      </CompanionVoiceProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Озвучивать ответы' }));
    await waitFor(() => expect(screen.getByText(/Озвучка на этом стенде выключена/)).toBeDefined());
    expect(screen.getByRole('button', { name: 'Озвучивать ответы' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('повтор по кнопке у сообщения и тест из дебаг-панели работают и при выключенной автоозвучке', async () => {
    const fn = stubFetch('yandex');
    render(
      <CompanionVoiceProvider>
        <ReplayButton text="**Привет**, это [ответ](https://x.ru)" />
      </CompanionVoiceProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Озвучить ответ' }));
    await waitFor(() => expect(FakeAudioContext.started.length).toBe(1));
    expect(ttsPosts(fn)).toEqual(['Привет, это ответ']);
    act(() => {
      window.dispatchEvent(new CustomEvent(COMPANION_SAY_EVENT, { detail: { text: 'Тест озвучки.' } }));
    });
    await waitFor(() => expect(FakeAudioContext.started.length).toBe(2));
    expect(ttsPosts(fn)).toEqual(['Привет, это ответ', 'Тест озвучки.']);
  });
});

describe('Chat: озвучка завершённых ответов', () => {
  async function sendWith(sse: string, enable: boolean) {
    const fn = stubFetch('yandex', sse);
    render(<Chat />);
    if (enable) {
      fireEvent.click(screen.getByRole('button', { name: 'Озвучивать ответы' }));
      await waitFor(() => expect(fn).toHaveBeenCalledWith('/api/tts'));
    }
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'Что подтянуть?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    return fn;
  }

  // Переключатель «Озвучивать ответы» живёт в CompanionStage; на /consultant его нет с тех пор,
  // как там голова ConsultantScene (слияние с origin/main 10.10). Авто-озвучка проверена выше.
  it('выключено (по умолчанию): синтез не вызывается, у ответа есть кнопка «озвучить»', async () => {
    const fn = await sendWith(frame({ type: 'message', text: 'Готово.' }) + frame({ type: 'done' }), false);
    await waitFor(() => expect(screen.getByText('Готово.')).toBeDefined());
    expect(ttsPosts(fn)).toEqual([]);
    expect(FakeAudioContext.created).toBe(0);
    expect(screen.getByRole('button', { name: 'Озвучить ответ' })).toBeDefined();
  });
});
