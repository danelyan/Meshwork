import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { CompanionVoiceProvider, useCompanionVoice } from '@/components/avatar/voice';

/** duck вместо kill: рампа громкости на GainNode между analyser и выходом; stop возвращает полную громкость. */
describe('CompanionVoice.duck', () => {
  it('рампа к 0.12 за 120 мс, обратно к 1 за 250 мс; stop – сразу 1', () => {
    const calls: unknown[][] = [];
    const gain = {
      value: 1,
      cancelScheduledValues: vi.fn((t: number) => calls.push(['cancel', t])),
      setValueAtTime: vi.fn((v: number, t: number) => calls.push(['set', v, t])),
      linearRampToValueAtTime: vi.fn((v: number, t: number) => calls.push(['ramp', v, t])),
    };
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    class FakeCtx {
      sampleRate = 48_000;
      currentTime = 10;
      state = 'running';
      destination = {};
      createAnalyser = () => ({ ...node(), fftSize: 0, frequencyBinCount: 512 });
      createGain = () => ({ ...node(), gain });
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
    }
    vi.stubGlobal('AudioContext', FakeCtx);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ mode: 'off' }), { status: 200 })));
    const wrapper = ({ children }: { children: ReactNode }) => <CompanionVoiceProvider>{children}</CompanionVoiceProvider>;
    const { result } = renderHook(() => useCompanionVoice(), { wrapper });
    act(() => result.current!.toggle());

    act(() => result.current!.duck(true));
    expect(calls).toEqual([['cancel', 10], ['set', 1, 10], ['ramp', 0.12, 10.12]]);
    calls.length = 0;
    gain.value = 0.12;
    act(() => result.current!.duck(false));
    expect(calls).toEqual([['cancel', 10], ['set', 0.12, 10], ['ramp', 1, 10.25]]);
    calls.length = 0;
    act(() => result.current!.stop());
    expect(calls).toEqual([['cancel', 10], ['set', 0.12, 10], ['set', 1, 10]]);
    vi.unstubAllGlobals();
  });
});
