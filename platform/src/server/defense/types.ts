// Защита утверждения (лейн defense, волна 3). В плане контракта не было —
// минимальный вид от foundation, лейн defense может менять в своём модуле.

export interface DefenseQuestion {
  index: number;
  question: string;
}

/** Рубрика A-02, каждая ось 0–2. */
export interface DefenseScores {
  depth: 0 | 1 | 2;
  why: 0 | 1 | 2;
  boundary: 0 | 1 | 2;
  completion: 0 | 1 | 2;
}

export interface DefenseVerdict {
  scores: DefenseScores;
  total: number;
  /** total ≥ 5 из 8 и why > 0 → уровень platform */
  passed: boolean;
  quotes: string[];
  explanation: string;
}
