// Семантический сигнал подбора (R-N-02): «смежные навыки» — требования потребности, которые кандидат не закрыл
// точно, но закрыл близким по смыслу утверждением. Локально и детерминированно, без внешних моделей и сети:
// TF-IDF по символьным 3–4-граммам (ловит словоформы и написания: «Postgres» ~ «PostgreSQL», «очереди» ~ «очередь»)
// + связи adjacent из каталога навыков (claims-catalog.json).
//
// ПРЕДЛОЖЕНИЕ агента: порог SEMANTIC_MIN_SIM, доля ADJACENT_SIM и вес сигнала (weights.ts, SEMANTIC_WEIGHT) —
// калибровка на eval/matching (docs/validation-results.md, «Абляция подбора»), не на реальных данных.
import type { CatalogEntry } from '../claims/types';
import type { Need } from '../recommend/evidence';

/** Сходство ниже порога считаем шумом (общие служебные слова каталога). */
export const SEMANTIC_MIN_SIM = 0.2;
/** Требование связано с утверждением кандидата через adjacent каталога: минимум такого сходства. */
export const ADJACENT_SIM = 0.5;

export interface SemanticMatch {
  /** Требование потребности (формулировка каталога) или метка стека. */
  need: string;
  /** Чем закрыто: формулировка утверждения кандидата. */
  via: string;
  /** Сходство 0…1. */
  sim: number;
}

export interface SemanticResult {
  /** Доля веса потребности, закрытая смежными навыками: 0…1. */
  score: number;
  /** Лучшие совпадения, сильнейшие первыми (до 3). */
  matches: SemanticMatch[];
}

type Vec = Map<string, number>;

function grams(text: string): string[] {
  const norm = ` ${text.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}#+]+/gu, ' ').trim()} `;
  if (norm.trim().length === 0) return [];
  const out: string[] = [];
  for (const n of [3, 4]) for (let i = 0; i + n <= norm.length; i++) {
    const g = norm.slice(i, i + n);
    if (g.trim().length >= 2) out.push(g);
  }
  return out;
}

/** IDF по корпусу каталога (формулировки + маркеры): общие для всех записей n-граммы весят меньше. Кэш на каталог. */
const idfCache = new WeakMap<Map<string, CatalogEntry>, { idf: Map<string, number>; max: number }>();
function idfOf(catalog: Map<string, CatalogEntry>) {
  let v = idfCache.get(catalog);
  if (v) return v;
  const df = new Map<string, number>();
  for (const e of catalog.values()) for (const g of new Set(grams(entryText(e)))) df.set(g, (df.get(g) ?? 0) + 1);
  const N = Math.max(1, catalog.size);
  const idf = new Map<string, number>();
  for (const [g, n] of df) idf.set(g, Math.log(1 + N / n));
  v = { idf, max: Math.log(1 + N) };
  idfCache.set(catalog, v);
  return v;
}

function entryText(e: CatalogEntry): string {
  return `${e.statement} ${(e.markers ?? []).join(' ')}`;
}

function vec(text: string, idf: { idf: Map<string, number>; max: number }): Vec {
  const tf = new Map<string, number>();
  for (const g of grams(text)) tf.set(g, (tf.get(g) ?? 0) + 1);
  const v: Vec = new Map();
  let norm = 0;
  for (const [g, f] of tf) {
    const w = (1 + Math.log(f)) * (idf.idf.get(g) ?? idf.max);
    v.set(g, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (const [g, w] of v) v.set(g, w / norm);
  return v;
}

function cosine(a: Vec, b: Vec): number {
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [g, w] of s) dot += w * (l.get(g) ?? 0);
  return dot;
}

/** Косинус TF-IDF по символьным n-граммам двух текстов (IDF — по каталогу). Пустой текст — 0. */
export function textSimilarity(a: string, b: string, catalog: Map<string, CatalogEntry>): number {
  const idf = idfOf(catalog);
  return cosine(vec(a, idf), vec(b, idf));
}

export interface SemanticClaim { catalogId: string; statement: string; quote: string }

/**
 * Смежные навыки: для каждого требования, не закрытого точно (`coveredIds`), — лучшее сходство с утверждениями
 * кандидата (TF-IDF n-грамм; связь adjacent каталога — не ниже ADJACENT_SIM); для метки стека, не найденной
 * в утверждениях, — то же по тексту метки. score = Σ вес × сходство / Σ всех весов (метка стека весит 1).
 * Точно закрытое здесь не учитывается: его уже засчитало покрытие.
 */
export function semanticSignal(
  claims: readonly SemanticClaim[],
  needs: readonly Need[],
  stack: readonly string[],
  coveredIds: ReadonlySet<string>,
  matchedStack: readonly string[],
  catalog: Map<string, CatalogEntry>,
): SemanticResult {
  const totalW = needs.reduce((s, n) => s + n.weight, 0) + stack.length;
  if (!claims.length || totalW <= 0) return { score: 0, matches: [] };
  const idf = idfOf(catalog);
  const docs = claims.map((c) => {
    const e = catalog.get(c.catalogId);
    return { c, adjacent: new Set(e?.adjacent ?? []), v: vec(`${c.statement} ${c.quote} ${e ? (e.markers ?? []).join(' ') : ''}`, idf) };
  });
  const own = new Set(claims.map((c) => c.catalogId));
  let sum = 0;
  const matches: SemanticMatch[] = [];
  const best = (q: Vec, needId: string | null) => {
    let sim = 0;
    let via = '';
    const needAdj = needId ? new Set(catalog.get(needId)?.adjacent ?? []) : new Set<string>();
    for (const d of docs) {
      let s = cosine(q, d.v);
      if (needId && (d.adjacent.has(needId) || needAdj.has(d.c.catalogId))) s = Math.max(s, ADJACENT_SIM);
      if (s > sim) { sim = s; via = d.c.statement; }
    }
    return { sim: sim >= SEMANTIC_MIN_SIM ? Math.min(1, sim) : 0, via };
  };
  for (const n of needs) {
    if (coveredIds.has(n.catalogId) || own.has(n.catalogId)) continue;
    const e = catalog.get(n.catalogId);
    if (!e) continue;
    const r = best(vec(entryText(e), idf), n.catalogId);
    if (r.sim > 0) { sum += n.weight * r.sim; matches.push({ need: e.statement, via: r.via, sim: r.sim }); }
  }
  const lowerMatched = new Set(matchedStack.map((t) => t.toLowerCase()));
  for (const t of stack) {
    if (lowerMatched.has(t.toLowerCase())) continue;
    const r = best(vec(t, idf), null);
    if (r.sim > 0) { sum += r.sim; matches.push({ need: t, via: r.via, sim: r.sim }); }
  }
  matches.sort((a, b) => b.sim - a.sim || a.need.localeCompare(b.need));
  return { score: Math.min(1, sum / totalW), matches: matches.slice(0, 3).map((m) => ({ ...m, sim: Math.round(m.sim * 100) / 100 })) };
}

/** «Postgres ≈ Проектировал схему БД… (0,69)» — строка фактора «Смежные навыки». */
export function semanticText(m: SemanticMatch): string {
  return `${m.need} ≈ ${m.via} (${String(m.sim).replace('.', ',')})`;
}
