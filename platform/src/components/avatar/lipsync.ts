/**
 * Висемы из спектра звучащей реплики – без таймингов фонем (SpeechKit их не отдаёт) и без ML.
 * Схема как у wawa-lipsync (MIT, wass08): 7 частотных полос, спектральный центроид, громкость,
 * история ~10 кадров → один из 15 висем Oculus (sil, PP, FF, …, aa, E, I, O, U) по правилам на
 * соотношениях полос. Правила и пороги – наши, подобраны под голос SpeechKit `marina` (см.
 * docs/research/20). Висема → форма рта из четырёх параметров для вершинного шейдера Head3D.
 */

/** Параметры рта 0…1: раскрытие, округление (о/у), растяжение уголков (э/и), смыкание (п/б/м, ф/в). */
export interface MouthShape {
  open: number;
  round: number;
  wide: number;
  press: number;
}

export type Viseme = 'sil' | 'PP' | 'FF' | 'DD' | 'kk' | 'SS' | 'nn' | 'aa' | 'E' | 'I' | 'O' | 'U';

export const CLOSED: MouthShape = { open: 0, round: 0, wide: 0, press: 0 };

/** Форма рта для каждой висемы. */
export const VISEME_SHAPE: Record<Viseme, MouthShape> = {
  sil: CLOSED,
  PP: { open: 0, round: 0.1, wide: 0, press: 0.9 },
  FF: { open: 0.15, round: 0, wide: 0.2, press: 0.6 },
  DD: { open: 0.3, round: 0, wide: 0.35, press: 0 },
  kk: { open: 0.3, round: 0, wide: 0.2, press: 0 },
  SS: { open: 0.2, round: 0, wide: 0.5, press: 0.2 },
  nn: { open: 0.1, round: 0, wide: 0.1, press: 0.5 },
  aa: { open: 1, round: 0.1, wide: 0.25, press: 0 },
  E: { open: 0.5, round: 0, wide: 0.85, press: 0 },
  I: { open: 0.3, round: 0, wide: 1, press: 0 },
  O: { open: 0.7, round: 0.9, wide: 0, press: 0 },
  U: { open: 0.35, round: 1, wide: 0, press: 0 },
};

/** Полосы (Гц): низ, F1 нижняя, F1 средняя, F2 передняя, F2/F3, фрикативы, высокие фрикативы. */
export const BANDS: ReadonlyArray<readonly [number, number]> = [
  [50, 200],
  [200, 400],
  [400, 800],
  [800, 1500],
  [1500, 2500],
  [2500, 4000],
  [4000, 8000],
];

export interface SpectrumFeatures {
  /** Средняя амплитуда каждой полосы 0…1. */
  bands: number[];
  /** Среднее по полосам 0…1. */
  volume: number;
  /** Спектральный центроид, Гц. */
  centroid: number;
}

/** Признаки из `AnalyserNode.getByteFrequencyData` (`binWidth` = sampleRate / fftSize). */
export function spectrumFeatures(freq: ArrayLike<number>, binWidth: number): SpectrumFeatures {
  const bands = BANDS.map(([start, end]) => {
    const a = Math.round(start / binWidth);
    const b = Math.min(Math.round(end / binWidth), freq.length);
    if (b <= a) return 0;
    let sum = 0;
    for (let i = a; i < b; i++) sum += freq[i] ?? 0;
    return sum / (b - a) / 255;
  });
  let amp = 0;
  let weighted = 0;
  for (let i = 0; i < freq.length; i++) {
    const v = (freq[i] ?? 0) / 255;
    amp += v;
    weighted += i * binWidth * v;
  }
  return { bands, volume: bands.reduce((s, v) => s + v, 0) / bands.length, centroid: amp > 0 ? weighted / amp : 0 };
}

/** Пороги. Громкость полос у SpeechKit (getByteFrequencyData – дБ-шкала) почти не меняется, информативны отношения. */
const SILENCE = 0.08;

/**
 * Средние уровни полос голоса SpeechKit `marina` (замер 09.10.2026 на 384 кадрах, docs/research/20):
 * стартовое значение нормировки, дальше уточняется бегущим средним по реплике.
 */
export const BAND_PRIOR: readonly number[] = [0.44, 0.76, 0.61, 0.36, 0.28, 0.25, 0.17];

/**
 * Висема по кадру: полосы нормированы на их среднее по реплике (`norm`), чтобы снять спад
 * спектра голоса. Порядок: тишина → взрывной (скачок центроида после тихого) → фрикативы (верх)
 * → огубленные (только низ, низкий центроид) → «а» (F2 800–1500) → «и/э» (F2 1500–2500) → смычка.
 */
