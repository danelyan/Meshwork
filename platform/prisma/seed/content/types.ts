/**
 * Контент работодательской стороны демо-стенда: компании, вакансии, проектные задания к ним, активность.
 * Данные — по файлам `vacancies-<направление>.ts` (один автор на файл), компании — `companies.ts`.
 * Всё вымышленное; названия компаний и цифры зарплат в легенде задания запрещены (проверяет tests/unit/seed/content.test.ts).
 */

export type Grade = 'junior' | 'middle' | 'senior';
export type Spec = 'backend' | 'frontend' | 'ai' | 'engineering';

/** Slug компании = хвост id `demo-co-<slug>`. Список заморожен: авторы вакансий берут только отсюда. */
export const COMPANY_SLUGS = [
  'northstream', 'granit', 'labirint',
  'yasen-retail', 'vektor-logistics', 'neyron-lab', 'atlas-cloud', 'medline-digital', 'gorodum', 'pulse-games',
] as const;
export type CompanySlug = (typeof COMPANY_SLUGS)[number];

export const companyId = (slug: CompanySlug): string => `demo-co-${slug}`;
export const employerUserId = (slug: CompanySlug): string => `demo-employer-${slug}`;
export const employerProfileId = (slug: CompanySlug): string => `demo-employer-${slug}-p`;

/** Проектное задание к вакансии: легенда поверх контракта шаблона (`project-templates/<sub>/<grade>/<templateId>`). */
export interface ProjectContent {
  /** id манифеста шаблона; направление, грейд и подкатегория должны совпадать с вакансией. */
  templateId: string;
  /** Легенда в домене компании, 10–2000 символов. Без названия компании и цифр зарплаты. */
  domainStory: string;
  /** Требования поверх контракта (не пересказ контракта), каждое 3–400 символов, не больше 12. */
  requirements: string[];
  /** Пожелания работодателя через «;» или с новой строки (≤ 6 пунктов по 8+ символов), либо null. */
  wishesText: string | null;
  /** Обязательные критерии из каталога утверждений своего направления или common, 1–8. */
  requiredCatalogIds: string[];
  /** Срок на решение, 1–30 дней. */
  deadlineDays: number;
  visibility?: 'open' | 'invited';
}

export interface VacancyContent {
  /** `demo-vac-<slug>-<n>` */
  id: string;
  companySlug: CompanySlug;
  /** 3–120 символов */
  title: string;
  specialization: Spec;
  /** id из src/lib/directions.ts, того же направления */
  subcategoryId: string;
  grade: Grade;
  /** ₽ в месяц, from < to */
  salaryFrom: number;
  salaryTo: number;
  /** Свободные метки, ≤ 15 × ≤ 40 символов */
  stack: string[];
  /** Требования из каталога: [catalogId, вес 1–3], 1–25 штук */
  needs: [string, 1 | 2 | 3][];
  /** Чем предстоит заниматься / что ждём / условия, ≤ 2000 */
  description: string;
  /** Чем занимается команда, размер, процессы, ≤ 2000 */
  teamDescription: string;
  project: ProjectContent;
}

export interface CompanyContent {
  slug: CompanySlug;
  name: string;
  industry: string;
  /** Способ связи, виден кандидату до принятия приглашения (ТЗ 2.2) */
  contact: string;
  /** Первый абзац — слоган одной строкой (< 140 символов), дальше 1–2 абзаца о компании и найме. */
  description: string;
  /** Демо-представитель (вход жюри работодателем). Для компаний с готовыми логинами — null. */
  employer: { name: string; email: string; badge: string; sees: string } | null;
}

export type ActivityContent =
  | {
      kind: 'application';
      /** `demo-app-<slug>-<n>` */
      id: string;
      vacancyId: string;
      candidateId: string;
      status: 'sent' | 'viewed' | 'accepted' | 'declined';
      message: string;
      ageDays: number;
    }
  | {
      kind: 'invitation';
      /** `demo-inv-<slug>-<n>` */
      id: string;
      vacancyId: string;
      candidateId: string;
      status: 'sent' | 'viewed' | 'accepted' | 'declined';
      message: string;
      salaryFrom: number;
      salaryTo: number;
      ageDays: number;
    };

/** Тождественные функции для типизации литералов в файлах авторов. */
export const defineVacancies = (v: VacancyContent[]): VacancyContent[] => v;
export const defineProjects = (p: Record<string, ProjectContent>): Record<string, ProjectContent> => p;
