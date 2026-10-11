import { loadMemoryBlock } from '@/server/consultant/memory';
import { prisma } from '@/server/db';
import { loadEmployerContext } from '@/server/employer';
import { getSetting } from '@/server/admin/settings';
import { errors } from '@/server/errors';
import { getLlm } from '@/server/llm/client';
import { pauseMark } from '@/server/onboarding/match';
import { type OnboardingStepBrief, pausedOnboardingOf } from '@/server/onboarding/service';
import { LlmError, type ChatMessage, type ToolCall } from '@/server/llm/types';

import { BudgetExceededError } from '../budget';
import { isDemoMode } from '../demo-reply';
import { dispatchToolCall } from '../dispatch';
import { EXTERNAL_NOTE } from '../external';
import { buildHistory, fitHistory, HISTORY_TOTAL_MAX_CHARS } from '../history';
import { EMPTY_REPLY, TURN_MAX_TOKENS } from '../loop';
import { toolSpecs } from '../spec';
import { withWebSearchGate } from '../web-search/tool';
import { withQuestionReminder } from '../reminder';
import { MAX_TOOL_CALLS_PER_TURN } from '../types';

import { runScriptedTurn } from './demo';
import { EMPLOYER_PROMPT } from './prompt';
import { assertEmployerBudget, ensureEmployerPromptVersion, saveEmployerMessage } from './store';
import { createReplyStream } from '../reply-stream';
import { employerTools } from './tools';
import type { EmployerTool } from './tools/shared';
import type { EmployerAgentEvent, EmployerToolContext, EmployerTurnInput } from './types';

export interface EmployerTurnOptions {
  llm?: import('@/server/llm/types').LlmProvider;
  tools?: EmployerTool[];
  dailyTokenBudget?: number;
  now?: () => Date;
}

/** Помощник недоступен (модель, бюджет) — шаг в ленте перед ответом по данным платформы. */
export const EMPLOYER_FALLBACK_STEP = 'Помощник сейчас без языковой модели - отвечаю по данным платформы.';

const MSK = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'Europe/Moscow' });

/**
 * Знакомство на паузе («Настроить позже», решение владельца 10.10): работодатель говорит с помощником
 * свободно, шаги не завершены. Помощник отвечает по делу и один раз за разговор напоминает про возврат.
 */
export const EMPLOYER_RESUME_BUTTON = 'Вернуться к знакомству';
export function employerPauseNote(step: OnboardingStepBrief): string {
  return `Знакомство работодателя не закончено и стоит на паузе (остановился на шаге «${step.question}»). Отвечай на вопросы как обычно. Если в этом разговоре ты ещё не напоминал — в конце ответа одной фразой предложи продолжить знакомство здесь же, в ленте: кнопка «${EMPLOYER_RESUME_BUTTON}» вверху. Ссылок на другие страницы не давай. Уже напоминал — не повторяй.`;
}

export function buildEmployerSystem(args: { now: Date; companyName: string; toolsExhausted: boolean; paused?: OnboardingStepBrief | null; memory?: string | null }): string {
  const parts = [EMPLOYER_PROMPT.trim(), `## Контекст хода\nСегодня ${MSK.format(args.now)} (МСК). Компания работодателя: ${args.companyName}.`, EXTERNAL_NOTE];
  if (args.memory) parts.push(args.memory);
  if (args.paused) parts.push(employerPauseNote(args.paused));
  if (args.toolsExhausted) parts.push('Лимит вызовов инструментов на этот ход исчерпан — ответь работодателю текстом по тому, что уже есть.');
  return parts.join('\n\n');
}

/**
 * Один ход помощника работодателя. Тот же каркас, что у консультанта (loop.ts): короткий
 * цикл, лимит MAX_TOOL_CALLS_PER_TURN, история с ужатием, общий dispatch. Отличия: свой
 * реестр инструментов и свой контекст (компания из EmployerProfile), свои таблицы
 * разговоров, без конвейера вложений. Демо без модели и план В — один и тот же
 * скриптовый ход (demo.ts) на тех же инструментах.
 */
