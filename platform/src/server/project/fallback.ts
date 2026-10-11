// Детерминированные сборки условия и рубрики (lane project): ответ stub-провайдера для project_spec /
// project_rubric и запасной путь, если модель недоступна или вернула мусор. Без импорта llm/*:
// этот модуль подключает llm/providers/stub-project.ts, цикла быть не должно.
import { MAX_WISH_CRITERIA, type RubricCriterion, type RubricResult, type SpecLlmOut, type StoredSpec } from './schemas';

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

/**
 * JSON внутри тега: `<` и `>` экранируются как \u003c / \u003e (как в call/prompt-utils.ts) — файлы репозитория и
 * журнал ИИ кандидата не могут закрыть тег и открыть свой блок, а JSON остаётся валидным (parseContextBlock).
 */
export function contextBlock(ctx: ProjectContext): string {
  return `<${CONTEXT_TAG}>\n${JSON.stringify(ctx).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\n</${CONTEXT_TAG}>`;
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

const GRADE_RU: Record<string, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior' };

/** Детерминированная легенда и требования поверх контракта (stub и запасной путь project_spec). */
export function fallbackSpecOut(ctx: SpecContext): SpecLlmOut {
  const t = ctx.template;
  const team = ctx.need.teamDescription?.trim() || ctx.need.description?.trim() || null;
  const teamText = team?.slice(0, 400).replace(/[.\s]+$/, '');
  const domain = teamText ? (/^команд/i.test(teamText) ? teamText : `Команда: ${teamText}`) : 'Команда работодателя';
  return {
    domainStory: `${domain}. Проектное задание уровня ${GRADE_RU[t.grade] ?? t.grade}: ${t.summary || t.title}. Работодатель смотрит, как решение закрывает его критерии поверх контракта платформы.`.slice(0, 2000),
    requirements: [...ctx.required.map((r) => `(критерий работодателя) ${r.statement}`), ...splitWishes(ctx.wishes ?? '').map((w) => `(пожелание) ${w}`)],
  };
}

/** Число-«код» (1xx–5xx), если за ним не единица измерения: «200 мс», «500 руб», «300 символов» — не коды. */
const CODE_NUM = /(?<![\p{L}\p{N}])([1-5]\d\d)(?![\p{N}]|[.,]\d|\s*(?:мс|ms|сек|с(?![\p{L}])|мин|ч(?![\p{L}])|руб|₽|%|кб|мб|гб|kb|mb|gb|символ|строк|запрос|раз|шт|пользовател|клиент|элемент|запис))/giu;
/** Слова, рядом с которыми трёхзначное число — HTTP-статус. */
const CODE_CONTEXT = /(?:статус|код|http|ответ)\S*\s*[:=—-]?\s*(?:\S+\s+){0,2}?[1-5]\d\d(?![\p{N}])/iu;

/**
 * Требования модели, которые пересказывают контракт (имена из `…`, коды ошибок в кавычках, HTTP-статусы,
 * маршруты), отбрасываются: контракт приложен дословно, пересказ только вносит ошибки. Число считается
 * статусом, только если оно встречается в контракте как код или стоит рядом со словами «статус/код/HTTP/ответ».
 */
export function dropContractEcho(items: string[], contractMd: string): string[] {
  const idents = new Set<string>();
  // Только идентификаторы (латиница/цифры): контракт в обратных кавычках может выделять и русское слово
  // (« `и` »), и тогда отброшенным оказалось бы любое требование на русском.
  for (const m of contractMd.matchAll(/`([^`\n]{3,80})`/g)) {
    const id = m[1]!.trim();
    if (id.length >= 3 && /[A-Za-z0-9_]/.test(id)) idents.add(id);
  }
  for (const m of contractMd.matchAll(/['"]([a-z][a-z0-9_]{2,40})['"]/g)) idents.add(m[1]!);
  const contractCodes = new Set([...contractMd.matchAll(CODE_NUM)].map((m) => m[1]!));
  return items.filter((r) => {
    if (r.includes('`') || /(?:^|\s)(?:GET|POST|PUT|PATCH|DELETE)\s+\//.test(r)) return false;
    if (CODE_CONTEXT.test(r)) return false;
    for (const m of r.matchAll(CODE_NUM)) if (contractCodes.has(m[1]!)) return false;
    for (const id of idents) if (r.includes(id)) return false;
    return true;
  });
}

/** Первая строка требований: ссылка на приложенный контракт. */
export const CONTRACT_REQUIREMENT = 'Реализовать контракт платформы — он приложен ниже дословно (contract.md). Имена модулей, функций, маршрутов, полей и коды ошибок — только оттуда.';

/**
 * Фильтр выбросил все требования модели — показываем критерии рубрики (обязательные и пожелания),
 * чтобы кандидат видел, чего ждёт работодатель.
 */
export function fillRequirementsFromRubric(spec: StoredSpec, criteria: RubricCriterion[]): StoredSpec {
  if (spec.requirements.some((r) => r !== CONTRACT_REQUIREMENT) || !criteria.length) return spec;
  return {
    ...spec,
    requirements: [CONTRACT_REQUIREMENT, ...criteria.map((c) => `${c.source === 'required' ? '(критерий работодателя)' : '(пожелание)'} ${c.text}`)].slice(0, 15),
  };
}

/** Итоговое условие: заголовок шаблона, легенда и требования (модель или fallback), остальное — кодом. */
export function assembleSpec(ctx: SpecContext, out: SpecLlmOut, contractMd: string, source: StoredSpec['source']): StoredSpec {
  const t = ctx.template;
  const hours = Math.round((t.timeBudgetMin / 60) * 10) / 10;
  return {
    title: t.title.slice(0, 160),
    domainStory: out.domainStory.slice(0, 2000),
    requirements: [
      CONTRACT_REQUIREMENT,
      ...dropContractEcho(out.requirements, contractMd).map((r) => r.slice(0, 400)),
    ].slice(0, 15),
    acceptance: [
      'Скрытые автотесты платформы по контракту: балл — доля пройденных.',
      'Видимые тесты tests/visible проходят локально.',
      ...ctx.required.map((r) => `Критерий работодателя (${r.catalogId}): ${r.statement}`),
      ...(ctx.wishes?.trim() ? ['Пожелания работодателя проверяются по коду и журналу ИИ — отдельной таблицей критериев.'] : []),
    ].slice(0, 12),
    notes: `ИИ-ассистенты разрешены — приложи журнал работы с ИИ. Если текст условия расходится с контрактом, прав контракт. Ориентир по времени — около ${hours} ч.${ctx.need.stack.length ? ` Стек команды для контекста: ${ctx.need.stack.join(', ')}.` : ''}`,
    contractMd,
    source,
  };
}

/** Полностью детерминированное условие (stub или сбой модели). */
export function fallbackSpec(ctx: SpecContext, contractMd = ctx.template.contractMd): StoredSpec {
  return assembleSpec(ctx, fallbackSpecOut(ctx), contractMd, 'fallback');
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
