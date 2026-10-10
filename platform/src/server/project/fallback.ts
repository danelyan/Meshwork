// Детерминированные сборки условия и рубрики (lane project): ответ stub-провайдера для project_spec /
// project_rubric и запасной путь, если модель недоступна или вернула мусор. Без импорта llm/*:
// этот модуль подключает llm/providers/stub-project.ts, цикла быть не должно.
import { MAX_WISH_CRITERIA, type RubricCriterion, type RubricResult, type SpecJson } from './schemas';

/** То, что видит модель (и stub) в блоке <project_context>. */
export interface SpecContext {
  mode: 'spec';
  template: { id: string; title: string; summary: string; grade: string; subcategoryId: string; stack: string[]; contractMd: string; timeBudgetMin: number };
  need: { title: string; teamDescription: string | null; description: string | null; stack: string[] };
  required: { catalogId: string; statement: string }[];
  wishes: string | null;
}

export interface ComposeContext {
  mode: 'compose';
  wishes: string;
}

export interface EvaluateContext {
  mode: 'evaluate';
  criteria: { id: string; text: string }[];
  tests: { passed: number; total: number; score: number };
  files: { path: string; text: string }[];
  /** Все пути репозитория (для проверки ссылок на файлы). */
  tree: string[];
  aiLog: string;
}

export type ProjectContext = SpecContext | ComposeContext | EvaluateContext;

export const CONTEXT_TAG = 'project_context';

export function contextBlock(ctx: ProjectContext): string {
  return `<${CONTEXT_TAG}>\n${JSON.stringify(ctx)}\n</${CONTEXT_TAG}>`;
}

export function parseContextBlock(text: string): ProjectContext | null {
  const m = new RegExp(`<${CONTEXT_TAG}>\\n([\\s\\S]*?)\\n</${CONTEXT_TAG}>`).exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as ProjectContext;
  } catch {
    return null;
  }
}

const GRADE_RU: Record<string, string> = { junior: 'Junior', middle: 'Middle' };

export function fallbackSpec(ctx: SpecContext): SpecJson {
  const t = ctx.template;
  const team = ctx.need.teamDescription?.trim() || ctx.need.description?.trim() || null;
  const teamText = team?.slice(0, 400).replace(/[.\s]+$/, '');
  const domain = teamText ? (/^команд/i.test(teamText) ? teamText : `Команда: ${teamText}`) : 'Команда работодателя';
  const wishes = splitWishes(ctx.wishes ?? '');
  const hours = Math.round((t.timeBudgetMin / 60) * 10) / 10;
  return {
    title: t.title.slice(0, 160),
    domainStory: `${domain}. Проектное задание уровня ${GRADE_RU[t.grade] ?? t.grade}: ${t.summary || t.title}. Задание строится на фиксированном контракте платформы — его проверяют автотесты, а работодатель смотрит, как решение закрывает его критерии.`.slice(0, 2000),
    requirements: [
      `Реализовать контракт из contract.md без изменений имён модулей, функций, маршрутов и полей.`,
      ...ctx.required.map((r) => `Показать в решении: ${r.statement}`),
      ...wishes.map((w) => `(пожелание) ${w}`),
    ].slice(0, 15),
    acceptance: [
      'Скрытые автотесты платформы по contract.md: балл — доля пройденных.',
      'Видимые тесты tests/visible проходят локально.',
      ...ctx.required.map((r) => `Критерий работодателя (${r.catalogId}): ${r.statement}`),
    ].slice(0, 12),
    notes: `ИИ-ассистенты разрешены — приложи журнал работы с ИИ. Если условие расходится с contract.md, прав contract.md. Ориентир по времени — около ${hours} ч.${ctx.need.stack.length ? ` Стек команды для контекста: ${ctx.need.stack.join(', ')}.` : ''}`,
  };
}

/** Пожелания свободным текстом → отдельные проверяемые пункты (строки, «;», предложения). */
export function splitWishes(text: string): string[] {
  return text
    .split(/\n|;|(?<=[.!?])\s+/)
    .map((s) => s.replace(/^[\s\-–—*•\d.)]+/, '').trim().replace(/[.;]+$/, ''))
    .filter((s) => s.length >= 8)
    .slice(0, MAX_WISH_CRITERIA)
    .map((s) => s.slice(0, 300));
}

export function requiredCriteria(required: { catalogId: string; statement: string }[]): RubricCriterion[] {
  return required.map((r) => ({ id: `req:${r.catalogId}`, text: r.statement.slice(0, 300), catalogId: r.catalogId, source: 'required' as const }));
}

export function wishCriteria(texts: string[]): RubricCriterion[] {
  return texts.slice(0, MAX_WISH_CRITERIA).map((text, i) => ({ id: `wish:${i + 1}`, text, source: 'wish' as const }));
}

const STOP = new Set(['который', 'которые', 'должен', 'должна', 'должно', 'чтобы', 'решение', 'решении', 'показать', 'проект', 'код', 'кода']);

/**
 * Детерминированная «проверка» критериев для stub: прошёл, если в репозитории есть файл со словом из
 * критерия (≥ 5 букв) или, без файлов, если автотесты пройдены не меньше чем на 60 %.
 */
export function fallbackVerdicts(ctx: EvaluateContext): { id: string; passed: boolean; evidence: string; file: string | null }[] {
  return ctx.criteria.map((c) => {
    const words = (c.text.toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) ?? []).filter((w) => !STOP.has(w));
    for (const f of ctx.files) {
      const lower = f.text.toLowerCase();
      const hit = words.find((w) => lower.includes(w.slice(0, 6)));
      if (hit) return { id: c.id, passed: true, evidence: `[stub] в ${f.path} есть «${hit.slice(0, 6)}…»`, file: f.path };
    }
    const passed = ctx.tests.total > 0 && ctx.tests.score >= 60;
    return { id: c.id, passed, evidence: `[stub] по результату автотестов: ${ctx.tests.passed}/${ctx.tests.total}`, file: null };
  });
}

/** Модель недоступна — критерии без оценки (не «не прошёл»: это не вина кандидата). */
export function notEvaluated(criteria: RubricCriterion[]): RubricResult[] {
  return criteria.map((c) => ({ ...c, passed: null, evidence: 'Проверка моделью недоступна — смотри код на защите.', flag: 'not_evaluated' as const }));
}
