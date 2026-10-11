/**
 * Энергетический детектор речи для режима звонка: конечный автомат над RMS кадров микрофона.
 * Чистые функции – состояние снаружи, тесты без Web Audio. Порт moko/frontend/src/pages/meetup/audio/vad.ts:
 * адаптивный шумовой пол, поднятый порог во время озвучки ИИ (защита от остаточного эха – основное
 * давит echoCancellation в getUserMedia), фаза «кандидата»: речь должна продержаться confirmMs
 * (при звучащем ИИ – bargeInMs), иначе кашель и стук клавиш глушили бы говорящего интервьюера.
 */
export type VadPhase = 'idle' | 'attack' | 'candidate' | 'speaking' | 'release';

export interface VadConfig {
  frameMs: number;
  /** Кадров подряд выше порога до кандидата. */
  attackFrames: number;
  /** Речи в кандидате до speech_start в тишине. */
  confirmMs: number;
  /** То же, пока ИИ звучит: цена ложного перебивания выше. */
  bargeInMs: number;
  /** Пауза внутри кандидата, после которой он сбрасывается. */
  confirmGapMs: number;
  /** Тишины до speech_end (hangover). */
  releaseMs: number;
  /** Порог = шумовой пол × margin. */
  margin: number;
  /** Доп. множитель порога, пока ИИ звучит. */
  playbackMargin: number;
  noiseFloorMin: number;
  /** Скорость адаптации пола (EMA), только в тишине. */
  noiseAdapt: number;
}

export const DEFAULT_VAD: VadConfig = {
  frameMs: 40,
  attackFrames: 3,
  confirmMs: 160,
  bargeInMs: 450,
  confirmGapMs: 240,
  releaseMs: 700,
  margin: 2.5,
  playbackMargin: 2.0,
  noiseFloorMin: 0.0035,
  noiseAdapt: 0.05,
};

export interface VadState {
  phase: VadPhase;
  noiseFloor: number;
  /** attack: кадров подряд; candidate: кадров речи; release: осталось hangover. */
  counter: number;
  /** candidate: кадров тишины подряд. */
  gap: number;
  utteranceSeq: number;
}

export type VadEvent = { kind: 'speech_start' | 'speech_end'; utteranceId: string } | { kind: 'false_start'; heldMs: number };

export function initialVad(cfg: VadConfig = DEFAULT_VAD): VadState {
  return { phase: 'idle', noiseFloor: cfg.noiseFloorMin * 3, counter: 0, gap: 0, utteranceSeq: 0 };
}

export function vadThreshold(state: VadState, playbackActive: boolean, cfg: VadConfig): number {
  return state.noiseFloor * cfg.margin * (playbackActive ? cfg.playbackMargin : 1);
}

function frames(ms: number, cfg: VadConfig): number {
  return Math.max(0, Math.round(ms / cfg.frameMs));
}

export function confirmFrames(playbackActive: boolean, cfg: VadConfig): number {
  return frames(playbackActive ? cfg.bargeInMs : cfg.confirmMs, cfg);
}

function start(state: VadState): [VadState, VadEvent] {
  const utteranceSeq = state.utteranceSeq + 1;
  return [{ ...state, phase: 'speaking', counter: 0, gap: 0, utteranceSeq }, { kind: 'speech_start', utteranceId: `u-${utteranceSeq}` }];
}

