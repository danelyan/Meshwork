// Проверка подбора на чужом наборе (критерий 1, R-M-01…R-M-04): вакансии, кандидаты и разметка 0/1/2 →
// НАШЕ ранжирование (тот же rankCandidates + dropUncovered, что подборка под потребность в кабинете) и
// базовая линия → P@k, nDCG@k, MRR. Всё в памяти, без БД и сети; вход – граница доверия (Zod + лимиты).
import { z } from 'zod';

import { GRADES } from '@/lib/grades';
import { SPECIALIZATIONS } from '@/lib/directions';

import { maxPrecisionAtK, ndcgAtK, precisionAtK } from '../../../eval/matching/metrics';
import { catalogFromFile } from '../claims/catalog-file';
import type { CatalogEntry } from '../claims/types';
import { dropUncovered, rankCandidates, type CandidateEvidence } from '../employer/ranking';

/** Лимиты входа: тело, число объектов, длины строк. Вычисление ≤ 50 × 1000 оценок – доли секунды. */
export const EVAL_LIMITS = {
  bodyBytes: 1024 * 1024,
  vacancies: 50,
  candidates: 1000,
  needsPerVacancy: 60,
  claimsPerCandidate: 200,
  stackItems: 30,
  idChars: 100,
  textChars: 200,
  kMax: 20,
} as const;

const Id = z
  .string()
  .min(1)
  .max(EVAL_LIMITS.idChars)
  .regex(/^[\w.:-]+$/, { error: 'id: только латиница, цифры и символы . _ : -' })
  .refine((s) => s !== '__proto__', { error: 'id: имя __proto__ зарезервировано' });
const Spec = z.enum(SPECIALIZATIONS);
const Grade = z.enum(GRADES);
const Level = z.enum(['self_reported', 'artifact', 'third_party', 'platform']);
const Tag = z.string().min(1).max(50);

const Vacancy = z.object({
  id: Id,
  title: z.string().max(EVAL_LIMITS.textChars).optional(),
  specialization: Spec,
  grade: Grade,
  subcategoryId: z.string().max(EVAL_LIMITS.idChars).nullish(),
  needs: z
    .array(z.object({ catalogId: Id, weight: z.number().int().min(1).max(3).default(2) }))
    .min(1)
    .max(EVAL_LIMITS.needsPerVacancy),
  stack: z.array(Tag).max(EVAL_LIMITS.stackItems).optional(),
});

const Candidate = z.object({
  id: Id,
  specialization: Spec.nullish(),
  fspState: z.enum(['not_linked', 'no_achievements', 'unavailable', 'linked']).default('not_linked'),
  category: z.object({ specialization: Spec, grade: Grade, subcategoryId: z.string().max(EVAL_LIMITS.idChars).nullish() }).nullish(),
  subcategoryId: z.string().max(EVAL_LIMITS.idChars).nullish(),
  stack: z.array(Tag).max(EVAL_LIMITS.stackItems).optional(),
  claims: z.array(z.object({ catalogId: Id, level: Level.default('self_reported') })).max(EVAL_LIMITS.claimsPerCandidate),
});

/** Входной набор POST /api/evaluate. Лишние поля игнорируются. */
export const EvaluateInput = z.object({
  k: z.number().int().min(1).max(EVAL_LIMITS.kMax).default(5),
  vacancies: z.array(Vacancy).min(1).max(EVAL_LIMITS.vacancies),
  candidates: z.array(Candidate).min(1).max(EVAL_LIMITS.candidates),
  /** relevance[vacancyId][candidateId] = 0 | 1 | 2; кого нет – 0. */
  relevance: z.record(Id, z.record(Id, z.union([z.literal(0), z.literal(1), z.literal(2)]))),
});
export type EvaluateInput = z.input<typeof EvaluateInput>;
type Parsed = z.output<typeof EvaluateInput>;

export interface Metrics {
  precision: number;
  ndcg: number;
  mrr: number;
}
export interface TopItem {
  candidateId: string;
  score: number;
  relevance: number;
  summary: string;
}
export interface VacancyReport {
  id: string;
  title: string | null;
  specialization: string;
  grade: string;
  /** Сколько кандидатов размечено релевантными (1 или 2). 0 – вакансия в среднее не входит. */
  relevantCount: number;
  /** Сколько кандидатов наше ранжирование показало (после отсева, как в кабинете). */
  shown: number;
  /** Потолок P@k: если релевантных меньше k, P@k = 1 недостижим. */
  precisionCeiling: number;
  ours: Metrics;
  baseline: Metrics;
  top: TopItem[];
  baselineTop: string[];
}
export interface EvaluateReport {
  k: number;
  candidates: number;
  vacancies: number;
  /** Вакансий, вошедших в среднее (есть хотя бы один релевантный). */
  scored: number;
  mean: { ours: Metrics; baseline: Metrics; precisionCeiling: number } | null;
  rows: VacancyReport[];
  warnings: string[];
}

