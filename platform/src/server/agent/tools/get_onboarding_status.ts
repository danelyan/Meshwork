import { z } from 'zod';

import { SPECIALIZATIONS } from '@/lib/directions';
import { prisma } from '@/server/db';
import { JOURNEY_STEPS, journeyState, STEP_HINT } from '../journey';
import type { AgentTool } from '../types';
import { EmptyInput } from './shared';
import { GRADES } from '@/lib/grades';

/**
 * Модели лейна onboarding (`CandidateProfile` по candidateId, `OnboardingState`
 * по userId) читаются через делегат по имени: инструмент компилируется и
 * работает и до слияния их миграции (делегата или таблицы нет → `profile: null`,
 * `profileAvailable: false`). После слияния интегратору ничего менять не нужно,
 * кроме теста «с анкетой» (см. отчёт лейна agentq).
 */
type FindUnique = (args: { where: Record<string, string> }) => Promise<unknown>;
export function optionalDelegate(name: 'candidateProfile' | 'onboardingState'): FindUnique | undefined {
  const d = (prisma as unknown as Record<string, { findUnique?: FindUnique } | undefined>)[name];
  return typeof d?.findUnique === 'function' ? d.findUnique.bind(d) : undefined;
}

async function readOptional(name: 'candidateProfile' | 'onboardingState', where: Record<string, string>): Promise<{ ok: boolean; row: unknown }> {
  const find = optionalDelegate(name);
  if (!find) return { ok: false, row: null };
  try {
    return { ok: true, row: await find({ where }) };
  } catch {
    // таблицы ещё нет (миграция onboarding не применена) — мягкая деградация
    return { ok: false, row: null };
  }
}

const Grade = z.enum(GRADES);
/** Анкета со слов кандидата: только то, что нужно для совета. Город и контакты в модель не отдаём. */
const ProfileSchema = z.object({
  goal: z.enum(['job_search', 'market_watch', 'grade_confirm']).nullable().catch(null),
  claimedGrade: Grade.nullable().catch(null),
  stack: z.array(z.string()).catch([]),
  workFormats: z.array(z.string()).catch([]),
  salaryMin: z.number().int().nullable().catch(null),
  salaryExpected: z.number().int().nullable().catch(null),
  fspParticipation: z.enum(['prize', 'participant', 'none']).nullable().catch(null),
});

const StepEnum = z.enum([...JOURNEY_STEPS, 'invitations', 'done']);
const Output = z.object({
  specialization: z.enum(SPECIALIZATIONS).nullable(),
  fspState: z.enum(['not_linked', 'no_achievements', 'unavailable', 'linked']),
  profileAvailable: z.boolean(),
  profile: ProfileSchema.nullable(),
  onboarding: z.object({ finished: z.boolean(), currentStep: z.string().nullable(), skipped: z.array(z.string()) }),
  steps: z.object(Object.fromEntries(JOURNEY_STEPS.map((s) => [s, z.boolean()])) as Record<(typeof JOURNEY_STEPS)[number], z.ZodBoolean>),
  counts: z.object({ sources: z.number().int(), proposed: z.number().int(), confirmed: z.number().int(), pendingInvitations: z.number().int(), defended: z.number().int() }),
  nextStep: StepEnum,
  hint: z.string(),
  note: z.string(),
});

export const getOnboardingStatus: AgentTool<Record<string, never>, z.infer<typeof Output>> = {
  name: 'get_onboarding_status',
  description:
    'Где кандидат на пути по платформе: анкета онбординга (цель, предполагаемый грейд, стек, формат, зарплата — со слов), пройденные шаги (документы, подтверждение карточек, тест, вакансии, защита), входящие приглашения и следующий шаг nextStep с подсказкой. ' +
    'Вызывай в начале разговора, на «что дальше?» / «с чего начать?» и когда не знаешь, что предложить. Не вызывай повторно в одном ходе. Анкета — со слов кандидата, не доказательство и не категория.',
  input: EmptyInput,
  output: Output,
  async handler(ctx) {
    const cand = await prisma.candidate.findUnique({
      where: { id: ctx.candidateId },
      select: { specialization: true, fspState: true, user: { select: { id: true, onboardedAt: true } } },
    });
    if (!cand) throw Object.assign(new Error('Кандидат не найден'), { code: 'not_found' });
    const [journey, prof, state] = await Promise.all([
      journeyState(ctx.candidateId),
      readOptional('candidateProfile', { candidateId: ctx.candidateId }),
      cand.user ? readOptional('onboardingState', { userId: cand.user.id }) : Promise.resolve({ ok: false, row: null }),
    ]);
    const profile = prof.row ? ProfileSchema.parse(prof.row) : null;
    const st = state.row as { stepId?: unknown; skipped?: unknown } | null;
    return {
      specialization: cand.specialization,
      fspState: cand.fspState,
      profileAvailable: prof.ok,
      profile,
      onboarding: {
        finished: journey.steps.onboarding,
        currentStep: typeof st?.stepId === 'string' ? st.stepId : null,
        skipped: Array.isArray(st?.skipped) ? st.skipped.filter((x): x is string => typeof x === 'string') : [],
      },
      steps: journey.steps,
      counts: journey.counts,
      nextStep: journey.nextStep,
      hint: STEP_HINT[journey.nextStep],
      note: 'Анкета - со слов кандидата. Категорию даёт только тест; предлагай один следующий шаг, не все сразу.',
    };
  },
};
