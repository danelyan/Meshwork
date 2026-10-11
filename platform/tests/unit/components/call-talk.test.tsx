import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import type { CompanionVoice } from '@/components/avatar/voice';
import { CALL_PHRASE_MAX_MS, useCallTalk, type CallTalkOptions } from '@/components/call/useCallTalk';
import { STT_MAX_SECONDS } from '@/server/stt';

import { FAKE_BUFFER, FAKE_RATE, installFakeAudio, type FakeAudio } from './call-fake-audio';

/**
 * Мок детектора: амплитуда кадра — команда. 0.9 — speech_start, 0.5 — речь идёт, 0.1 — speech_end, 0 — тишина.
 * Реальный детектор (пороги, confirmMs, bargeInMs) покрыт tests/unit/lib/vad.test.ts; здесь — ход разговора.
 */
const playingSeen: boolean[] = [];
vi.mock('@/lib/vad', () => {
  class MicGate<F> {
    speaking = false;
    seq = 0;
    forceEnd() {
      const was = this.speaking;
      this.speaking = false;
      return was ? `u-${this.seq}` : null;
    }
    step(frame: F, rms: number, playing: boolean) {
      playingSeen.push(playing);
      if (rms > 0.8 && !this.speaking) {
        this.speaking = true;
        this.seq += 1;
        return { event: { kind: 'speech_start', utteranceId: `u-${this.seq}` }, send: [frame] };
      }
      if (rms > 0.3 && this.speaking) return { event: null, send: [frame] };
      if (rms > 0.05 && this.speaking) {
        this.speaking = false;
        return { event: { kind: 'speech_end', utteranceId: `u-${this.seq}` }, send: [frame] };
      }
      return { event: null, send: [] };
    }
  }
  return { DEFAULT_VAD: { frameMs: 40 }, MicGate };
});

const frameMs = (FAKE_BUFFER / FAKE_RATE) * 1000; // 128 мс

function fakeVoice(status: CompanionVoice['status'] = 'idle') {
  return { status, stop: vi.fn(), speak: vi.fn() } as unknown as CompanionVoice & { stop: ReturnType<typeof vi.fn> };
}

let audio: FakeAudio;
beforeEach(() => {
  document.body.dataset.stt = 'yandex';
  audio = installFakeAudio();
  playingSeen.length = 0;
});
afterEach(() => {
  cleanup();
  audio.restore();
  vi.unstubAllGlobals();
  delete document.body.dataset.stt;
});

function setup(over: Partial<CallTalkOptions> = {}) {
  const onPhrase = vi.fn(async () => true);
  const onResume = vi.fn();
  const props: CallTalkOptions = { active: true, voice: fakeVoice(), busy: false, onPhrase, onResume, ...over };
  const hook = renderHook((p: CallTalkOptions) => useCallTalk(p), { initialProps: props });
  return { hook, onPhrase, onResume, props };
}

async function opened() {
  await waitFor(() => expect(audio.openTracks()).toBe(1));
}

/** Фраза: старт + n кадров речи + конец. */
async function say(n: number) {
  await act(async () => {
    audio.feed(0.9);
    audio.feed(0.5, n);
    audio.feed(0.1);
  });
}

