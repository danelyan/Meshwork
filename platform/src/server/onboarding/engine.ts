import { z } from 'zod';

import { checkInn } from './inn';
import { SUMMARY_STEP, scenarioSteps } from './scenario';
import type { Answers, StepContext, StepDef, StepOption } from './types';

/**
 * Движок шагов онбординга: чистые функции над сценарием (scenario.ts) и
 * состоянием (ответы + пропуски + текущий шаг). БД не трогает — её пишет service.ts.
 *
 * Правила:
 *  - шаг виден, если нет `when` или оно истинно (условие пересчитывается на каждом ответе);
 *  - шаг закрыт, если на него есть ответ, он пропущен или закрыт фактом (`doneBy`);
 *  - следующий шаг — первый незакрытый после текущего; незакрытых нет — итог;
 *  - обязательный шаг (`required`) пропустить нельзя.
 */

export interface EngineState {
  stepId: string | null;
  answers: Answers;
  skipped: string[];
}

export function optionsOf(step: StepDef, ctx: StepContext): StepOption[] {
  if (!step.options) return [];
  return typeof step.options === 'function' ? step.options(ctx) : step.options;
}

export function visibleSteps(ctx: StepContext): StepDef[] {
  return scenarioSteps(ctx).steps.filter((s) => !s.when || s.when(ctx));
}

export function isAnswered(step: StepDef, answers: Answers): boolean {
  return Object.prototype.hasOwnProperty.call(answers, step.id);
}

export function isClosed(step: StepDef, ctx: StepContext, skipped: string[]): boolean {
  if (step.kind === 'summary') return false;
  return isAnswered(step, ctx.answers) || skipped.includes(step.id) || Boolean(step.doneBy?.(ctx));
}

/** Первый незакрытый шаг после `fromId` (или с начала); нет — итог. */
export function nextOpen(ctx: StepContext, skipped: string[], fromId: string | null): StepDef {
  const steps = visibleSteps(ctx);
  const start = fromId ? steps.findIndex((s) => s.id === fromId) + 1 : 0;
  for (let i = Math.max(0, start); i < steps.length; i++) {
    const s = steps[i]!;
    if (s.kind !== 'summary' && !isClosed(s, ctx, skipped)) return s;
  }
  // После возврата к шагу: незакрытые раньше текущего тоже надо пройти, потом итог.
  const earlier = steps.find((s) => s.kind !== 'summary' && !isClosed(s, ctx, skipped));
  return earlier ?? SUMMARY_STEP;
}

/**
 * Текущий шаг. Сохранённый `stepId` — если он виден и не закрыт фактом (согласие
 * могли дать в другой вкладке); иначе первый незакрытый.
 */
export function currentStep(ctx: StepContext, state: EngineState): StepDef {
  const steps = visibleSteps(ctx);
  if (state.stepId) {
    const s = steps.find((x) => x.id === state.stepId);
    if (s && (s.kind === 'summary' || !s.doneBy?.(ctx))) {
      if (s.kind !== 'summary' || steps.every((x) => isClosed(x, ctx, state.skipped) || x.kind === 'summary')) return s;
    }
  }
  return nextOpen(ctx, state.skipped, null);
}

/**
 * Шаги, закрытые в порядке сценария. Шаг, закрытый только фактом из аккаунта
 * (роль, компания), считается и показывается в ленте не раньше своей очереди —
 * после первого реально открытого шага он «ещё не наступил».
 */
function passedSteps(ctx: StepContext, skipped: string[], layout: StepContext = ctx): StepDef[] {
  const steps = visibleSteps(layout).filter((s) => s.kind !== 'summary');
  const firstOpen = steps.findIndex((s) => !isClosed(s, ctx, skipped));
  return steps.filter((s, i) => {
    if (!isClosed(s, ctx, skipped)) return false;
    const factOnly = !isAnswered(s, ctx.answers) && !skipped.includes(s.id);
    return !factOnly || firstOpen === -1 || i < firstOpen;
  });
}

export function progress(ctx: StepContext, skipped: string[]): { done: number; total: number } {
  // Пока роль не выбрана, длину считаем по сценарию кандидата: шкала не «прыгает» с 2 до 12.
  const probe = ctx.facts.role === 'pending' && !ctx.answers.role ? { ...ctx, answers: { ...ctx.answers, role: 'candidate' } } : ctx;
  const total = visibleSteps(probe).filter((s) => s.kind !== 'summary').length;
  return { done: passedSteps(ctx, skipped, probe).length, total };
}

/** Видимые шаги, закрытые до текущего (лента чата). */
export function historyOf(ctx: StepContext, state: EngineState, current: StepDef): StepDef[] {
  return passedSteps(ctx, state.skipped).filter((s) => s.id !== current.id);
}

// --- проверка ответа ---

export class AnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnswerError';
  }
}

const Custom = z.string().trim().min(1).max(60);