export function classifyViseme(cur: SpectrumFeatures, avg: SpectrumFeatures, norm: readonly number[] = BAND_PRIOR): Viseme {
  if (cur.volume < SILENCE * 0.5 || (cur.volume < SILENCE && avg.volume < SILENCE)) return 'sil';
  const r = cur.bands.map((b, i) => b / Math.max(norm[i] ?? 0.1, 0.02));
  const [, , r3 = 0, r4 = 0, r5 = 0, , r7 = 0] = r;
  const dCentroid = cur.centroid - avg.centroid;
  if (dCentroid > 1200 && avg.volume < 0.2) return cur.centroid > 4500 ? 'DD' : 'PP';
  if (r7 > 1.6 && cur.centroid > 4300) return dCentroid > 600 ? 'FF' : 'SS';
  // огубленные: только низ (есть F1), центроид низкий; без F1 это затухание слога, не гласная
  if (cur.centroid < 1700 && r5 < 0.6 && r3 >= 0.75) return r4 < 0.7 ? 'U' : 'O';
  // затухание слога: все полосы ниже среднего – губы смыкаются
  if (cur.volume < 0.25 && r4 < 0.7 && r5 < 0.7) return 'nn';
  if (r5 > 1.3) return r4 > 1.3 ? 'E' : 'I';
  if (r4 > 1.15 && r5 < 1.1) return 'aa';
  if (r4 < 0.8 && r5 < 0.8) return r3 > 0.9 ? 'O' : 'U';
  if (r5 > 1.05 && r4 > 1.05) return 'E';
  return r4 >= r5 ? 'aa' : 'E';
}

/** Экспоненциальное сглаживание формы: быстро открывается, медленнее закрывается (как `smoothLevel`). */
export function smoothShape(prev: MouthShape, target: MouthShape, dtSec: number, attackSec = 0.05, releaseSec = 0.1): MouthShape {
  if (!(dtSec > 0)) return prev;
  const step = (p: number, t: number) => {
    const k = 1 - Math.exp(-dtSec / (t > p ? attackSec : releaseSec));
    return p + (t - p) * k;
  };
  return { open: step(prev.open, target.open), round: step(prev.round, target.round), wide: step(prev.wide, target.wide), press: step(prev.press, target.press) };
}

/**
 * Состояние липсинка на одну реплику: история признаков, текущая висема, минимальная длительность
 * висемы (меньше ~70 мс рот дёргается). `update` вызывается каждый кадр со спектром анализатора.
 */
export class LipSync {
  viseme: Viseme = 'sil';
  /** Последний кадр признаков – для отладки/калибровки. */
  last: SpectrumFeatures | null = null;
  /** Бегущее среднее полос по реплике – нормировка для classifyViseme. */
  norm: number[] = [...BAND_PRIOR];
  private history: SpectrumFeatures[] = [];
  private since = 0;
  constructor(
    private readonly binWidth: number,
    private readonly historySize = 10,
    private readonly minHoldSec = 0.07,
  ) {}

  reset(): void {
    this.history = [];
    this.norm = [...BAND_PRIOR];
    this.viseme = 'sil';
    this.since = 0;
  }

  update(freq: ArrayLike<number>, dtSec: number): Viseme {
    const cur = spectrumFeatures(freq, this.binWidth);
    this.last = cur;
    this.history.push(cur);
    if (this.history.length > this.historySize) this.history.shift();
    // нормировка подтягивается к реальному голосу только на звучащих кадрах, постоянная ≈ 1.5 с
    if (cur.volume > SILENCE) {
      const k = 1 - Math.exp(-dtSec / 1.5);
      this.norm = this.norm.map((n, i) => n + ((cur.bands[i] ?? n) - n) * k);
    }
    const avg = this.average(cur);
    const next = classifyViseme(cur, avg, this.norm);
    this.since += dtSec;
    if (next !== this.viseme && (this.since >= this.minHoldSec || next === 'sil')) {
      this.viseme = next;
      this.since = 0;
    }
    return this.viseme;
  }

  get shape(): MouthShape {
    return VISEME_SHAPE[this.viseme];
  }

  private average(fallback: SpectrumFeatures): SpectrumFeatures {
    const n = this.history.length;
    if (n === 0) return fallback;
    const bands = BANDS.map((_, i) => this.history.reduce((s, f) => s + (f.bands[i] ?? 0), 0) / n);
    return {
      bands,
      volume: this.history.reduce((s, f) => s + f.volume, 0) / n,
      centroid: this.history.reduce((s, f) => s + f.centroid, 0) / n,
    };
  }
}
