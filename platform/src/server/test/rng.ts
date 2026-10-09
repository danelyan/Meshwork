// Детерминированный генератор (mulberry32): один seed → одна последовательность.
// На нём держится повторяемость попытки (ADR-0002): seed попытки → seed'ы заданий → параметры.

export interface Rng {
  /** [0; 1) */
  next(): number;
  /** Целое в [min; max] включительно. */
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  /** Перемешанная копия (Фишер–Йетс). */
  shuffle<T>(arr: readonly T[]): T[];
  /** Выбор k разных элементов. */
  sample<T>(arr: readonly T[], k: number): T[];
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const shuffle = <T>(arr: readonly T[]): T[] => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return {
    next,
    int,
    pick: (arr) => arr[int(0, arr.length - 1)]!,
    shuffle,
    sample: (arr, k) => shuffle(arr).slice(0, k),
  };
}

/** Производный seed: seed попытки + номер задания → seed экземпляра (31 бит, без отрицательных). */
export function deriveSeed(base: number, index: number): number {
  let h = (base ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (index + 1), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h & 0x7fffffff;
}

/** Случайный seed попытки (31 бит). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
