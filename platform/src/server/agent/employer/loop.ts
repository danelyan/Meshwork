import { prisma } from '@/server/db';
import { loadEmployerContext } from '@/server/employer';
import { getEnv } from '@/server/env';
import { errors } from '@/server/errors';
import { getLlm } from '@/server/llm/client';
import { LlmError, type ChatMessage, type ToolCall } from '@/server/llm/types';

import { BudgetExceededError } from '../budget';
import { isDemoMode } from '../demo-reply';
import { dispatchToolCall } from '../dispatch';
import { EXTERNAL_NOTE } from '../external';
import { buildHistory, fitHistory, HISTORY_TOTAL_MAX_CHARS } from '../history';
import { EMPTY_REPLY, TURN_MAX_TOKENS } from '../loop';
import { toolSpecs } from '../spec';
import { MAX_TOOL_CALLS_PER_TURN } from '../types';

import { runScriptedTurn } from './demo';
import { EMPLOYER_PROMPT } from './prompt';
import { assertEmployerBudget, ensureEmployerPromptVersion, saveEmployerMessage } from './store';
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
export const EMPLOYER_FALLBACK_STEP = 'Помощник сейчас без языковой модели — отвечаю по данным платформы.';

const MSK = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'Europe/Moscow' });

export function buildEmployerSystem(args: { now: Date; companyName: string; toolsExhausted: boolean }): string {
  const parts = [EMPLOYER_PROMPT.trim(), `## Контекст хода\nСегодня ${MSK.format(args.now)} (МСК). Компания работодателя: ${args.companyName}.`, EXTERNAL_NOTE];
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
  const budget = opts.dailyTokenBudget ?? getEnv().LLM_DAILY_TOKEN_BUDGET;
  const demo = !opts.llm && isDemoMode();
  const llm = opts.llm ?? getLlm({ conversationId, onQueue: (position) => emit({ type: 'queue', position }) });
  const registry = opts.tools ?? employerTools;
  const ctx: EmployerToolContext = { employerProfileId, companyId: emp.companyId, conversationId, emit, llm, ...(signal ? { signal } : {}) };

  await ensureEmployerPromptVersion(conversationId);
  await saveEmployerMessage(conversationId, { role: 'user', content: input.text.trim() });
  if (signal?.aborted) return;

  if (demo) {
    await scripted(ctx, registry, input.text);
    return;
  }

  const rows = await prisma.employerMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true, toolCalls: true, toolCallId: true },
  });
  const messages: ChatMessage[] = buildHistory(rows);
  const specs = toolSpecs(registry);
  let calls = 0;
  let historyChars = HISTORY_TOTAL_MAX_CHARS;

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
            system: buildEmployerSystem({ now: now(), companyName: emp.companyName, toolsExhausted: !canCall }),
            messages: fitHistory(messages, historyChars),
            tools: specs,
            toolChoice: canCall ? 'auto' : 'none',
            maxTokens: TURN_MAX_TOKENS,
            temperature: 0.3,
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
      emit({ type: 'message', text });
      return;
    }
  } catch (err) {
    if (signal?.aborted || (err instanceof LlmError && err.code === 'aborted')) return;
    if (err instanceof BudgetExceededError || err instanceof LlmError) {
      emit({ type: 'step', text: EMPLOYER_FALLBACK_STEP });
      await scripted(ctx, registry, input.text);
      return;
    }
    throw err;
  }
}

async function scripted(ctx: EmployerToolContext, registry: EmployerTool[], text: string) {
  const reply = await runScriptedTurn(ctx, registry, text);
  if (!reply) return;
  await saveEmployerMessage(ctx.conversationId, { role: 'assistant', content: reply });
  ctx.emit({ type: 'message', text: reply });
}
