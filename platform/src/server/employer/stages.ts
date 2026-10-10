// Ступени 1–3 ADR 0003 в ранжировании и карточке работодателя (lane employer-card): чистые типы и функции,
// без БД. Загрузка из БД — stages-load.ts. Цитат транскрипта и кода здесь нет по построению: в свидетельства
// попадают темы, баллы, флаги и текст пояснений рубрики проекта (его маскирует maskExplanation до принятия).
import { subcategoryLabel } from '@/lib/directions';

import type { DefenseFlag } from '../defense-room/types';
import { maskContacts } from '../collector/mask';
import type { RubricFlag } from '../project/schemas';

/** Строка карты глубины: без цитат и формулировок кандидата (как publicVerdict лейна call). */
export interface DepthTopic {
  topic: string;
  catalogId: string | null;
  claimed: boolean;
  probed: number;
  confirmed: boolean;
  /** Сумма рубрики A-02 по теме, 0…8. */
  total: number;
}

/** Результат ступени 1 (последний завершённый квалифицирующий созвон). */
export interface QualifyingEvidence {
  confirmedTopics: string[];
  probedTopics: string[];
  /** catalogId подтверждённых тем (только привязанные к каталогу) — для бонуса под потребность. */
  confirmedCatalogIds: string[];
  scoresByTopic: DepthTopic[];
  evaluatedAt: string;
}

/** Результат ступени 3 (последняя завершённая защита проекта). Баллы и флаги; цитат нет. */
export interface DefenseEvidence {
  /** Сумма рубрики A-02, 0…8; null — кандидат не ответил ни на один вопрос. */
  score: number | null;
  passed: boolean | null;
  flags: DefenseFlag[];
  /** Доля скрытых тестов проекта, с которым сравнивали защиту. */
  projectScore: number | null;
  projectSubmissionId: string | null;
  evaluatedAt: string;
}

export interface CallsEvidence {
  qualifying?: QualifyingEvidence;
  defense?: DefenseEvidence;
}

export type ProjectFlag = RubricFlag | 'platform_owned_violation';

/** Один пункт рубрики проекта: критерий → прошёл/нет → доказательство. */
export interface ProjectCriterion {
  id: string;
  text: string;
  source: 'required' | 'wish';
  passed: boolean | null;
  evidence: string;
  file?: string | null;
  flag?: RubricFlag;
}

/** Проверенный сабмит кандидата (ступень 2). */
export interface ProjectEvidence {
  submissionId: string;
  taskId: string;
  vacancyId: string;
  subcategoryId: string | null;
  /** Доля пройденных скрытых тестов 0…1 (воспроизводимый балл автопроверки). */
  score: number;
  tests: { passed: number; total: number };
  flags: ProjectFlag[];
  late: boolean;
  checkedAt: string;
  criteria: ProjectCriterion[];
}

const FLAG_LABEL: Record<ProjectFlag, string> = {
  evidence_unverified: 'доказательство не нашли в коде',
  no_evidence: 'доказательства нет',
  possible_prompt_injection: 'в сданном коде найдена попытка повлиять на проверку',
  not_evaluated: 'критерий не проверялся',
  platform_owned_violation: 'изменены файлы, которые принадлежат платформе',
};
export const projectFlagLabel = (f: ProjectFlag): string => FLAG_LABEL[f];

const DEFENSE_FLAG_LABEL: Record<DefenseFlag, string> = {
  strong_project_weak_defense:
    'Проект прошёл автопроверку хорошо, а на защите кандидат объяснил свой код слабее порога. Это пометка для разговора, а не штраф и не вывод о подлинности: порядок в подборке она не меняет.',
  short_defense: 'Ответов мало - оценка защиты неустойчива.',
  evaluator_disagreement: 'Прогоны оценщика разошлись - лучше прочитать транскрипт.',
  employer_questions_unanswered: 'Не на все вопросы работодателя есть ответ.',
  no_project_result: 'Результата автопроверки проекта нет - сравнить проект и защиту нельзя.',
  uneven_understanding: 'Понимание неровное: часть кода объясняет уверенно, по другой части ответы почти пустые.',
};
export const defenseFlagLabel = (f: DefenseFlag): string => DEFENSE_FLAG_LABEL[f];

// ---------------------------------------------------------------------------
// Сжатие вердиктов БД до свидетельств
// ---------------------------------------------------------------------------

type DepthLike = { topic: string; catalogId: string | null; claimed: boolean; probed: number; confirmed: boolean; total: number; status?: string };

/** Карта глубины ступени 1 → свидетельство. Берёт только поля без цитат (подходит и публичный вердикт). */
export function summarizeQualifying(verdict: { depthMap: readonly DepthLike[]; evaluatedAt: string }): QualifyingEvidence {
  // Темы «не проверено» (status=not_probed, лейн stage-tuning) в счёт «подтверждено X из N» не входят.
  const scoresByTopic = verdict.depthMap.filter((d) => d.status !== 'not_probed').map((d) => ({
    topic: d.topic,
    catalogId: d.catalogId,
    claimed: d.claimed,
    probed: d.probed,
    confirmed: d.confirmed,
    total: d.total,
  }));
  return {
    confirmedTopics: scoresByTopic.filter((d) => d.confirmed).map((d) => d.topic),
    probedTopics: scoresByTopic.filter((d) => d.probed > 0).map((d) => d.topic),
    confirmedCatalogIds: [...new Set(scoresByTopic.filter((d) => d.confirmed && d.catalogId).map((d) => d.catalogId!))].sort(),
    scoresByTopic,
    evaluatedAt: verdict.evaluatedAt,
  };
}

