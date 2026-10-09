/**
 * Рот аватара по громкости: RMS окна AnalyserNode → сглаживание (быстро открывается, медленнее
 * закрывается) → открытие рта 0…1 с порогом тишины. Это не фонемный липсинк: рот двигается
 * в ритм слогов (у SpeechKit нет таймингов фонем — docs/research/19, вывод 1).
 */

/** Среднеквадратичная амплитуда окна (float-отсчёты −1…1). */
export function rms(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/**
 * Экспоненциальное сглаживание с разными постоянными времени на рост (attack) и спад (release).
 * Не зависит от частоты кадров: шаг учитывает `dtSec`.
 */
export function smoothLevel(prev: number, target: number, dtSec: number, attackSec = 0.04, releaseSec = 0.12): number {
  if (!(dtSec > 0)) return prev;
  const tau = target > prev ? attackSec : releaseSec;
  const k = 1 - Math.exp(-dtSec / tau);
  return prev + (target - prev) * k;
}

/** RMS → открытие рта: ниже порога — закрыт; речь SpeechKit даёт RMS ≈ 0.05–0.25. */
export function mouthOpen(level: number, gate = 0.015, full = 0.2): number {
  if (!(level > gate)) return 0;
  const x = Math.min(1, (level - gate) / (full - gate));
  return Math.pow(x, 0.8);
}
