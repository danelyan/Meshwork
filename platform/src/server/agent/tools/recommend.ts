import { z } from 'zod';

import { SPECIALIZATIONS } from '@/lib/directions';
import { explainInvitation, gapMap, recommendTargets, recommendTasks, recommendTest } from '@/server/recommend';
import type { AgentTool } from '../types';
import { EmptyInput } from './shared';

const Level = z.enum(['self_reported', 'artifact', 'platform', 'third_party']);
const GapSchema = z.object({
  id: z.string(),
  catalogId: z.string(),
  statement: z.string(),
  weight: z.number(),
  currentLevel: Level.nullable(),
  priority: z.number(),
  suggestedProof: z.array(z.string()),
});

const GapInput = z.object({
  target: z.object({
    kind: z.enum(['category', 'vacancy']).describe('category — «backend:middle»-подобный id категории; vacancy — id вакансии'),
    id: z.string().min(1).max(64),
  }),
});
export const getGapMap: AgentTool<z.infer<typeof GapInput>, { gaps: z.infer<typeof GapSchema>[] }> = {
  name: 'get_gap_map',
  description: 'Карта пробелов к цели: утверждения, нужные категории или вакансии и ещё не доказанные на уровне platform, по приоритету. Вызывай, когда цель известна (категория вида «backend:middle» или id вакансии из recommend_targets) и кандидат спрашивает, чего не хватает. Если цели нет — сначала спроси её через ask_user.',
  input: GapInput,
  output: z.object({ gaps: z.array(GapSchema) }),
  async handler(ctx, { target }) {
    const gaps = await gapMap(ctx.candidateId, target);
    return { gaps };
  },
};

const TestOutput = z.object({
  specialization: z.enum(SPECIALIZATIONS),
  grade: z.enum(['junior', 'middle']),
  reason: z.string(),
  allowed: z.boolean(),
  nextAllowedAt: z.string().optional(),
  note: z.string(),
});
export const recommendTestTool: AgentTool<Record<string, never>, z.infer<typeof TestOutput>> = {
  name: 'recommend_test',
  description:
    'Какой тест предложить (специализация и грейд) и почему, по подтверждённым утверждениям. Вызывай, когда кандидат выбирает тест после подтверждения карточек; если нужен и статус теста — вызывай get_test_status (в нём эта рекомендация уже есть), не оба. Это выбор теста, не категория: категорию даёт только сам тест. allowed=false — смена грейда пока закрыта (лимит платформы), назови дату.',
  input: EmptyInput,
  output: TestOutput,
  async handler(ctx) {
    const r = await recommendTest(ctx.candidateId);
    ctx.emit({ type: 'recommendations', items: [{ kind: 'test', ...r }] });
    return { ...r, note: 'Категорию присваивает только тест; это предложение, кандидат выбирает сам.' };
  },
};

const TaskSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  family: z.string(),
  grade: z.enum(['junior', 'middle']),
  closes: z.array(z.string()),
  reason: z.string(),
});
const TasksInput = z.object({
  gapIds: z.array(z.string().min(1).max(64)).min(1).max(10).describe('catalogId пробелов из get_gap_map'),
  limit: z.number().int().min(1).max(5).default(3),
});
export const recommendTasksTool: AgentTool<z.infer<typeof TasksInput>, { tasks: z.infer<typeof TaskSchema>[] }> = {
  name: 'recommend_tasks',
  description: 'Задания из банка платформы на указанные пробелы (детерминированно). Вызывай после get_gap_map с catalogId пробелов. Других заданий, курсов и ресурсов не предлагай.',
  input: TasksInput,
  output: z.object({ tasks: z.array(TaskSchema) }),
  async handler(ctx, { gapIds, limit }) {
    const tasks = await recommendTasks(ctx.candidateId, gapIds, limit);
    ctx.emit({ type: 'recommendations', items: tasks.map((t) => ({ kind: 'task', ...t })) });
    return { tasks };
  },
};

const TargetSchema = z.object({
  vacancyId: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  title: z.string(),
  specialization: z.enum(SPECIALIZATIONS),
  grade: z.enum(['junior', 'middle']),
  salaryFrom: z.number(),
  salaryTo: z.number(),
  covered: z.number(),
  total: z.number(),
  missing: z.array(z.object({ catalogId: z.string(), statement: z.string() })),
  reason: z.string(),
});
const TargetsInput = z.object({ limit: z.number().int().min(1).max(5).default(3) });
export const recommendTargetsTool: AgentTool<z.infer<typeof TargetsInput>, { targets: z.infer<typeof TargetSchema>[]; note: string }> = {
  name: 'recommend_targets',
  description:
    'Вакансии и компании платформы, где профиль кандидата ближе всего к потребности (тот же матчер, что у работодателя): «закрываешь k из n, не хватает …». Вызывай, когда у кандидата есть подтверждённые утверждения и он спрашивает о вакансиях, цели или «что дальше». Без подтверждённых карточек сначала попроси их подтвердить. Зарплаты — по вакансиям платформы, не рынок.',
  input: TargetsInput,
  output: z.object({ targets: z.array(TargetSchema), note: z.string() }),
  async handler(ctx, { limit }) {
    const targets = await recommendTargets(ctx.candidateId, limit);
    ctx.emit({ type: 'recommendations', items: targets.map((t) => ({ kind: 'target', ...t })) });
    return { targets, note: 'Это покрытие потребности по вакансиям платформы, не вероятность приглашения.' };
  },
};

const CoverageOutput = z.object({
  invitationId: z.string(),
  vacancyId: z.string(),
  items: z.array(z.object({ catalogId: z.string(), statement: z.string(), weight: z.number(), level: Level.nullable(), credit: z.number() })),
  score: z.number(),
  covered: z.number(),
  total: z.number(),
  explanation: z.string(),
  note: z.string(),
});
const InvitationInput = z.object({ invitationId: z.string().min(1).max(64) });
export const explainInvitationTool: AgentTool<z.infer<typeof InvitationInput>, z.infer<typeof CoverageOutput>> = {
  name: 'explain_invitation',
  description:
    'Объяснить одно приглашение работодателя: что из потребности закрыто доказательствами, что только со слов, чем это рискует на интервью. Вызывай с invitationId из get_invitations. Принять или отклонить — кнопка кандидата, не твоя.',
  input: InvitationInput,
  output: CoverageOutput,
  async handler(ctx, { invitationId }) {
    const c = await explainInvitation(ctx.candidateId, invitationId);
    return { ...c, note: 'Решение по приглашению принимает кандидат кнопкой в интерфейсе.' };
  },
};
