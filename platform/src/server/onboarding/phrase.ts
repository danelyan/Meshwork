import { getEnv } from '@/server/env';
import { getLlm } from '@/server/llm';

import { ONBOARDING_PROMPT } from './prompt';
import { DIRECTIONS } from './scenario';
import type { StepContext, StepDef } from './types';

/**
 * Реплики помощника. Вопрос и варианты всегда из сценария (scenario.ts) — их
 * не генерирует модель. Модель (если она есть) пишет только короткую связку
 * перед вопросом; без модели (stub, демо) и при любой её ошибке — шаблон.
 */

export interface PrevAnswer {
  step: StepDef;
  /** undefined — шаг пропущен или закрыт фактом. */
  value: unknown;
  label: string | null;
}

/** «Демо: Анна Кравец (HR, работодатель)» → «Анна». */
export function firstName(full: string): string {
  const clean = full.replace(/^демо:\s*/i, '').replace(/\(.*?\)/g, '').trim();
  const first = clean.split(/\s+/)[0] ?? '';
  return /^[\p{L}-]{2,40}$/u.test(first) ? first : '';
}

const specLabel = (v: unknown) => DIRECTIONS.find((d) => d.value === v)?.label ?? '';

export function templateLead(step: StepDef, ctx: StepContext, prev: PrevAnswer | null): string {
  const name = firstName(ctx.facts.name);
  const hi = name ? `${name}, ` : '';
  const skipped = prev !== null && prev.value === undefined && prev.step.kind !== 'consent' && prev.step.kind !== 'role';
  if (step.id === 'consent') {
    return `Привет${name ? `, ${name}` : ''}! Я помощник ФСП Карьеры. Задам несколько коротких вопросов — любой можно пропустить или настроить позже.`;
  }
  if (step.kind === 'summary') {
    return ctx.answers.role === 'employer' || ctx.facts.role === 'employer'
      ? `${hi}готово. Проверь потребность — по ней соберётся подборка кандидатов.`
      : `${hi}готово. Проверь, всё ли я понял верно.`;
  }
  if (skipped) return 'Хорошо, к этому можно вернуться позже.';
  switch (step.id) {
    case 'role':
      return 'Спасибо. Теперь познакомимся.';
    case 'goal':
      return `${hi}начнём с главного.`;
    case 'documents': {
      const goal = prev?.step.id === 'goal' ? prev.value : ctx.answers.goal;
      if (goal === 'job_search') return 'Тогда соберём профиль, по которому компании найдут тебя сами.';
      if (goal === 'market_watch') return 'Посмотрим, что о тебе уже можно сказать по документам.';
      if (goal === 'grade_confirm') return 'Перед тестом соберу, что ты уже умеешь, — так проще выбрать грейд.';
      return 'Соберём профиль из того, что у тебя уже есть.';
    }
    case 'fsp':
      return 'Ещё один источник — соревнования ФСП.';
    case 'specialization':
      if (prev?.step.id === 'fsp' && prev.value === 'linked') return 'Демо-профиль ФСП привязан.';
      if (prev?.step.id === 'fsp' && prev.value === 'not_linked') return 'Без истории ФСП — тоже нормально, решает тест.';
      return 'Теперь про работу.';
    case 'grade': {
      const s = specLabel(ctx.answers.specialization);
      return s ? `${s} — понял.` : 'Понял.';
    }
    case 'stack':
      return 'Принято. Уточним инструменты.';
    case 'formats':
      return 'Хороший набор.';
    case 'city':
      return 'Офис или гибрид — понял.';
    case 'salary':
      return 'Почти закончили.';
    case 'fspParticipation':
      return 'Последний вопрос.';
    case 'companyName':
      return 'Отлично, найдём тебе людей. Сначала о компании.';
    case 'inn':
      return 'Записал.';
    case 'industry':
      return prev?.step.id === 'inn' ? 'ИНН в порядке.' : 'Дальше.';
    case 'about':
      return 'Кандидаты прочитают это первым.';
    case 'contact':
      return 'Спасибо.';
    case 'needSpecialization':
      return 'Теперь о том, кого ищешь.';
    case 'needGrades': {
      const s = specLabel(ctx.answers.needSpecialization);
      return s ? `${s} — понял.` : 'Понял.';
    }
    case 'needStack':
      return 'Уточним стек — по нему подберу утверждения каталога.';
    case 'needTeam':
      return 'Кандидатам важно понимать, чем предстоит заниматься.';
    case 'needSalary':
      return 'И главное для кандидатов — вилка.';
    default:
      return '';
  }
}

/** Ответ модели годится как реплика: короткий, без разметки. */
export function cleanLead(text: string | undefined): string | null {
  if (!text) return null;
  const t = text.trim().replace(/^["«]+|["»]+$/g, '').trim();
  if (t.length < 3 || t.length > 240) return null;
  if (/[#*|`]|\n\s*\n|^\s*[-•]/m.test(t)) return null;
  return t.replace(/\s+/g, ' ');
}

export function llmEnabled(): boolean {
  return getEnv().LLM_PROVIDER !== 'stub';
}

export async function leadFor(
  step: StepDef,
  ctx: StepContext,
  prev: PrevAnswer | null,
  opts: { candidateId?: string | null; signal?: AbortSignal } = {},
): Promise<string> {
  const template = templateLead(step, ctx, prev);
  if (!llmEnabled() || step.id === 'consent') return template;
  try {
    const llm = getLlm({ candidateId: opts.candidateId ?? undefined });
    const input = {
      name: firstName(ctx.facts.name),
      role: ctx.facts.role === 'pending' ? (ctx.answers.role ?? 'pending') : ctx.facts.role,
      step: { eyebrow: step.eyebrow, question: step.question },
      previous: prev ? { question: prev.step.question, answer: prev.label ?? 'пропущено' } : null,
    };
    const res = await llm.complete(
      {
        purpose: 'consultant',
        system: ONBOARDING_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        maxTokens: 160,
        temperature: 0.5,
        timeoutMs: 6000,
      },
      opts.signal,
    );
    return cleanLead(res.text) ?? template;
  } catch (err) {
    console.warn('[onboarding] lead fallback', err instanceof Error ? err.name : 'unknown');
    return template;
  }
}