export function vadStep(state: VadState, rms: number, playbackActive: boolean, cfg: VadConfig = DEFAULT_VAD): [VadState, VadEvent | null] {
  const above = rms > vadThreshold(state, playbackActive, cfg);
  const releaseFrames = Math.max(1, frames(cfg.releaseMs, cfg));
  switch (state.phase) {
    case 'idle': {
      if (above) return [{ ...state, phase: 'attack', counter: 1, gap: 0 }, null];
      const noiseFloor = Math.max(cfg.noiseFloorMin, state.noiseFloor + (rms - state.noiseFloor) * cfg.noiseAdapt);
      return [{ ...state, noiseFloor }, null];
    }
    case 'attack': {
      if (!above) return [{ ...state, phase: 'idle', counter: 0 }, null];
      const counter = state.counter + 1;
      if (counter < cfg.attackFrames) return [{ ...state, counter }, null];
      if (confirmFrames(playbackActive, cfg) <= 0) return start(state);
      return [{ ...state, phase: 'candidate', counter: 0, gap: 0 }, null];
    }
    case 'candidate': {
      if (above) {
        const counter = state.counter + 1;
        if (counter >= confirmFrames(playbackActive, cfg)) return start(state);
        return [{ ...state, counter, gap: 0 }, null];
      }
      const gap = state.gap + 1;
      if (gap <= frames(cfg.confirmGapMs, cfg)) return [{ ...state, gap }, null];
      const heldMs = (cfg.attackFrames + state.counter + gap) * cfg.frameMs;
      return [{ ...state, phase: 'idle', counter: 0, gap: 0 }, { kind: 'false_start', heldMs }];
    }
    case 'speaking': {
      if (above) return [state, null];
      return [{ ...state, phase: 'release', counter: releaseFrames }, null];
    }
    case 'release': {
      if (above) return [{ ...state, phase: 'speaking', counter: 0 }, null];
      const counter = state.counter - 1;
      if (counter > 0) return [{ ...state, counter }, null];
      return [{ ...state, phase: 'idle', counter: 0 }, { kind: 'speech_end', utteranceId: `u-${state.utteranceSeq}` }];
    }
  }
}

export function isSpeech(state: VadState): boolean {
  return state.phase === 'speaking' || state.phase === 'release';
}

export function isPending(state: VadState): boolean {
  return state.phase === 'attack' || state.phase === 'candidate';
}

/** Кадров прерола перед speech_start (~320 мс при 40 мс): начало фразы распознаётся целиком. */
export const PREROLL_FRAMES = 8;
/** Потолок фразы: дольше – детектор залип на эхе, фразу закрываем принудительно. */
export const MAX_PHRASE_MS = 60_000;

export interface GateResult<F> {
  event: VadEvent | null;
  /** Кадры фразы: после speech_start (с преролом) и до speech_end включительно. */
  send: F[];
}

/**
 * Ворота микрофона: какие кадры входят во фразу. Кадры до подтверждения речи копятся (прерол и кандидат)
 * и уходят вместе со speech_start; шум, не ставший фразой, выбрасывается. Порт moko gate.ts без автокалибровки.
 */
export class MicGate<F> {
  private vad: VadState;
  private preroll: F[] = [];
  private pending: F[] = [];
  private phraseFrames = 0;
  constructor(private cfg: VadConfig = DEFAULT_VAD) {
    this.vad = initialVad(cfg);
  }

  get state(): VadState {
    return this.vad;
  }

  reset(): void {
    this.vad = initialVad(this.cfg);
    this.preroll = [];
    this.pending = [];
    this.phraseFrames = 0;
  }

  /** Закрыть фразу принудительно (микрофон выключили): id фразы или null. */
  forceEnd(): string | null {
    const id = isSpeech(this.vad) ? `u-${this.vad.utteranceSeq}` : null;
    this.vad = { ...this.vad, phase: 'idle', counter: 0, gap: 0 };
    this.preroll = [];
    this.pending = [];
    this.phraseFrames = 0;
    return id;
  }

  step(frame: F, rms: number, playing: boolean): GateResult<F> {
    const wasSpeech = isSpeech(this.vad);
    const [next, event] = vadStep(this.vad, rms, playing, this.cfg);
    this.vad = next;
    if (wasSpeech && isSpeech(next) && !event) {
      this.phraseFrames += 1;
      if (this.phraseFrames > MAX_PHRASE_MS / this.cfg.frameMs) {
        this.phraseFrames = 0;
        const utteranceId = `u-${next.utteranceSeq}`;
        this.vad = { ...next, phase: 'idle', counter: 0 };
        return { event: { kind: 'speech_end', utteranceId }, send: [frame] };
      }
    } else if (!isSpeech(next)) {
      this.phraseFrames = 0;
    }
    if (event?.kind === 'speech_start') {
      const send = [...this.preroll, ...this.pending, frame];
      this.preroll = [];
      this.pending = [];
      return { event, send };
    }
    if (event?.kind === 'false_start') {
      this.pending = [];
      return { event, send: [] };
    }
    if (event?.kind === 'speech_end' || isSpeech(next)) return { event, send: [frame] };
    if (isPending(next)) {
      this.pending.push(frame);
    } else {
      this.pending = [];
      this.preroll.push(frame);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
    }
    return { event: null, send: [] };
  }
}
