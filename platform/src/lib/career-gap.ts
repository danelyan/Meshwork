// Выбор действия «Закрыть пробел» на карте кандидата. Чистый модуль: его читают клиентские компоненты и тесты.
// Самоотклика нет (обратная механика): кнопка ведёт к действию, после которого компания увидит кандидата сама.
import { GRADES, type Grade } from './grades';

export type GapCategory = { specialization: string; grade: Grade };
export type GapVacancy = {
  specialization: string;
  grade: Grade;
  missing: { catalogId: string }[];
  /** Задание этой вакансии, доступное кандидату (открытое, своего направления, грейд не выше категории). */
  projectTaskId?: string | null;
};
export type GapCta =
  | { kind: 'test'; label: string; href: string; hint: string }
  | { kind: 'project'; label: string; href: string; hint: string }
  | { kind: 'skill'; label: string; href: string; hint: string }
  | { kind: 'done'; label: string; href: null; hint: string };

const HINT = 'Самому откликаться не нужно: компания увидит вас в подборке и пригласит сама.';

/**
 * Правила по порядку:
 * 1. нет категории этого направления с грейдом не ниже вакансии - тест;
 * 2. требования закрыты - «в подборке», без кнопки;
 * 3. есть пробелы и у вакансии есть доступное задание - проект;
 * 4. иначе - подтвердить навык у консультанта.
 */
export function chooseGapCta(vacancy: GapVacancy, categories: GapCategory[]): GapCta {
  const need = GRADES.indexOf(vacancy.grade);
  const qualified = categories.some((c) => c.specialization === vacancy.specialization && GRADES.indexOf(c.grade) >= need);
  if (!qualified) return { kind: 'test', label: 'Пройти тест', href: '/test', hint: `Нужна категория для этой вакансии. ${HINT}` };
  if (vacancy.missing.length === 0) return { kind: 'done', label: 'Вы в подборке', href: null, hint: 'Требования вакансии закрыты. Компания увидит вас в подборке и пригласит сама.' };
  if (vacancy.projectTaskId) return { kind: 'project', label: 'Взять проект', href: `/projects/${encodeURIComponent(vacancy.projectTaskId)}`, hint: `Проект подтвердит недостающее. ${HINT}` };
  return { kind: 'skill', label: 'Подтвердить навык', href: '/consultant', hint: `Подтвердите недостающие навыки. ${HINT}` };
}
