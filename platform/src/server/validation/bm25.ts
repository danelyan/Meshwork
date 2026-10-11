// Baseline BM25 (Okapi, вариант Lucene: idf = ln(1 + (N − df + 0,5)/(df + 0,5)) ≥ 0). Без зависимостей.
// Токены: нижний регистр, буквы/цифры/«.#+» (C#, Node.js), «стемминг» — обрезка до 6 знаков (грубо снимает русские окончания).

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}.#+]*/gu)) {
    const t = m[0].replace(/[.]+$/, '');
    if (t.length >= 2) out.push(t.length > 6 ? t.slice(0, 6) : t);
  }
  return out;
}

export interface Bm25Doc { id: string; text: string }

/** Ранжирует документы по запросу: по убыванию балла, равные — по id. Документы с нулевым баллом остаются в хвосте. */
export function bm25Rank(docs: Bm25Doc[], query: string, k1 = BM25_K1, b = BM25_B): { id: string; score: number }[] {
  const toks = docs.map((d) => tokenize(d.text));
  const N = docs.length;
  const avgdl = toks.reduce((s, t) => s + t.length, 0) / Math.max(1, N);
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const q = [...new Set(tokenize(query))];
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const w of toks[i]!) tf.set(w, (tf.get(w) ?? 0) + 1);
    const dl = toks[i]!.length;
    let score = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const n = df.get(w)!;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / (avgdl || 1)));
    }
    return { id: d.id, score };
  });
  return scored.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
}