/** Ошибка входа: текст для человека, без стека. */
export class EvalInputError extends Error {}

/** Обратный ранг первого релевантного (rel ≥ 1) в выдаче; не нашёлся – 0. */
export function reciprocalRank(ranked: string[], rel: Record<string, number>): number {
  const i = ranked.findIndex((id) => (rel[id] ?? 0) > 0);
  return i < 0 ? 0 : 1 / (i + 1);
}

/** Базовая линия (как eval/matching/run.ts): своя специализация, больше утверждений – выше, без учёта требований. */
export function baselineRanking(candidates: CandidateEvidence[], spec: string): string[] {
  return candidates
    .filter((c) => c.specialization === spec)
    .sort((a, b) => b.claims.length - a.claims.length || a.id.localeCompare(b.id))
    .map((c) => c.id);
}

const ISSUE_TEXT: Record<string, string> = {
  invalid_type: 'неверный тип или поле отсутствует',
  invalid_value: 'недопустимое значение',
  invalid_union: 'допустимо только 0, 1 или 2',
  invalid_format: 'неверный формат',
  invalid_key: 'неверный ключ',
};

/** Ошибки Zod → до 5 строк «путь: что не так» по-русски. */
export function describeIssues(err: z.ZodError): string {
  const lines = err.issues.slice(0, 5).map((i) => {
    const path = i.path.length ? i.path.join('.') : 'корень';
    let what = ISSUE_TEXT[i.code] ?? i.message;
    if (i.code === 'too_big') what = `больше допустимого (максимум ${String(i.maximum)})`;
    if (i.code === 'too_small') what = `меньше допустимого (минимум ${String(i.minimum)})`;
    if (i.code === 'invalid_value' && 'values' in i) what = `допустимо: ${i.values.map(String).join(', ')}`;
    if ((i.code === 'invalid_format' || i.code === 'custom') && i.message.startsWith('id:')) what = i.message;
    return `${path}: ${what}`;
  });
  const more = err.issues.length > 5 ? ` (и ещё ${err.issues.length - 5})` : '';
  return `Набор не прошёл проверку: ${lines.join('; ')}${more}`;
}

/** Разбор и проверка ссылок: уникальные id, id каталога, разметка только на известные вакансии и кандидатов. */
export function parseInput(raw: unknown, catalog: Map<string, CatalogEntry>): Parsed {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new EvalInputError('Ожидался JSON-объект с полями vacancies, candidates, relevance');
  const r = EvaluateInput.safeParse(raw);
  if (!r.success) throw new EvalInputError(describeIssues(r.error));
  const data = r.data;
  const dup = (ids: string[]) => ids.find((id, i) => ids.indexOf(id) !== i);
  const dv = dup(data.vacancies.map((v) => v.id));
  if (dv) throw new EvalInputError(`Вакансия ${dv} встречается дважды`);
  const dc = dup(data.candidates.map((c) => c.id));
  if (dc) throw new EvalInputError(`Кандидат ${dc} встречается дважды`);

  const unknown = new Set<string>();
  for (const v of data.vacancies) for (const n of v.needs) if (!catalog.has(n.catalogId)) unknown.add(n.catalogId);
  for (const c of data.candidates) for (const cl of c.claims) if (!catalog.has(cl.catalogId)) unknown.add(cl.catalogId);
  if (unknown.size) {
    const list = [...unknown].slice(0, 10).join(', ');
    throw new EvalInputError(`Нет в каталоге утверждений: ${list}${unknown.size > 10 ? ` и ещё ${unknown.size - 10}` : ''}. Список id – на странице ниже`);
  }
  const vIds = new Set(data.vacancies.map((v) => v.id));
  const cIds = new Set(data.candidates.map((c) => c.id));
  for (const [vid, row] of Object.entries(data.relevance)) {
    if (!vIds.has(vid)) throw new EvalInputError(`В разметке вакансия ${vid}, которой нет в vacancies`);
    const stranger = Object.keys(row).find((cid) => !cIds.has(cid));
    if (stranger) throw new EvalInputError(`В разметке вакансии ${vid} кандидат ${stranger}, которого нет в candidates`);
  }
  return data;
}

