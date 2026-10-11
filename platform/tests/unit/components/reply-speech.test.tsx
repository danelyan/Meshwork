// Панель созвона консультанта: озвучка реплики по предложениям и из потока (лейн call-speed, 11.10).
// Очередь — голос компаньона (voice.tsx); каждая часть играет через тот же AnalyserNode, что читает липсинк.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CompanionVoiceProvider, useCompanionVoice } from '@/components/avatar/voice';
import { planRest, useReplySpeech } from '@/components/call/useReplySpeech';
import type { TranscriptEntry } from '@/server/call/types';

const analysers: object[] = [];
const sources: { connect: ReturnType<typeof vi.fn> }[] = [];
class FakeAudioContext {
  state = 'running';
  destination = {};
  sampleRate = 48000;
  currentTime = 0;
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createAnalyser() {
    const a = { fftSize: 0, frequencyBinCount: 512, connect: vi.fn(), getFloatTimeDomainData: (x: Float32Array) => x.fill(0), getByteFrequencyData: () => undefined };
    analysers.push(a);
    return a;
  }
  decodeAudioData = vi.fn(async () => ({ duration: 0.01 }));
  createBufferSource() {
    const src = {
      buffer: null as unknown,
      onended: null as null | (() => void),
      connect: vi.fn(),
      stop: vi.fn(() => src.onended?.()),
      start: vi.fn(() => queueMicrotask(() => src.onended?.())),
    };
    sources.push(src);
    return src;
  }
}

let posts: string[] = [];
beforeEach(() => {
  posts = [];
  analysers.length = 0;
  sources.length = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/tts' && !init) return Response.json({ mode: 'yandex', maxChars: 1000 });
      posts.push(JSON.parse(String(init!.body)).text as string);
      return new Response(new Uint8Array([1, 2, 3]));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const entry = (index: number, text: string): TranscriptEntry => ({ index, role: 'ai', text, at: '2026-10-11T00:00:00Z', tMs: 0 }) as TranscriptEntry;

function Harness({ text }: { text: string }) {
  const voice = useCompanionVoice();
  const reply = useReplySpeech(voice, 'c1');
  return (
    <>
      <button onClick={() => voice?.toggle()}>звук</button>
      <button onClick={() => reply.onDelta(3, 0, 'Хорошо, понял тебя.')}>d0</button>
      <button onClick={() => reply.onDelta(3, 1, 'Теперь про кэш.')}>d1</button>
      <button onClick={() => reply.speakEntry(entry(4, text))}>реплика</button>
      <span data-testid="status">{voice?.status}</span>
    </>
  );
}

const TEXT = 'Хорошо, понял тебя. Теперь про кэш. Как ты выбираешь время жизни ключа?';

describe('useReplySpeech + очередь голоса', () => {
  it('без потока: реплика озвучивается по предложениям, по очереди, через анализатор липсинка', async () => {
    render(<CompanionVoiceProvider><Harness text={TEXT} /></CompanionVoiceProvider>);
    fireEvent.click(screen.getByText('звук'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('idle'));
    await act(async () => fireEvent.click(screen.getByText('реплика')));
    await waitFor(() => expect(sources.length).toBe(3));
    expect(posts).toEqual(['Хорошо, понял тебя.', 'Теперь про кэш.', 'Как ты выбираешь время жизни ключа?']);
    // Каждая часть идёт в тот же AnalyserNode, из которого липсинк читает спектр.
    expect(analysers).toHaveLength(1);
    for (const s of sources) expect(s.connect).toHaveBeenCalledWith(analysers[0]);
  });

  it('с потоком: предложения звучат сразу, реплика целиком досказывает только остаток', async () => {
    render(<CompanionVoiceProvider><Harness text={TEXT} /></CompanionVoiceProvider>);
    fireEvent.click(screen.getByText('звук'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('idle'));
    await act(async () => {
      fireEvent.click(screen.getByText('d0'));
      fireEvent.click(screen.getByText('d1'));
    });
    await waitFor(() => expect(posts).toEqual(['Хорошо, понял тебя.', 'Теперь про кэш.']));
    await act(async () => fireEvent.click(screen.getByText('реплика')));
    await waitFor(() => expect(posts).toHaveLength(3));
    expect(posts[2]).toBe('Как ты выбираешь время жизни ключа?');
    for (const s of sources) expect(s.connect).toHaveBeenCalledWith(analysers[0]);
  });
});

describe('planRest', () => {
  it('остаток после прозвучавшего; расхождение помечается; бюджет частей держится', () => {
    expect(planRest(TEXT, ['Хорошо, понял тебя.'])).toMatchObject({ from: 1, mismatch: false });
    expect(planRest(TEXT, ['Другое начало.']).mismatch).toBe(true);
    const six = 'Первое предложение реплики. Второе предложение реплики. Третье предложение реплики. Четвёртое предложение реплики. Пятое предложение реплики. Шестое предложение реплики.';
    const p = planRest(six, ['Первое предложение реплики.', 'Второе предложение реплики.']);
    expect(p.parts.length).toBeLessThanOrEqual(2);
    expect(p.parts.reduce((s, x) => s + x.sentences, 0)).toBe(4);
  });
});
