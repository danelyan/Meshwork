// Данные для публичной «Лаборатории вариантов» (/mechanics): только чтение реестра генераторов, без БД и LLM.
// Логику теста, банк, IRT и политику не меняет. Списки направлений, подкатегорий и семейств берутся из реестра.
import { SPECIALIZATIONS, SPEC_LABEL, SUBCATEGORIES, subcategoriesFor, type Specialization } from '@/lib/directions';
import { GRADES, GRADE_LABEL, type Grade } from '@/lib/grades';
import { GENERATORS, commonGeneratorsFor, generatorsForSubcategory } from '@/server/test/generators';
import { deriveSeed } from '@/server/test/rng';
import type { AnswerFormat, TaskGenerator } from '@/server/test/types';

export const VARIANTS = 3;
export const PROBE_SEEDS = 120;
const MAX_SEED = 0x7fffffff;

export const FORMAT_LABEL: Record<AnswerFormat, string> = { number: 'число', text: 'текст', line: 'номер строки', list: 'список через запятую' };

/** Строка-ловушка для нейросети (скрытая защита): в публичный вывод не попадает никогда. */
const HIDDEN_LINE = /языков\S* модел/i;

export interface FamilyItem {
  id: string;
  title: string;
  grade: Grade;
  shared: boolean;
}

export interface FamilyIrt {
  a: number;
  b: number;
  grade: Grade;
  gradeLabel: string;
  format: AnswerFormat;
  formatLabel: string;
  paramSpace: number;
  timeLimitSec: number;
}

export interface VariantView {
  seed: number;
  prompt: string;
  code: string | null;
  answerHint: string;
  answerKey: string;
  explanation: string;
  /** Параметры, которыми этот вариант отличается от остальных. */
  diff: { name: string; value: string }[];
}

export interface LeakProbe {
  samples: number;
  distinctKeys: number;
  /** Вероятность, что утёкший ключ одного экземпляра совпадёт с ключом другого случайного экземпляра. */
  keyCollision: number;
}

export interface LabFamily {
  irt: FamilyIrt;
  id: string;
  title: string;
  variants: VariantView[];
  /** Сколько скрытых служебных строк убрано из вывода (раскрывать механизм нельзя). */
  strippedLines: number;
  probe: LeakProbe;
}

export interface BankTotals {
  total: number;
  shared: number;
  perGrade: Record<Grade, number>;
  perSpec: { spec: Specialization; label: string; own: number; perGrade: Record<Grade, number> }[];
  /** Диапазон мощности пространства экземпляров. */
  paramSpace: { min: number; max: number };
}

export function normalizeSeed(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_SEED, Math.max(0, Math.floor(Math.abs(n))));
}

function perGrade(list: readonly TaskGenerator[]): Record<Grade, number> {
  return Object.fromEntries(GRADES.map((g) => [g, list.filter((f) => f.grade === g).length])) as Record<Grade, number>;
}

/** Сводка банка: всё считается из реестра. */
export function bankTotals(): BankTotals {
  const own = GENERATORS.filter((g) => !g.shared);
  const spaces = GENERATORS.map((g) => g.paramSpace);
  return {
    total: GENERATORS.length,
    shared: GENERATORS.length - own.length,
    perGrade: perGrade(GENERATORS),
    perSpec: SPECIALIZATIONS.map((spec) => {
      const list = own.filter((g) => g.specialization === spec);
      return { spec, label: SPEC_LABEL[spec], own: list.length, perGrade: perGrade(list) };
    }),
    paramSpace: { min: Math.min(...spaces), max: Math.max(...spaces) },
  };
}

/** Семейства подкатегории: собственные и общие по карте компетенций. */
export function familiesOf(subcategoryId: string): FamilyItem[] {
  const toItem = (g: TaskGenerator): FamilyItem => ({ id: g.id, title: g.title, grade: g.grade, shared: !!g.shared });
  return [...generatorsForSubcategory(subcategoryId), ...commonGeneratorsFor(subcategoryId)].map(toItem);
}

export function subcategoryOptions(spec: Specialization): { id: string; title: string; families: number }[] {
  return subcategoriesFor(spec).map((s) => ({ id: s.id, title: s.title, families: familiesOf(s.id).length }));
}

export function firstSubcategoryWithFamilies(spec: Specialization): string | null {
  return subcategoriesFor(spec).find((s) => familiesOf(s.id).length > 0)?.id ?? null;
}

export function specOfSubcategory(subcategoryId: string): Specialization | null {
  return SUBCATEGORIES.find((s) => s.id === subcategoryId)?.specialization ?? null;
}

export function familyIrt(g: TaskGenerator): FamilyIrt {
  return {
    a: g.a,
    b: g.b,
    grade: g.grade,
    gradeLabel: GRADE_LABEL[g.grade],
    format: g.format,
    formatLabel: FORMAT_LABEL[g.format],
    paramSpace: g.paramSpace,
    timeLimitSec: g.timeLimitSec,
  };
}

function scrub(text: string | undefined): { text: string | null; removed: number } {
  if (!text) return { text: null, removed: 0 };
  const lines = text.split('\n');
  const kept = lines.filter((l) => !HIDDEN_LINE.test(l));
  return { text: kept.join('\n').trimEnd(), removed: lines.length - kept.length };
}

function show(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return (s ?? '').length > 80 ? `${(s ?? '').slice(0, 77)}...` : (s ?? '');
}

/** Зонд утечки: на сколько случайных экземплярах семейства совпадает ключ. */
export function leakProbe(g: TaskGenerator, base: number): LeakProbe {
  const counts = new Map<string, number>();
  for (let i = 0; i < PROBE_SEEDS; i++) {
    const k = g.generate(deriveSeed(base, 1000 + i)).answerKey;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let same = 0;
  for (const c of counts.values()) same += c * (c - 1);
  return { samples: PROBE_SEEDS, distinctKeys: counts.size, keyCollision: same / (PROBE_SEEDS * (PROBE_SEEDS - 1)) };
}

/** Варианты семейства из разных seed; детерминированно по (id, seed). null - семейства нет. */
export function labFamily(familyId: string, seed: number): LabFamily | null {
  const g = GENERATORS.find((x) => x.id === familyId);
  if (!g) return null;
  const base = normalizeSeed(seed);
  const raw = Array.from({ length: VARIANTS }, (_, i) => {
    const s = deriveSeed(deriveSeed(base, 77), i); // двойное смешивание: у deriveSeed(base, i) соседние base пересекаются по i
    return { s, inst: g.generate(s) };
  });
  let stripped = 0;
  const variants: VariantView[] = raw.map(({ s, inst }) => {
    const p = scrub(inst.prompt);
    const c = scrub(inst.code);
    stripped += p.removed + c.removed;
    const names = Object.keys(inst.params);
    const diff = names
      .filter((n) => raw.some((o) => show(o.inst.params[n]) !== show(inst.params[n])))
      .map((n) => ({ name: n, value: show(inst.params[n]) }));
    return {
      seed: s,
      prompt: p.text ?? '',
      code: c.text,
      answerHint: inst.answerHint,
      answerKey: inst.answerKey,
      explanation: inst.explanation,
      diff,
    };
  });
  return { irt: familyIrt(g), id: g.id, title: g.title, variants, strippedLines: stripped, probe: leakProbe(g, base) };
}
