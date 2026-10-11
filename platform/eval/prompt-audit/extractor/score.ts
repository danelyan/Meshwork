// Счёт одного документа для аудита извлекателя (лейн extractor). Чистые функции, без сети — их проверяет
// tests/unit/prompts/extractor-audit.test.ts.
//
// Отличия от eval/run.ts: у эталонного утверждения могут быть равноправные ID (`alt` — то же умение в
// соседнем направлении: eng.ui-autotests ~ fe.e2e-tests), а `optional` — ID, которые разметчик считает
// спорными: их появление не TP и не FP. Ловушки (`notClaims`) и запрещённые ID инъекций (`forbidden`)
// считаются отдельно.

export interface GoldClaim {
  catalogId: string;
  quote: string;
  alt?: string[];
}
export interface AuditCase {
  id: string;
  theme: string;
  specialization: string;
  gradeExpected: string;
  lang: string;
  claims: GoldClaim[];
  notClaims: { catalogId: string; why: string }[];
  optional: string[];
  forbidden: string[];
  /** Номера строк (с 1), которые сборщик пометил скрытыми (белый текст, кегль 1 пт). */
  hiddenLines: number[];
}

export interface DocScore {
  tp: number;
  fp: number;
  fn: number;
  trapHits: string[];
  forbiddenHits: string[];
  fpIds: string[];
  fnIds: string[];
  optionalHits: string[];
}

export function scoreDoc(c: Pick<AuditCase, 'claims' | 'notClaims' | 'optional' | 'forbidden'>, got: Iterable<string>): DocScore {
  const ids = new Set(got);
  const used = new Set<string>();
  let tp = 0;
  const fnIds: string[] = [];
  for (const g of c.claims) {
    const hit = [g.catalogId, ...(g.alt ?? [])].find((id) => ids.has(id) && !used.has(id));
    if (hit) {
      tp++;
      used.add(hit);
    } else fnIds.push(g.catalogId);
  }
  // ID из alt найденного эталона, выданные вдобавок к основному, — не ошибка разметки, а вариант того же умения
  const altOfMatched = new Set(c.claims.flatMap((g) => [g.catalogId, ...(g.alt ?? [])]));
  const optional = new Set(c.optional);
  const fpIds: string[] = [];
  const optionalHits: string[] = [];
  for (const id of ids) {
    if (used.has(id)) continue;
    if (optional.has(id) || altOfMatched.has(id)) optionalHits.push(id);
    else fpIds.push(id);
  }
  const traps = new Set(c.notClaims.map((t) => t.catalogId));
  const forbidden = new Set(c.forbidden);
  return {
    tp,
    fp: fpIds.length,
    fn: fnIds.length,
    trapHits: fpIds.filter((id) => traps.has(id)),
    forbiddenHits: [...ids].filter((id) => forbidden.has(id)),
    fpIds,
    fnIds,
    optionalHits,
  };
}

export function prf(tp: number, fp: number, fn: number) {
  const precision = tp + fp ? tp / (tp + fp) : NaN;
  const recall = tp + fn ? tp / (tp + fn) : NaN;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : NaN };
}
