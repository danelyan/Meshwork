// Слепой набор для независимой разметки подбора (11.10). Без БД и сети, детерминирован.
// 6 вакансий расширенного набора (seed 20261010) × top-30 кандидатов из объединения выдач ours и BM25.
// Размечающим уходит только то, что видит человек: текст вакансии и профиля. Ни скрытой истины, ни баллов,
// ни исходных id (в id профиля генератора зашит тип — «category_faked» и т. п.), порядок кандидатов перемешан.
import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { dropUncovered, rankCandidates, type CandidateEvidence } from '../../src/server/employer/ranking';

import { bm25Rank } from './bm25';
import { mulberry32 } from './metrics';
import { generateSynthetic, SYN_SEED, type SynProfile, type SynVacancy } from './synthetic';

/** Вакансии: по 1–2 на специализацию, разные грейды. */
export const BLIND_VACANCIES = [
  'syn-vac-03-backend-middle', 'syn-vac-06-backend-senior', 'syn-vac-08-frontend-junior',
  'syn-vac-11-frontend-middle', 'syn-vac-19-engineering-senior', 'syn-vac-21-ai-middle',
] as const;
export const BLIND_POOL = 30;
const SHUFFLE_SALT = 4_242;

export const LEVEL_TEXT: Record<string, string> = {
  self_reported: 'заявлено',
  artifact: 'артефакт',
  platform: 'платформа',
  third_party: 'третья сторона',
};
export const LEVEL_LEGEND = 'Уровень доказанности утверждения в скобках: «заявлено» — кандидат заявил сам, без подтверждения; «артефакт» — подтверждено артефактом (код, репозиторий, работа); «платформа» — подтверждено заданием на платформе; «третья сторона» — подтверждено третьей стороной.';
const FSP_TEXT: Record<string, string> = {
  linked: 'профиль ФСП привязан, есть результаты соревнований по спортивному программированию',
  no_achievements: 'профиль ФСП привязан, достижений нет',
  unavailable: 'данные ФСП недоступны',
  not_linked: 'профиль ФСП не привязан',
};
const GRADE: Record<string, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior' };

export interface BlindCandidate {
  candidateId: string;
  categoryFromTest: string | null;
  stack: string[];
  /** «утверждение [уровень доказанности]». Текст профиля генератора не выгружается: он повторяет утверждения, категорию и стек. */
  claims: string[];
  fsp: string;
}
export interface BlindVacancy { vacancyId: string; title: string; grade: string; requirements: string[]; stack: string[]; candidates: BlindCandidate[] }
export interface BlindSet {
  items: BlindVacancy[];
  /** Ключ: blind vacancyId → { id вакансии генератора, candidateId → id профиля генератора }. Размечающим не отдаётся. */
  key: Record<string, { vacancy: string; candidates: Record<string, string> }>;
}

export function rankOurs(v: SynVacancy, profiles: SynProfile[]): string[] {
  const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
  const ev: CandidateEvidence[] = profiles.map((p) => ({
    id: p.id, specialization: p.specialization, fspState: p.fspState, category: p.category,
    claims: p.claims.map(([catalogId, level]) => ({ catalogId, level, statement: catalog.get(catalogId)?.statement ?? catalogId, quote: p.stack.join(', ') })),
  }));
  return dropUncovered(rankCandidates(ev, { specialization: v.specialization, grade: v.grade, needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })), stack: v.stack }, catalog)).map((r) => r.candidateId);
}
export const rankBm25 = (v: SynVacancy, profiles: SynProfile[]): string[] => bm25Rank(profiles.map((p) => ({ id: p.id, text: p.text })), v.text).map((d) => d.id);
export const rankBaselineClaims = (v: SynVacancy, profiles: SynProfile[]): string[] =>
  profiles.filter((c) => c.specialization === v.specialization).sort((a, b) => b.claims.length - a.claims.length || a.id.localeCompare(b.id)).map((c) => c.id);

/** Пул: по очереди ours[i], bm25[i] без повторов, пока не наберётся BLIND_POOL. */
export function poolOf(ours: string[], bm25: string[], n = BLIND_POOL): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < n && (i < ours.length || i < bm25.length); i++) {
    for (const id of [ours[i], bm25[i]]) if (id && !out.includes(id) && out.length < n) out.push(id);
  }
  return out;
}

export function buildBlindSet(seed = SYN_SEED): BlindSet & { syn: ReturnType<typeof generateSynthetic> } {
  const syn = generateSynthetic(seed);
  const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
  const byId = new Map(syn.profiles.map((p) => [p.id, p]));
  const rnd = mulberry32(seed + SHUFFLE_SALT);
  const items: BlindVacancy[] = [];
  const key: BlindSet['key'] = {};
  BLIND_VACANCIES.forEach((vid, vi) => {
    const v = syn.vacancies.find((x) => x.id === vid);
    if (!v) throw new Error(`нет вакансии ${vid}`);
    const pool = poolOf(rankOurs(v, syn.profiles), rankBm25(v, syn.profiles));
    const shuffled = pool.map((id) => ({ id, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.id);
    const blindV = `V${vi + 1}`;
    key[blindV] = { vacancy: v.id, candidates: {} };
    const candidates = shuffled.map((pid, ci) => {
      const p = byId.get(pid)!;
      const cid = `${blindV}-C${String(ci + 1).padStart(2, '0')}`;
      key[blindV]!.candidates[cid] = pid;
      return {
        candidateId: cid,
        categoryFromTest: p.category ? `${p.category.specialization} ${GRADE[p.category.grade]}` : null,
        stack: p.stack,
        claims: p.claims.map(([id, level]) => `${catalog.get(id)?.statement ?? id} [${LEVEL_TEXT[level] ?? level}]`),
        fsp: FSP_TEXT[p.fspState] ?? p.fspState,
      };
    });
    items.push({
      vacancyId: blindV,
      title: v.title.replace(/\s*№\d+$/, ''),
      grade: GRADE[v.grade]!,
      requirements: v.needs.map(([id]) => catalog.get(id)?.statement ?? id),
      stack: v.stack,
      candidates,
    });
  });
  return { items, key, syn };
}