export function validateAnswer(step: StepDef, value: unknown, ctx: StepContext): unknown {
  const enabled = optionsOf(step, ctx)
    .filter((o) => !o.disabled)
    .map((o) => o.value);
  const fail = (msg: string): never => {
    throw new AnswerError(msg);
  };
  switch (step.kind) {
    case 'consent': {
      const r = z.object({ version: z.string().min(1).max(64) }).safeParse(value);
      return r.success ? r.data : fail('Нужна версия текста согласия');
    }
    case 'role': {
      const r = z.enum(['candidate', 'employer']).safeParse(value);
      return r.success ? r.data : fail('Выбери роль');
    }
    case 'one': {
      if (typeof value !== 'string') return fail('Выбери вариант');
      if (enabled.includes(value)) return value;
      if (optionsOf(step, ctx).some((o) => o.value === value)) return fail('Этот вариант пока недоступен');
      if (step.allowCustom) {
        const r = Custom.safeParse(value);
        return r.success ? r.data : fail('Свой вариант — до 60 символов');
      }
      return fail('Выбери один из вариантов');
    }
    case 'many': {
      const r = z.array(z.string()).min(1).max(enabled.length || 1).safeParse(value);
      if (!r.success) return fail('Выбери хотя бы один вариант');
      const uniq = [...new Set(r.data)];
      if (uniq.some((v) => !enabled.includes(v))) return fail('Выбери из предложенных вариантов');
      return uniq;
    }
    case 'chips': {
      const r = z.array(Custom).max(30).safeParse(value);
      if (!r.success) return fail('До 30 пунктов, каждый до 60 символов');
      const known = new Map(optionsOf(step, ctx).map((o) => [o.value.toLowerCase(), o.value]));
      const out: string[] = [];
      for (const v of r.data) {
        const norm = known.get(v.toLowerCase()) ?? (step.allowCustom ? v : null);
        if (norm === null) return fail('Выбери из предложенных вариантов');
        if (!out.some((x) => x.toLowerCase() === norm.toLowerCase())) out.push(norm);
      }
      if (out.length === 0) return fail('Выбери хотя бы один пункт или пропусти шаг');
      return out;
    }
    case 'range': {
      const spec = step.range!;
      const r = z.object({ from: z.number().int(), to: z.number().int() }).safeParse(value);
      if (!r.success) return fail('Нужны два целых числа');
      const { from, to } = r.data;
      if (from < spec.min || to > spec.max || from > to) return fail(`Диапазон ${spec.min}–${spec.max}, «${spec.fromLabel}» не больше «${spec.toLabel}»`);
      return { from, to };
    }
    case 'text': {
      const r = z.string().trim().min(1).max(step.maxLength ?? 200).safeParse(value);
      if (!r.success) return fail(`Нужен текст до ${step.maxLength ?? 200} символов`);
      if (step.check === 'inn') {
        const c = checkInn(r.data);
        if (!c.ok) return fail(c.reason);
        return r.data.replace(/\s+/g, '');
      }
      return r.data;
    }
    case 'files': {
      const r = z
        .object({
          uploadIds: z.array(z.string().min(1).max(64)).max(10).default([]),
          urls: z.array(z.url().max(2048)).max(10).default([]),
          claims: z.number().int().min(0).max(500).default(0),
        })
        .safeParse(value);
      if (!r.success) return fail('Некорректный список файлов и ссылок');
      if (r.data.uploadIds.length + r.data.urls.length === 0) return fail('Приложи файл или ссылку — или пропусти шаг');
      return r.data;
    }
    case 'summary':
      return fail('На итог не отвечают');
  }
}

/** Ответ человеческим текстом (лента и сводка). */
export function answerLabel(step: StepDef, value: unknown, ctx: StepContext): string {
  const opts = optionsOf(step, ctx);
  const label = (v: unknown) => {
    const o = opts.find((x) => x.value === v);
    return o ? (o.answered ?? o.label) : String(v);
  };
  switch (step.kind) {
    case 'consent':
      return 'Согласен(на) на обработку данных';
    case 'role':
    case 'one':
      return label(value);
    case 'many':
    case 'chips':
      return Array.isArray(value) ? value.map(label).join(', ') : '';
    case 'range': {
      const v = value as { from: number; to: number };
      const unit = step.range!.unit;
      return `${step.range!.fromLabel.toLowerCase()} ${v.from}, ${step.range!.toLabel.toLowerCase()} ${v.to} ${unit}`;
    }
    case 'text':
      return String(value);
    case 'files': {
      const v = value as { uploadIds: string[]; urls: string[]; claims: number };
      const parts = [];
      if (v.uploadIds.length) parts.push(`файлов: ${v.uploadIds.length}`);
      if (v.urls.length) parts.push(`ссылок: ${v.urls.length}`);
      parts.push(`утверждений найдено: ${v.claims}`);
      return parts.join(', ');
    }
    case 'summary':
      return '';
  }
}

/** Ответ для шага, закрытого фактом (согласие, роль) без записи в состоянии. */
export function factLabel(step: StepDef, ctx: StepContext): string {
  if (step.kind === 'consent') return 'Согласие дано';
  if (step.kind === 'role') return ctx.facts.role === 'employer' ? 'Ищу специалистов' : 'Ищу работу';
  if (step.id === 'companyName') return 'Компания создана';
  return '';
}
