// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompanionVoice } from '@/components/avatar/voice';
import { ACK_COOLDOWN_MS, ACK_SOFT_MS, useAck } from '@/components/call/useAck';

const MANIFEST = { think: ['think_01.mp3', 'think_02.mp3'], listen: ['listen_01.mp3', 'listen_02.mp3'], soft: ['soft_01.mp3'] };
const LONG = 'Я работал над сервисом оплаты на Go, там были очереди и ретраи';

function mkVoice(status: CompanionVoice['status'] = 'idle') {
  return { status, playClip: vi.fn(async () => undefined) } as unknown as CompanionVoice & { playClip: ReturnType<typeof vi.fn> };
}

function setup(manifest: unknown = MANIFEST, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => manifest })));
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useAck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('играет ack после принятой фразы', async () => {
    setup();
    const voice = mkVoice();
    const { result } = renderHook(() => useAck({ voice, enabled: true, userSpeaking: false, random: () => 0.1 }));
    act(() => result.current.onTurn(LONG));
    await flush();
    expect(voice.playClip).toHaveBeenCalledTimes(1);
    expect(String(voice.playClip.mock.calls[0]?.[0])).toMatch(/^\/ack\/listen_0\d\.mp3$/);
  });

  it('кубик не выпал - не играет', async () => {
    setup();
    const voice = mkVoice();
    const { result } = renderHook(() => useAck({ voice, enabled: true, userSpeaking: false, random: () => 0.99 }));
    act(() => result.current.onTurn(LONG));
    await flush();
    expect(voice.playClip).not.toHaveBeenCalled();
  });

  it('фраза без ack (приветствие) - не играет', async () => {
    setup();
    const voice = mkVoice();
    const { result } = renderHook(() => useAck({ voice, enabled: true, userSpeaking: false, random: () => 0 }));
    act(() => result.current.onTurn('Здравствуйте'));
    await flush();
    expect(voice.playClip).not.toHaveBeenCalled();
  });

  it('кулдаун 7 с и ротация без повторов подряд', async () => {
    setup();
    const voice = mkVoice();
    const { result } = renderHook(() => useAck({ voice, enabled: true, userSpeaking: false, random: () => 0 }));
    act(() => result.current.onTurn(LONG));
    await flush();
    act(() => result.current.onTurn(LONG));
    await flush();
    expect(voice.playClip).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACK_COOLDOWN_MS);
    });
    act(() => result.current.onTurn(LONG));
    await flush();
    const files = voice.playClip.mock.calls.map((c) => c[0]);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files[1]).not.toBe(files[0]);
  });

  it('soft через 2.9 с, если Кира молчит', async () => {
    setup();
    const voice = mkVoice();
    const { result } = renderHook(() => useAck({ voice, enabled: true, userSpeaking: false, random: () => 0.99 }));
    act(() => result.current.onTurn(LONG));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACK_SOFT_MS + 10);
    });
    expect(voice.playClip).toHaveBeenCalledWith('/ack/soft_01.mp3');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(voice.playClip).toHaveBeenCalledTimes(1);
  });

  it('soft отменяется, когда Кира зазвучала', async () => {
    setup();
    const voice = mkVoice();
    const { result, rerender } = renderHook((v: ReturnType<typeof mkVoice>) => useAck({ voice: v, enabled: true, userSpeaking: false, random: () => 0.99 }), { initialProps: voice });
    act(() => result.current.onTurn(LONG));
    await flush();
    const speaking = { ...voice, status: 'speaking' as const, playClip: voice.playClip } as unknown as ReturnType<typeof mkVoice>;
    rerender(speaking);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACK_SOFT_MS + 100);
    });
    expect(voice.playClip).not.toHaveBeenCalled();
  });

  it('soft отменяется, когда кандидат заговорил, и при завершении созвона', async () => {
    setup();
    const voice = mkVoice();
    const { result, rerender } = renderHook((p: { s: boolean; e: boolean }) => useAck({ voice, enabled: p.e, userSpeaking: p.s, random: () => 0.99 }), { initialProps: { s: false, e: true } });
    act(() => result.current.onTurn(LONG));
    rerender({ s: true, e: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACK_SOFT_MS + 100);
    });
    expect(voice.playClip).not.toHaveBeenCalled();
    rerender({ s: false, e: true });
    act(() => result.current.onTurn(LONG));
    rerender({ s: false, e: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACK_SOFT_MS + 100);
    });
    expect(voice.playClip).not.toHaveBeenCalled();
  });

  it('без манифеста (404 или пустой) ничего не падает и не играет', async () => {
    for (const [m, ok] of [[{}, false], [{ think: [], listen: [], soft: [] }, true]] as const) {
      setup(m, ok);
      const voice = mkVoice();
      const { result, unmount } = renderHook(() => useAck({ voice, enabled: true, userSpeaking: false, random: () => 0 }));
      act(() => result.current.onTurn(LONG));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ACK_SOFT_MS + 100);
      });
      expect(voice.playClip).not.toHaveBeenCalled();
      unmount();
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const voice = mkVoice();
    const { result } = renderHook(() => useAck({ voice, enabled: true, userSpeaking: false, random: () => 0 }));
    act(() => result.current.onTurn(LONG));
    await flush();
    expect(voice.playClip).not.toHaveBeenCalled();
  });
});
