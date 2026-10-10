// Предзаполнение формы потребности из ссылки черновика помощника (create_need_draft → formHref).
// Всё из query — недоверенное: значения режутся, требования — только из каталога своей специализации.
import type { Specialization } from '@/lib/directions';
import type { CatalogEntry } from '@/server/claims/types';
import { normalizeStack } from '@/server/employer/ranking';

export interface NeedPrefill {
  title: string;
  specialization: Specialization;
  grade: 'junior' | 'middle';
  salaryFrom: number;
  salaryTo: number;
  teamDescription: string | null;
  description: string | null;
  stack: string[];
  needs: { catalogId: string; weight: number }[];
}

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const money = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 10_000_000 ? n : 0;
};

/** null — ссылки черновика нет (обычная «Новая потребность»). */
export function parseNeedPrefill(raw: Raw, catalog: Pick<CatalogEntry, 'id' | 'specialization'>[]): NeedPrefill | null {
  const spec = first(raw.spec);
  if (spec !== 'backend' && spec !== 'frontend') return null;
  const grade = first(raw.grade) === 'middle' ? 'middle' : 'junior';
  const allowed = new Set(catalog.filter((e) => e.specialization === spec || e.specialization === 'common').map((e) => e.id));
  const needs = first(raw.needs)
    .split(',')
    .map((s) => s.trim())
    .filter((id, i, a) => allowed.has(id) && a.indexOf(id) === i)
    .slice(0, 25)
    .map((catalogId) => ({ catalogId, weight: 2 }));
  const from = money(first(raw.from));
  const to = money(first(raw.to));
  return {
    title: first(raw.title).slice(0, 120),
    specialization: spec,
    grade,
    salaryFrom: from,
    salaryTo: Math.max(from, to),
    teamDescription: first(raw.team).slice(0, 2000) || null,
    description: null,
    stack: normalizeStack(first(raw.stack).split(',')).slice(0, 15),
    needs,
  };
}
