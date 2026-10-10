// Генератор синтетического набора для оценки подбора (лейн match-eval, 10.10). Детерминирован: один seed — один набор.
// Без БД и сети. Вымышленные профили и вакансии.
//
// Идея разметки: у каждого профиля есть СКРЫТЫЕ латентные навыки (степень владения 0…1 по каждому
// утверждению каталога) и латентный грейд. То, что видит подбор (утверждения, уровни доказанности, категория,
// текст), — зашумлённое наблюдение этой истины: кто-то знает больше, чем заявил; кто-то заявил больше, чем знает.
// Релевантность 0/1/2 считается из латентных навыков и грейда, а НЕ из наблюдаемых утверждений и не из формулы подбора.
import type { DemoProfile } from '../../prisma/seed/employer';
import { catalogFromFile } from '../../src/server/claims/catalog-file';
import type { CatalogEntry } from '../../src/server/claims/types';

import { mulberry32 } from './metrics';

export type Spec = 'backend' | 'frontend' | 'engineering' | 'ai';
export type SynGrade = 'junior' | 'middle' | 'senior';
type Level = 'self_reported' | 'artifact' | 'platform' | 'third_party';

export const SYN_SEED = 20261010;
const GRADE_RANK: Record<SynGrade, number> = { junior: 0, middle: 1, senior: 2 };
const GRADE_NAME: Record<SynGrade, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior' };
const SPEC_NAME: Record<Spec, string> = { backend: 'Backend', frontend: 'Frontend', engineering: 'Инженерия', ai: 'ИИ' };
const WINDOW = 12;

/** Порядок утверждений в каталоге тематический (соседние — одна тема); вакансия и «фокус» профиля — окно в этом порядке. */
const STACK_POOL: Record<Spec, string[]> = {
  backend: ['Go', 'Java', 'Kotlin', 'Python', 'C#', 'Node.js', 'PHP'],
  frontend: ['React', 'Vue', 'Angular', 'TypeScript', 'Svelte', 'Next.js'],
  engineering: ['Docker', 'Kubernetes', 'Airflow', 'Terraform', 'Playwright', 'Prometheus', 'GitLab CI'],
  ai: ['Python', 'PyTorch', 'scikit-learn', 'Qdrant', 'LangChain', 'MLflow'],
};

export interface SynVacancy {
  id: string;
  title: string;
  specialization: Spec;
  grade: SynGrade;
  needs: [catalogId: string, weight: number][];
  stack: string[];
  /** Текст вакансии для BM25: заголовок, формулировки требований, стек. */
  text: string;
}

export type Archetype =
  | 'strong_proven' | 'strong_no_category' | 'strong_self_only' | 'strong_category_only' | 'weak_category_only'
  | 'overclaimer' | 'adjacent_stack' | 'mid_average' | 'weak_junior' | 'fullstack' | 'no_spec';

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  strong_proven: 'сильный, всё доказано, с категорией',
  strong_no_category: 'сильный, без категории',
  strong_self_only: 'сильный, всё со слов',
  strong_category_only: 'сильный, категория без утверждений',
  weak_category_only: 'слабый, категория без утверждений',
  overclaimer: 'переоценил себя (много утверждений со слов, мало умений)',
  adjacent_stack: 'сильный, но соседний стек (другая тема той же специализации)',
  mid_average: 'средний',
  weak_junior: 'слабый джун',
  fullstack: 'две специализации (backend + frontend)',
  no_spec: 'без специализации (общие навыки)',
};

export interface SynProfile extends DemoProfile {
  archetype: Archetype;
  /** Латентный грейд (скрыт от подбора). */
  trueGrade: SynGrade;
  /** Латентные навыки: catalogId → степень владения 0…1 (скрыты от подбора). */
  latent: Record<string, number>;
  /** Текст профиля для BM25: категория, стек, формулировки утверждений и пара их маркеров. */
  text: string;
}