let cachedCatalog: Map<string, CatalogEntry> | null = null;
/** Каталог из файла (тот же, что сид): в /evaluate БД не трогаем. */
export function evalCatalog(): Map<string, CatalogEntry> {
  cachedCatalog ??= new Map(catalogFromFile().map((e) => [e.id, e]));
  return cachedCatalog;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Прогон набора: наше ранжирование и базовая линия по каждой вакансии, среднее по размеченным. */
export function evaluate(raw: unknown, catalog = evalCatalog()): EvaluateReport {
  const data = parseInput(raw, catalog);
  const k = data.k;
  const evidence: CandidateEvidence[] = data.candidates.map((c) => {
    const quote = (c.stack ?? []).join(', ');
    return {
      id: c.id,
      specialization: c.specialization ?? null,
      fspState: c.fspState,
      category: c.category ?? null,
      subcategoryId: c.subcategoryId ?? null,
      claims: c.claims.map((cl) => ({ catalogId: cl.catalogId, level: cl.level, statement: catalog.get(cl.catalogId)!.statement, quote })),
    };
  });

  const warnings: string[] = [];
  const rows: VacancyReport[] = data.vacancies.map((v) => {
    // Объект без прототипа: id вроде «toString» не должен находить методы Object.prototype.
    const rel: Record<string, number> = Object.assign(Object.create(null) as Record<string, number>, Object.hasOwn(data.relevance, v.id) ? data.relevance[v.id] : {});
    // Расширенный пул: у чужих кандидатов категории может не быть, а проверяется формула ранжирования, не отбор по категории.
    const ranked = dropUncovered(
      rankCandidates(evidence, { vacancyId: v.id, specialization: v.specialization, subcategoryId: v.subcategoryId ?? null, grade: v.grade, needs: v.needs, stack: v.stack ?? [] }, catalog, { expandPool: true }),
    );
    const ids = ranked.map((x) => x.candidateId);
    const base = baselineRanking(evidence, v.specialization);
    const metrics = (list: string[]): Metrics => ({ precision: r4(precisionAtK(list, rel, k)), ndcg: r4(ndcgAtK(list, rel, k)), mrr: r4(reciprocalRank(list, rel)) });
    const relevantCount = Object.values(rel).filter((x) => x > 0).length;
    if (!relevantCount) warnings.push(`У вакансии ${v.id} нет релевантных в разметке - в среднее не входит`);
    return {
      id: v.id,
      title: v.title ?? null,
      specialization: v.specialization,
      grade: v.grade,
      relevantCount,
      shown: ids.length,
      precisionCeiling: r4(maxPrecisionAtK(rel, k)),
      ours: metrics(ids),
      baseline: metrics(base),
      top: ranked.slice(0, k).map((x) => ({ candidateId: x.candidateId, score: x.score, relevance: rel[x.candidateId] ?? 0, summary: x.explanation.summary })),
      baselineTop: base.slice(0, k),
    };
  });

  const scoredRows = rows.filter((r) => r.relevantCount > 0);
  const avg = (pick: (r: VacancyReport) => Metrics): Metrics => ({
    precision: r4(mean(scoredRows.map((r) => pick(r).precision))),
    ndcg: r4(mean(scoredRows.map((r) => pick(r).ndcg))),
    mrr: r4(mean(scoredRows.map((r) => pick(r).mrr))),
  });
  return {
    k,
    candidates: evidence.length,
    vacancies: rows.length,
    scored: scoredRows.length,
    mean: scoredRows.length
      ? { ours: avg((r) => r.ours), baseline: avg((r) => r.baseline), precisionCeiling: r4(mean(scoredRows.map((r) => r.precisionCeiling))) }
      : null,
    rows,
    warnings,
  };
}

/** Тело запроса потоком с потолком в байтах; больше – 413, не JSON – понятная ошибка. */
export async function readJsonLimited(req: Request, maxBytes = EVAL_LIMITS.bodyBytes): Promise<{ ok: true; value: unknown } | { ok: false; tooLarge: boolean }> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, tooLarge: true };
  if (!req.body) return { ok: false, tooLarge: false };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, tooLarge: true };
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  }
}
