import type { Role, StepKind, StepOption } from './types';

/**
 * Свободный текст в онбординге (решение владельца 09.10, «свободный вопрос посреди онбординга»).
 * Чистые функции без БД и модели — их зовёт и клиент (OnboardingChat), и тесты:
 *  - matchStepText — текст совпал с вариантом текущего шага → это ответ на шаг (тем же путём, что клик);
 *  - asideToModel — можно ли отдать несовпавший текст консультанту (граница доверия);
 *  - looksLikeQuestion — на шагах со своим вариантом текст по умолчанию ответ, вопрос — только с «?».
 */

/** Нижний регистр, ё → е, без пунктуации по краям и лишних пробелов («Ищу работу!» = «ищу работу»). */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`!?.,;:()[\]{}—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Чем можно назвать вариант: подпись, значение, «как звучит ответ», подпись без пояснения в скобках. */
function namesOf(o: StepOption): string[] {
  const names = [o.label, o.value, o.answered ?? '', o.label.replace(/\(.*?\)/g, ''), o.value.replace(/_/g, ' ')];
  return [...new Set(names.map(normalizeAnswer).filter(Boolean))];
}

function findOption(options: StepOption[], text: string): StepOption | undefined {
  const t = normalizeAnswer(text);
  if (!t) return undefined;
  return options.find((o) => !o.disabled && namesOf(o).includes(t));
}

export interface StepLike {
  kind: StepKind;
  options?: StepOption[];
}

export interface TextMatch {
  value: unknown;
  /** Текст пузыря ответа — как при клике. */
  text: string;
}

const optionText = (o: StepOption) => o.answered ?? o.label;

/**
 * Текст как ответ на текущий шаг: роль и «один из» — по названию варианта, «несколько» —
 * перечисление через запятую или «и» (все части должны совпасть). Согласие текстом не даётся:
 * только кнопкой (R-C-14). Остальные виды шагов здесь не сопоставляются.
 */
export function matchStepText(step: StepLike, text: string): TextMatch | null {
  // Вариант-ссылка (вход в ФСП ID) текстом не выбирается: ответ на него пишет сервер по возврату.
  const options = (step.options ?? []).filter((o) => !o.href);
  if (step.kind === 'role' || step.kind === 'one') {
    const o = findOption(options, text);
    return o ? { value: o.value, text: optionText(o) } : null;
  }
  if (step.kind === 'many') {
    const whole = findOption(options, text);
    if (whole) return { value: [whole.value], text: optionText(whole) };
    const parts = text
      .split(/[,;/+]|\s+и\s+/i)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;
    const found = parts.map((p) => findOption(options, p));
    if (found.some((o) => !o)) return null;
    const uniq = [...new Map(found.map((o) => [o!.value, o!])).values()];
    return { value: uniq.map((o) => o.value), text: uniq.map((o) => o.label).join(', ') };
  }
  return null;
}

/** Вопрос, а не ответ: заканчивается знаком вопроса. */
export function looksLikeQuestion(text: string): boolean {
  return /\?\s*$/.test(text.trim());
}

/**
 * Граница доверия: свободный текст уходит в модель только после согласия и выбора роли
 * «специалист» (дальше это консультант кандидата). На шагах согласия и роли, у работодателя
 * и на итоге — нет: там заготовленный ответ без модели.
 */
export function asideToModel(role: Role, kind: StepKind): boolean {
  return role === 'candidate' && kind !== 'consent' && kind !== 'consents' && kind !== 'role' && kind !== 'summary';
}

/** Маркер шага в тексте хода консультанта: по нему лента онбординга восстанавливает вопросы после перезагрузки. */
export const ASIDE_MARK_RE = /^\[онбординг: шаг ([A-Za-z]{1,40})\]$/;
export const asideMark = (stepId: string) => `[онбординг: шаг ${stepId}]`;

/**
 * Маркер реплики свободного разговора, пока знакомство на паузе («Настроить позже»): шаг, на котором
 * пауза. Лента ставит такие реплики под этот шаг (хронология), но это не «вопрос посреди шага».
 */
export const PAUSE_MARK_RE = /^\[знакомство на паузе: шаг ([A-Za-z]{1,40})\]$/;
export const pauseMark = (stepId: string) => `[знакомство на паузе: шаг ${stepId}]`;