export function summarizeDefense(
  verdict: { total: number | null; passed: boolean | null; flags: readonly DefenseFlag[]; projectScore: number | null; evaluatedAt: string },
  projectSubmissionId: string | null,
): DefenseEvidence {
  return {
    score: verdict.total,
    passed: verdict.passed,
    flags: [...verdict.flags],
    projectScore: verdict.projectScore,
    projectSubmissionId,
    evaluatedAt: verdict.evaluatedAt,
  };
}

// ---------------------------------------------------------------------------
// Блоки объяснения
// ---------------------------------------------------------------------------

export interface DepthBlock {
  topics: (DepthTopic & { forNeed: boolean })[];
  confirmed: number;
  /** Подтверждённых тем, совпавших с требованиями потребности (дали бонус). */
  matchedNeed: number;
}

export interface ProjectOwnBlock {
  score: number;
  tests: { passed: number; total: number };
  late: boolean;
  checkedAt: string;
  flags: ProjectFlag[];
  criteria: ProjectCriterion[];
}

export interface ProjectOtherBlock {
  subcategoryId: string | null;
  /** «Web API» или «подкатегория не указана». */
  subcategory: string;
  score: number;
}

export interface ProjectBlock {
  /** Проект под ЭТУ потребность — таблица критериев целиком. */
  own: ProjectOwnBlock | null;
  /** Чужие проекты: только подкатегория и балл. */
  others: ProjectOtherBlock[];
}

export interface DefenseBlock {
  score: number | null;
  passed: boolean | null;
  flags: DefenseFlag[];
  /** Пояснения к флагам готовыми фразами. */
  notes: string[];
}

export function buildDepthBlock(q: QualifyingEvidence, needIds: ReadonlySet<string>): DepthBlock {
  const topics = q.scoresByTopic.map((d) => ({ ...d, forNeed: d.catalogId !== null && needIds.has(d.catalogId) }));
  return {
    topics,
    confirmed: topics.filter((d) => d.confirmed).length,
    matchedNeed: new Set(topics.filter((d) => d.confirmed && d.forNeed).map((d) => d.catalogId)).size,
  };
}

/** Лучший (по баллу, затем по свежести) проверенный проект под потребность. */
export function pickOwnProject(projects: readonly ProjectEvidence[] | undefined, vacancyId: string | null | undefined): ProjectEvidence | null {
  if (!projects || !vacancyId) return null;
  let best: ProjectEvidence | null = null;
  for (const p of projects) {
    if (p.vacancyId !== vacancyId) continue;
    if (!best || p.score > best.score || (p.score === best.score && p.checkedAt > best.checkedAt)) best = p;
  }
  return best;
}

export function buildProjectBlock(projects: readonly ProjectEvidence[], own: ProjectEvidence | null): ProjectBlock {
  const others = projects
    .filter((p) => p !== own && p.vacancyId !== own?.vacancyId)
    // По одному на задание: чужие вакансии не раскрываем, только подкатегорию и балл.
    .map((p) => ({ subcategoryId: p.subcategoryId, subcategory: p.subcategoryId ? subcategoryLabel(p.subcategoryId) : 'подкатегория не указана', score: p.score }))
    .sort((a, b) => b.score - a.score || a.subcategory.localeCompare(b.subcategory));
  return {
    own: own
      ? { score: own.score, tests: own.tests, late: own.late, checkedAt: own.checkedAt, flags: own.flags, criteria: own.criteria }
      : null,
    others,
  };
}

export function buildDefenseBlock(d: DefenseEvidence): DefenseBlock {
  return { score: d.score, passed: d.passed, flags: d.flags, notes: d.flags.map(defenseFlagLabel) };
}

/** Одно предложение для summary; пусто, если ступеней нет. */
export function stagesSentence(parts: { depth?: DepthBlock; project?: ProjectBlock; defense?: DefenseBlock }): string {
  const out: string[] = [];
  if (parts.depth) out.push(`созвон: подтверждено ${parts.depth.confirmed} из ${parts.depth.topics.length} тем`);
  if (parts.project?.own) out.push(`проект под эту потребность: ${Math.round(parts.project.own.score * 100)}% скрытых тестов`);
  else if (parts.project && parts.project.others.length) out.push(`есть проверенный проект в другой потребности (${parts.project.others.length})`);
  if (parts.defense) {
    out.push(parts.defense.score === null ? 'защита: ответов нет' : `защита: ${parts.defense.score} из 8${parts.defense.flags.includes('strong_project_weak_defense') ? ' (флаг: сильный проект при слабой защите)' : ''}`);
  }
  return out.join('; ');
}

// ---------------------------------------------------------------------------
// Приватность (R-C-16): до принятого приглашения текст пояснений рубрики маскируется
// ---------------------------------------------------------------------------

/**
 * Пояснения рубрики цитируют код кандидата и могут содержать имя, e-mail, ссылки и ники. До принятого приглашения
 * они проходят `maskContacts` (контакты → «[скрыто]»). Имена людей `maskContacts` не ловит: он маскирует
 * контакты, а не персональные данные в целом — это известное ограничение.
 */
export function maskProjectBlock(block: ProjectBlock): ProjectBlock {
  if (!block.own) return block;
  return {
    ...block,
    own: {
      ...block.own,
      criteria: block.own.criteria.map((c) => ({
        ...c,
        evidence: maskContacts(c.evidence).text,
        file: c.file ? maskContacts(c.file).text : c.file,
      })),
    },
  };
}