export async function runEmployerTurn(
  input: EmployerTurnInput,
  emit: (e: EmployerAgentEvent) => void,
  signal?: AbortSignal,
  opts: EmployerTurnOptions = {},
): Promise<void> {
  const { employerProfileId, conversationId } = input;
  const conv = await prisma.employerConversation.findFirst({ where: { id: conversationId, employerProfileId }, select: { id: true } });
  if (!conv) throw errors.notFound('Разговор не найден');
  const emp = await loadEmployerContext(employerProfileId);

  const now = opts.now ?? (() => new Date());
  const budget = opts.dailyTokenBudget ?? (await getSetting('llm.dailyTokenBudget'));
  const demo = !opts.llm && isDemoMode();
  const llm = opts.llm ?? getLlm({ conversationId, onQueue: (position) => emit({ type: 'queue', position }) });
  const registry = withWebSearchGate(opts.tools ?? employerTools);
  const ctx: EmployerToolContext = { employerProfileId, companyId: emp.companyId, conversationId, emit, llm, ...(signal ? { signal } : {}) };

  await ensureEmployerPromptVersion(conversationId);
  // Знакомство на паузе: реплика помечается шагом паузы - лента покажет её под этим шагом (restore.ts).
  const owner = await prisma.employerProfile.findUnique({ where: { id: employerProfileId }, select: { userId: true } });
  const paused = owner ? await pausedOnboardingOf(owner.userId).catch(() => null) : null;
  await saveEmployerMessage(conversationId, { role: 'user', content: paused ? `${input.text.trim()}\n${pauseMark(paused.stepId)}` : input.text.trim() });
  if (signal?.aborted) return;

  if (demo) {
    await scripted(ctx, registry, input.text, paused);
    return;
  }

  const rows = await prisma.employerMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true, toolCalls: true, toolCallId: true },
  });
  const messages: ChatMessage[] = buildHistory(rows);
  const specs = toolSpecs(registry);
  const memory = await loadMemoryBlock({ employerProfileId });
  let calls = 0;
  let historyChars = HISTORY_TOTAL_MAX_CHARS;
  const reply = createReplyStream(emit, signal);

  try {
    for (;;) {
      if (signal?.aborted) return;
      await assertEmployerBudget(employerProfileId, budget, now());
      const canCall = calls < MAX_TOOL_CALLS_PER_TURN;
      let res;
      try {
        res = await llm.complete(
          {
            purpose: 'employer_assistant',
            system: buildEmployerSystem({ now: now(), companyName: emp.companyName, toolsExhausted: !canCall, paused, memory }),
            messages: withQuestionReminder(fitHistory(messages, historyChars), input.text),
            tools: specs,
            toolChoice: canCall ? 'auto' : 'none',
            maxTokens: TURN_MAX_TOKENS,
            temperature: 0.3,
            onDelta: reply.onDelta,
          },
          signal,
        );
      } catch (err) {
        if (err instanceof LlmError && err.code === 'context_length' && historyChars === HISTORY_TOTAL_MAX_CHARS) {
          historyChars = Math.floor(HISTORY_TOTAL_MAX_CHARS / 3);
          continue;
        }
        throw err;
      }

      const requested = res.kind === 'tool_calls' ? (res.toolCalls ?? []) : [];
      if (canCall && requested.length) {
        reply.discard();
        const batch: ToolCall[] = requested.slice(0, MAX_TOOL_CALLS_PER_TURN - calls);
        const assistant: ChatMessage = { role: 'assistant', content: res.text ?? '', toolCalls: batch };
        messages.push(assistant);
        await saveEmployerMessage(conversationId, assistant);
        let terminal = false;
        for (const call of batch) {
          calls++;
          const r = await dispatchToolCall(registry, ctx, call);
          const toolMsg: ChatMessage = { role: 'tool', content: r.content, toolCallId: call.id };
          messages.push(toolMsg);
          await saveEmployerMessage(conversationId, toolMsg);
          if (r.terminal) terminal = true;
          if (signal?.aborted) return;
        }
        if (terminal) return;
        continue;
      }

      const text = (res.text ?? '').trim() || EMPTY_REPLY;
      await saveEmployerMessage(conversationId, { role: 'assistant', content: text });
      await reply.finish(text);
      return;
    }
  } catch (err) {
    reply.discard();
    if (signal?.aborted || (err instanceof LlmError && err.code === 'aborted')) return;
    if (err instanceof BudgetExceededError || err instanceof LlmError) {
      emit({ type: 'step', text: EMPLOYER_FALLBACK_STEP });
      await scripted(ctx, registry, input.text, paused);
      return;
    }
    throw err;
  }
}

/** Напоминание без модели (демо, план В): знакомство на паузе - один раз за разговор, как resumeLine кандидата. */
export const EMPLOYER_RESUME_MARK = 'Знакомство ещё не закончено';

async function scripted(ctx: EmployerToolContext, registry: EmployerTool[], text: string, paused: OnboardingStepBrief | null) {
  let reply = await runScriptedTurn(ctx, registry, text);
  if (!reply) return;
  if (paused) {
    const reminded = await prisma.employerMessage.count({ where: { conversationId: ctx.conversationId, role: 'assistant', content: { contains: EMPLOYER_RESUME_MARK } } });
    if (!reminded) reply = `${reply}\n${EMPLOYER_RESUME_MARK} - продолжим здесь же: кнопка «${EMPLOYER_RESUME_BUTTON}» вверху ленты.`;
  }
  await saveEmployerMessage(ctx.conversationId, { role: 'assistant', content: reply });
  await createReplyStream(ctx.emit, ctx.signal).finish(reply);
}