describe('useCallTalk — созвон без кнопки «Ответить»', () => {
  it('микрофон открыт сразу; speech_start → «Вы говорите», speech_end → фраза уходит в STT', async () => {
    const { hook, onPhrase } = setup();
    await opened();
    await waitFor(() => expect(hook.result.current.state).toBe('listening'));
    await act(async () => {
      audio.feed(0.9);
      audio.feed(0.5, 4);
    });
    expect(hook.result.current.state).toBe('user');
    await act(async () => audio.feed(0.1));
    await waitFor(() => expect(onPhrase).toHaveBeenCalledTimes(1));
    const u = (onPhrase.mock.calls[0] as unknown as [{ pcm: Uint8Array | null; browserText: string | null }])[0];
    // 6 кадров по 2048 сэмплов 16 кГц → 12288 сэмплов × 2 байта
    expect(u.pcm?.byteLength).toBe(6 * FAKE_BUFFER * 2);
    expect(u.browserText).toBeNull();
  });

  it('короткая «фраза» (кашель) не отправляется; долгая тишина — тоже', async () => {
    const { onPhrase } = setup();
    await opened();
    await act(async () => audio.feed(0, 50)); // ~6 с тишины
    await say(0); // 2 кадра ≈ 256 мс < 300 мс
    await new Promise((r) => setTimeout(r, 20));
    expect(onPhrase).not.toHaveBeenCalled();
  });

  it('перебивание: кандидат заговорил, пока Кира звучит — озвучка остановлена, ответ подавлен, порог детектора — «ИИ звучит»', async () => {
    const voice = fakeVoice('speaking');
    const { hook } = setup({ voice });
    await opened();
    await act(async () => audio.feed(0, 2));
    expect(playingSeen.every(Boolean)).toBe(true);
    await act(async () => audio.feed(0.9));
    expect(voice.stop).toHaveBeenCalledTimes(1);
    expect(hook.result.current.hushed()).toBe(true);
    hook.result.current.unhush();
    expect(hook.result.current.hushed()).toBe(false);
  });

  it('ложное перебивание (фраза без текста) — Кира продолжает (onResume)', async () => {
    const voice = fakeVoice('speaking');
    const onPhrase = vi.fn(async () => false);
    const { hook, onResume } = setup({ voice, onPhrase });
    await opened();
    await say(4);
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
    expect(hook.result.current.hushed()).toBe(false);
  });

  it('без звучащей Киры речь кандидата озвучку не трогает', async () => {
    const voice = fakeVoice('idle');
    setup({ voice });
    await opened();
    await say(4);
    expect(voice.stop).not.toHaveBeenCalled();
  });

  it('потолок фразы: длиннее лимита STT — уходит сказанное, не дожидаясь паузы', async () => {
    expect(CALL_PHRASE_MAX_MS).toBeLessThan(STT_MAX_SECONDS * 1000);
    const { onPhrase } = setup();
    await opened();
    const frames = Math.ceil(CALL_PHRASE_MAX_MS / frameMs);
    await act(async () => {
      audio.feed(0.9);
      audio.feed(0.5, frames);
    });
    await waitFor(() => expect(onPhrase).toHaveBeenCalledTimes(1));
    const u = (onPhrase.mock.calls[0] as unknown as [{ pcm: Uint8Array }])[0];
    expect(u.pcm.byteLength / 2 / FAKE_RATE).toBeLessThanOrEqual(STT_MAX_SECONDS);
  });

  it('mute: поток закрыт, ничего не отправляется; снова вкл — микрофон открывается', async () => {
    const { hook, onPhrase } = setup();
    await opened();
    await act(async () => {
      audio.feed(0.9);
      audio.feed(0.5, 4);
    });
    act(() => hook.result.current.setMuted(true));
    expect(hook.result.current.state).toBe('muted');
    await waitFor(() => expect(audio.openTracks()).toBe(0));
    expect(audio.openContexts()).toBe(0);
    await act(async () => audio.feed(0.1));
    expect(onPhrase).not.toHaveBeenCalled();
    act(() => hook.result.current.setMuted(false));
    await opened();
  });

  it('текстовый режим / созвон не идёт — микрофон не открывается', async () => {
    setup({ active: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(audio.getUserMedia).not.toHaveBeenCalled();
  });

  it('созвон завершён, вкладка скрыта, панель закрыта — поток и AudioContext освобождены', async () => {
    const { hook, props } = setup();
    await opened();
    hook.rerender({ ...props, active: false });
    await waitFor(() => expect(audio.openTracks()).toBe(0));
    expect(audio.openContexts()).toBe(0);

    hook.rerender(props);
    await opened();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(audio.openTracks()).toBe(0));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await opened();

    hook.unmount();
    expect(audio.openTracks()).toBe(0);
    expect(audio.openContexts()).toBe(0);
  });

  it('закрытие во время запроса доступа к микрофону не оставляет поток открытым', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const orig = audio.getUserMedia.getMockImplementation() as (...a: unknown[]) => Promise<MediaStream>;
    audio.getUserMedia.mockImplementation(async (...a: unknown[]) => {
      await gate;
      return orig(...a);
    });
    const { hook } = setup();
    await waitFor(() => expect(audio.getUserMedia).toHaveBeenCalled());
    hook.unmount();
    await act(async () => release());
    await new Promise((r) => setTimeout(r, 10));
    expect(audio.openTracks()).toBe(0);
    expect(audio.openContexts()).toBe(0);
  });
});
