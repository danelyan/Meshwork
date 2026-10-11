/**
 * Поддельный микрофон для тестов созвона: getUserMedia + AudioContext с ScriptProcessorNode, кадры которого тест
 * подаёт сам (feed). Счётчики открытых потоков и контекстов — для проверки утечек.
 */
export interface FakeAudio {
  /** Подать кадр с постоянной амплитудой (RMS = |amp|) во все живые процессоры. */
  feed: (amp: number, n?: number) => void;
  openTracks: () => number;
  openContexts: () => number;
  getUserMedia: ReturnType<typeof vi.fn>;
  restore: () => void;
}

export const FAKE_RATE = 16_000;
export const FAKE_BUFFER = 2048;

export function installFakeAudio(): FakeAudio {
  const tracks: { stopped: boolean }[] = [];
  const contexts: { closed: boolean; procs: { onaudioprocess: ((e: unknown) => void) | null; connected: boolean }[] }[] = [];

  class FakeCtx {
    state = 'running';
    sampleRate = FAKE_RATE;
    destination = {};
    closed = false;
    procs: { onaudioprocess: ((e: unknown) => void) | null; connected: boolean }[] = [];
    constructor() {
      contexts.push(this);
    }
    createMediaStreamSource() {
      return { connect: () => undefined, disconnect: () => undefined };
    }
    createAnalyser() {
      return { fftSize: 512, connect: () => undefined, disconnect: () => undefined, getByteTimeDomainData: (a: Uint8Array) => a.fill(128) };
    }
    createScriptProcessor() {
      const p = { onaudioprocess: null as ((e: unknown) => void) | null, connected: true, connect: () => undefined, disconnect: () => { p.connected = false; } };
      this.procs.push(p);
      return p;
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      this.closed = true;
      this.state = 'closed';
      return Promise.resolve();
    }
  }

  const getUserMedia = vi.fn(async () => {
    const t = { stopped: false, stop: () => { t.stopped = true; }, kind: 'audio', getSettings: () => ({ deviceId: 'mic-1' }), label: 'Mic' };
    tracks.push(t);
    return { getTracks: () => [t], getAudioTracks: () => [t] } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices: vi.fn(async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'Mic' }]) } });
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  return {
    feed(amp, n = 1) {
      for (let i = 0; i < n; i++) {
        const data = new Float32Array(FAKE_BUFFER).fill(amp);
        for (const c of contexts) if (!c.closed) for (const p of c.procs) if (p.connected) p.onaudioprocess?.({ inputBuffer: { getChannelData: () => data } });
      }
    },
    openTracks: () => tracks.filter((t) => !t.stopped).length,
    /** Открытые контексты микрофона (с ScriptProcessor); контекст озвучки сюда не входит. */
    openContexts: () => contexts.filter((c) => !c.closed && c.procs.length > 0).length,
    getUserMedia,
    restore() {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    },
  };
}
