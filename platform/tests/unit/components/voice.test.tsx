import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { Composer } from '@/components/chat/Composer';
import { effectiveMode, toPcm16 } from '@/components/chat/voice';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.body.dataset.stt;
  localStorage.clear();
});

function Harness() {
  const [v, setV] = useState('Мой стек:');
  const send = vi.fn();
  return <Composer label="Сообщение" value={v} onChange={setV} onSubmit={send} voice />;
}

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  interimResults = false;
  continuous = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  constructor() {
    FakeRecognition.last = this;
  }
}
const result = (text: string, isFinal: boolean) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });

describe('голосовой ввод: Web Speech API (распознаёт браузер)', () => {
  it('первый клик — объяснение; запись дописывает текст в поле по ходу речи; сам не отправляет', () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Надиктовать голосом' }));
    expect(screen.getByRole('dialog', { name: 'Голосовой ввод' }).textContent).toContain('Распознаёт браузер');
    expect(FakeRecognition.last).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Начать запись' }));
    const rec = FakeRecognition.last!;
    expect(rec.start).toHaveBeenCalled();
    expect(rec.lang).toBe('ru-RU');
    expect(screen.getByRole('status').textContent).toContain('распознаёт браузер');
    act(() => rec.onresult?.(result('Go и Postgres', false)));
    expect((screen.getByLabelText('Сообщение') as HTMLTextAreaElement).value).toBe('Мой стек: Go и Postgres');
    act(() => rec.onresult?.(result('Go и PostgreSQL', true)));
    fireEvent.click(screen.getByRole('button', { name: 'Остановить запись' }));
    expect((screen.getByLabelText('Сообщение') as HTMLTextAreaElement).value).toBe('Мой стек: Go и PostgreSQL ');
    // согласие запомнено: следующий клик сразу пишет
    fireEvent.click(screen.getByRole('button', { name: 'Надиктовать голосом' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('нет доступа к микрофону — понятная ошибка', () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    localStorage.setItem('fsp.voice.ok', '1');
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Надиктовать голосом' }));
    act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }));
    expect(screen.getByRole('alert').textContent).toContain('Нет доступа к микрофону');
  });

  it('браузер без распознавания — кнопка неактивна с объяснением; STT_PROVIDER=off — кнопки нет', () => {
    const { unmount } = render(<Harness />);
    const btn = screen.getByRole('button', { name: 'Голосовой ввод недоступен' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('не умеет распознавать речь');
    unmount();
    document.body.dataset.stt = 'off';
    render(<Harness />);
    expect(screen.queryByTestId('voice-button')).toBeNull();
    expect(screen.queryByRole('button', { name: /Голосовой ввод/ })).toBeNull();
  });
});

describe('голосовой ввод: Yandex SpeechKit (запись LPCM → /api/stt)', () => {
  it('запись → стоп → POST /api/stt с LPCM 16 кГц → текст в поле', async () => {
    document.body.dataset.stt = 'yandex';
    localStorage.setItem('fsp.voice.ok', '1');
    let onaudio: ((e: unknown) => void) | null = null;
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    class FakeCtx {
      sampleRate = 48_000;
      destination = {};
      createMediaStreamSource = () => node();
      createAnalyser = () => ({ ...node(), fftSize: 0, getByteTimeDomainData: (a: Uint8Array) => a.fill(128) });
      createScriptProcessor = () => {
        const n = { ...node(), set onaudioprocess(f: (e: unknown) => void) { onaudio = f; } };
        return n;
      };
      close = vi.fn(async () => {});
    }
    vi.stubGlobal('AudioContext', FakeCtx);
    const track = { stop: vi.fn() };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: 'пишу на Go' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Надиктовать голосом' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Остановить запись' })).toBeDefined());
    // секунда тишины 48 кГц
    act(() => onaudio!({ inputBuffer: { getChannelData: () => new Float32Array(48_000) } }));
    fireEvent.click(screen.getByRole('button', { name: 'Остановить запись' }));
    await waitFor(() => expect((screen.getByLabelText('Сообщение') as HTMLTextAreaElement).value).toBe('Мой стек: пишу на Go '));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/stt');
    expect((init.body as Uint8Array).byteLength).toBe(32_000);
    expect(track.stop).toHaveBeenCalled();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });
});

describe('voice: чистые функции', () => {
  it('toPcm16: 48 кГц → 16 кГц, 16 бит LE, клиппинг', () => {
    const pcm = toPcm16([new Float32Array([1, 1, 1, -1, -1, -1]), new Float32Array([0, 0, 0])], 48_000);
    const view = new DataView(pcm.buffer);
    expect(pcm.byteLength).toBe(6);
    expect(view.getInt16(0, true)).toBe(0x7fff);
    expect(view.getInt16(2, true)).toBe(-0x8000);
    expect(view.getInt16(4, true)).toBe(0);
  });
  it('effectiveMode: off остаётся off; browser без API — off с причиной', () => {
    expect(effectiveMode('off')).toEqual({ mode: 'off' });
    expect(effectiveMode('browser').mode).toBe('off');
  });
});