export interface SynSet {
  vacancies: SynVacancy[];
  profiles: SynProfile[];
  /** Релевантность 0/1/2 по скрытой истине: vacancyId → profileId → rel (только ненулевые не опускаются — храним все). */
  relevance: Record<string, Record<string, number>>;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Пороги разметки (см. truthRelevance). */
export const TRUTH = { rel2: 0.7, rel1: 0.45, mastery: [0.3, 0.8] as const, oneBelow: 0.7, twoBelow: 0.4 };

/**
 * ПРАВИЛО РАЗМЕТКИ по скрытой истине. mastery(навык) = clamp((prof − 0,3)/0,5): ≤ 0,3 — не владеет, ≥ 0,8 — владеет.
 * truthCov = Σ вес × mastery / Σ вес по требованиям вакансии. Грейд: латентный не ниже вакансии — как есть; на ступень
 * ниже — truthCov × 0,7; на две — × 0,4. rel 2: truthCov ≥ 0,7; rel 1: ≥ 0,45; иначе 0.
 * Это тоже «покрытие требований», как и формула подбора; отличие — оно считается по латентным навыкам, а не по
 * заявленным утверждениям с весом доказанности, и учитывает грейд. Специализация, категория, ФСП и стек в разметке не участвуют.
 */
export function truthRelevance(latent: Record<string, number>, trueGrade: SynGrade, v: Pick<SynVacancy, 'needs' | 'grade'>): { cov: number; rel: 0 | 1 | 2 } {
  let num = 0;
  let den = 0;
  for (const [id, w] of v.needs) {
    const m = clamp01(((latent[id] ?? 0) - TRUTH.mastery[0]) / (TRUTH.mastery[1] - TRUTH.mastery[0]));
    num += w * m;
    den += w;
  }
  let cov = den ? num / den : 0;
  const d = GRADE_RANK[v.grade] - GRADE_RANK[trueGrade];
  if (d === 1) cov *= TRUTH.oneBelow;
  else if (d >= 2) cov *= TRUTH.twoBelow;
  return { cov, rel: cov >= TRUTH.rel2 ? 2 : cov >= TRUTH.rel1 ? 1 : 0 };
}

type GradeW = { junior: number | null; middle: number | null; senior?: number | null };
/** Вес утверждения для грейда; у общих утверждений веса заданы по специализациям — берём backend (оценка — по любому). Senior — как Middle. */
function weightFor(e: CatalogEntry, grade: SynGrade, spec: Spec = 'backend'): number {
  const w = e.weights as GradeW | Partial<Record<Spec, GradeW>>;
  const g = ('junior' in w ? w : (w[spec] ?? w.backend ?? Object.values(w)[0])) as GradeW | undefined;
  return g?.[grade === 'senior' ? 'middle' : grade] ?? 0;
}

// Состав вакансий: 24 штуки, специализации и грейды вперемешку.
const VACANCY_PLAN: [Spec, SynGrade][] = [
  ['backend', 'junior'], ['backend', 'junior'], ['backend', 'middle'], ['backend', 'middle'], ['backend', 'middle'], ['backend', 'senior'], ['backend', 'junior'],
  ['frontend', 'junior'], ['frontend', 'junior'], ['frontend', 'middle'], ['frontend', 'middle'], ['frontend', 'middle'], ['frontend', 'senior'], ['frontend', 'junior'],
  ['engineering', 'junior'], ['engineering', 'middle'], ['engineering', 'middle'], ['engineering', 'junior'], ['engineering', 'senior'],
  ['ai', 'junior'], ['ai', 'middle'], ['ai', 'middle'], ['ai', 'junior'], ['ai', 'senior'],
];

// Состав профилей по типам: сумма 247.
const ARCH_PLAN: [Archetype, number][] = [
  ['strong_proven', 35], ['strong_no_category', 25], ['strong_self_only', 22], ['strong_category_only', 15], ['weak_category_only', 10],
  ['overclaimer', 22], ['adjacent_stack', 28], ['mid_average', 45], ['weak_junior', 20], ['fullstack', 12], ['no_spec', 13],
];

interface ArchParams {
  ability: [number, number];
  /** вероятность заявить навык, которым владеет (prof ≥ 0,45) */
  declare: number;
  /** доля заявленных, доказанных выше «со слов» */
  proof: number;
  /** вероятность заявить «со слов» навык, которым не владеет (в фокусе; вне фокуса ×0,3) */
  over: number;
  /** вероятность, что есть категория из теста */
  category: number;
  noClaims?: boolean;
}

const PARAMS: Record<Archetype, ArchParams> = {
  strong_proven: { ability: [0.78, 0.95], declare: 0.8, proof: 0.75, over: 0.02, category: 0.7 },
  strong_no_category: { ability: [0.72, 0.92], declare: 0.7, proof: 0.6, over: 0.03, category: 0 },
  strong_self_only: { ability: [0.72, 0.92], declare: 0.8, proof: 0, over: 0.03, category: 0 },
  strong_category_only: { ability: [0.72, 0.92], declare: 0, proof: 0, over: 0, category: 1, noClaims: true },
  weak_category_only: { ability: [0.15, 0.4], declare: 0, proof: 0, over: 0, category: 1, noClaims: true },
  overclaimer: { ability: [0.15, 0.35], declare: 0.5, proof: 0.1, over: 0.7, category: 0.15 },
  adjacent_stack: { ability: [0.75, 0.92], declare: 0.75, proof: 0.6, over: 0.03, category: 0.5 },
  mid_average: { ability: [0.45, 0.7], declare: 0.6, proof: 0.4, over: 0.08, category: 0.4 },
  weak_junior: { ability: [0.2, 0.42], declare: 0.5, proof: 0.3, over: 0.1, category: 0.2 },
  fullstack: { ability: [0.62, 0.85], declare: 0.7, proof: 0.5, over: 0.04, category: 0.4 },
  no_spec: { ability: [0.5, 0.85], declare: 0.7, proof: 0.5, over: 0.02, category: 0 },
};

function trueGradeFor(a: number, rnd: () => number): SynGrade {
  const x = a + (rnd() - 0.5) * 0.12;
  return x < 0.45 ? 'junior' : x < 0.78 ? 'middle' : 'senior';
}

/** Как поставил бы навык латентный уровень: в фокусе — ability, вне — ×0,35; средний грейд навыка выше грейда человека — ×0,5. */
function profFor(e: CatalogEntry, a: number, g: SynGrade, inFocus: boolean, rnd: () => number): number {
  let p = a * (inFocus ? 1 : 0.35);
  if (!e.grades.some((x) => GRADE_RANK[x as SynGrade] <= GRADE_RANK[g])) p *= 0.5;
  return clamp01(p + (rnd() - 0.5) * 0.3);
}

export function generateSynthetic(seed = SYN_SEED): SynSet {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const cat = catalogFromFile();
  const bySpec = new Map<string, CatalogEntry[]>();
  for (const e of cat) bySpec.set(e.specialization, [...(bySpec.get(e.specialization) ?? []), e]);
  const common = bySpec.get('common') ?? [];
  const windowOf = (spec: Spec, center: number) => {
    const L = bySpec.get(spec)!;
    const from = Math.max(0, Math.min(L.length - WINDOW, center - WINDOW / 2));
    return L.slice(from, from + WINDOW);
  };
  const stackTags = (spec: Spec, center: number, n: number): string[] => {
    const pool = STACK_POOL[spec];
    const L = bySpec.get(spec)!;
    const main = pool[Math.min(pool.length - 1, Math.floor((center / L.length) * pool.length))]!;
    const tags = [main];
    while (tags.length < n) { const t = pick(pool); if (!tags.includes(t)) tags.push(t); }
    return tags;
  };

  // --- вакансии ---
  const perSpecCount = new Map<Spec, number>();
  for (const [s] of VACANCY_PLAN) perSpecCount.set(s, (perSpecCount.get(s) ?? 0) + 1);
  const seen = new Map<Spec, number>();
  const vacCenters: Record<string, number> = {};
  const vacancies: SynVacancy[] = VACANCY_PLAN.map(([spec, grade], idx) => {
    const L = bySpec.get(spec)!;
    const i = seen.get(spec) ?? 0;
    seen.set(spec, i + 1);
    const center = Math.round(((i + 0.5) / perSpecCount.get(spec)!) * L.length);
    const eligible = windowOf(spec, center).filter((e) => weightFor(e, grade, spec) > 0);
    const shuffled = eligible.map((e) => ({ e, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.e);
    const chosen = shuffled.slice(0, 6);
    if (rnd() < 0.5) { const c = pick(common.filter((e) => weightFor(e, grade, spec) > 0)); if (c) chosen.push(c); }
    const needs = chosen.map((e) => [e.id, weightFor(e, grade, spec)] as [string, number]);
    const stack = stackTags(spec, center, 1 + Math.floor(rnd() * 2));
    const title = `${SPEC_NAME[spec]}-разработчик (${GRADE_NAME[grade]}) №${idx + 1}`;
    const id = `syn-vac-${String(idx + 1).padStart(2, '0')}-${spec}-${grade}`;
    vacCenters[id] = center;
    const text = [title, ...chosen.map((e) => e.statement), stack.join(' ')].join('. ');
    return { id, title, specialization: spec, grade, needs, stack, text };
  });

  // --- профили ---
  const specWeights: [Spec, number][] = [['backend', 0.3], ['frontend', 0.3], ['engineering', 0.22], ['ai', 0.18]];
  const pickSpec = (): Spec => { let x = rnd(); for (const [s, w] of specWeights) { if ((x -= w) < 0) return s; } return 'backend'; };
  const profiles: SynProfile[] = [];
  let seq = 0;
  for (const [archetype, count] of ARCH_PLAN) {
    const P = PARAMS[archetype];
    for (let n = 0; n < count; n++) {
      seq++;
      const spec: Spec | null = archetype === 'no_spec' ? null : archetype === 'fullstack' ? 'backend' : pickSpec();
      const ability = P.ability[0] + rnd() * (P.ability[1] - P.ability[0]);
      const g = trueGradeFor(ability, rnd);
      // фокус: окно вокруг случайного центра; у «соседнего стека» — сдвиг от центра случайной вакансии той же специализации
      const focus: { spec: Spec; center: number }[] = [];
      if (spec) {
        const L = bySpec.get(spec)!;
        let center = Math.floor(rnd() * L.length);
        if (archetype === 'adjacent_stack') {
          const v = pick(vacancies.filter((x) => x.specialization === spec));
          const shift = (WINDOW - 2 + Math.floor(rnd() * 5)) * (rnd() < 0.5 ? -1 : 1);
          center = Math.max(0, Math.min(L.length - 1, vacCenters[v.id]! + shift));
        }
        focus.push({ spec, center });
        if (archetype === 'fullstack') focus.push({ spec: 'frontend', center: Math.floor(rnd() * bySpec.get('frontend')!.length) });
      }
      const focusIds = new Set(focus.flatMap((f) => windowOf(f.spec, f.center).map((e) => e.id)));
      const ownSpecs = new Set(focus.map((f) => f.spec));

      const latent: Record<string, number> = {};
      for (const e of cat) {
        if (e.specialization === 'common') latent[e.id] = profFor(e, ability * 0.8, g, true, rnd);
        else if (ownSpecs.has(e.specialization as Spec)) latent[e.id] = profFor(e, ability, g, focusIds.has(e.id), rnd);
        else latent[e.id] = clamp01(rnd() * 0.12);
      }

      // наблюдаемые утверждения
      const claims: [string, Level][] = [];
      const provenLevels: Level[] = ['artifact', 'artifact', 'third_party', 'platform'];
      if (!P.noClaims) {
        for (const e of cat) {
          const p = latent[e.id]!;
          const own = e.specialization === 'common' || ownSpecs.has(e.specialization as Spec);
          if (!own) continue;
          if (p >= 0.45) {
            if (rnd() < P.declare) claims.push([e.id, p > 0.55 && rnd() < P.proof ? pick(provenLevels) : 'self_reported']);
          } else if (p < 0.35) {
            if (rnd() < P.over * (focusIds.has(e.id) ? 1 : 0.3)) claims.push([e.id, 'self_reported']);
          } else if (rnd() < P.declare * 0.5) claims.push([e.id, 'self_reported']);
        }
        if (claims.length < 2) {
          const top = cat.filter((e) => latent[e.id]! > 0.3).sort((a, b) => latent[b.id]! - latent[a.id]!).slice(0, 2);
          for (const e of top) if (!claims.some(([id]) => id === e.id)) claims.push([e.id, 'self_reported']);
        }
      }

      // категория из теста: верная в ~80 % случаев, иначе на ступень в сторону; у «слабой категории без утверждений» завышена в 40 %
      let category: SynProfile['category'] = null;
      if (spec && rnd() < P.category) {
        const r = GRADE_RANK[g];
        let cr = r;
        const x = rnd();
        if (archetype === 'weak_category_only' && x < 0.4) cr = Math.min(2, r + 1);
        else if (x < 0.1) cr = Math.min(2, r + 1);
        else if (x < 0.2) cr = Math.max(0, r - 1);
        category = { specialization: spec, grade: (['junior', 'middle', 'senior'] as const)[cr]! };
      }

      const tags = spec ? stackTags(spec, focus[0]!.center, 1 + Math.floor(rnd() * 3)) : ['C++', 'Python'];
      const fspState: DemoProfile['fspState'] = rnd() < 0.2 ? 'linked' : rnd() < 0.25 ? 'no_achievements' : 'not_linked';
      const id = `syn-p-${String(seq).padStart(3, '0')}-${archetype}`;
      const claimText = claims.map(([cid]) => {
        const e = cat.find((x) => x.id === cid)!;
        return `${e.statement} ${e.markers.slice(0, 2).join(' ')}`;
      });
      const text = [category ? `${SPEC_NAME[category.specialization]} ${GRADE_NAME[category.grade]}` : '', tags.join(' '), ...claimText].filter(Boolean).join('. ');
      profiles.push({
        id, name: `S${seq}`, specialization: spec, fspState, category, stack: tags, claims: claims.sort(([a], [b]) => a.localeCompare(b)),
        archetype, trueGrade: g, latent, text,
      });
    }
  }

  const relevance: SynSet['relevance'] = {};
  for (const v of vacancies) {
    const r: Record<string, number> = {};
    for (const p of profiles) r[p.id] = truthRelevance(p.latent, p.trueGrade, v).rel;
    relevance[v.id] = r;
  }
  return { vacancies, profiles, relevance };
}
