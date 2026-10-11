import { z } from 'zod';

import { encodeSse } from '@/server/agent/events';
import { registerTurn } from '@/server/agent/active-turns';
import { acquireConversationLock, LOCK_MAX_HOLD_MS } from '@/server/agent/lock';
import { runTurn } from '@/server/agent/loop';
import type { AgentEvent } from '@/server/agent/types';
import { memoryExtractionEnabled, scheduleMemoryExtraction } from '@/server/consultant/memory';
import { prisma } from '@/server/db';
import { getLlm } from '@/server/llm/client';
import { AppError, errors, withErrors } from '@/server/errors';
import { asideContext, type OnboardingStepBrief } from '@/server/onboarding/service';
import { getSession, requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Комментарий SSE `: ping` — пока ход идёт (парсер lib/sse.ts строки без `data:` игнорирует). */
const HEARTBEAT_MS = 15_000;

const Body = z
  .object({
    conversationId: z.string().min(1).max(64).optional(),
    text: z.string().max(8_000).default(''),
    uploadIds: z.array(z.string().min(1).max(64)).max(10).optional(),
    urls: z.array(z.url().max(2_048)).max(10).optional(),
    /** Свободный вопрос посреди онбординга: id шага, на котором человек (сервер сверяет со своим). */
    onboardingStep: z.string().regex(/^[A-Za-z]{1,40}$/).optional(),
  })
  .refine((b) => b.text.trim().length > 0 || b.uploadIds?.length || b.urls?.length, {
    message: 'Нужен текст, вложение или ссылка',
    path: ['text'],
  });

/**
 * Ход консультанта: POST → SSE-поток событий AgentEvent (`data: {...}\n\n`),
 * заканчивается `done`. Один ход на разговор одновременно — иначе 409 `busy`.
 * Паттерн ReadableStream в Route Handler — docs Next.js «Streaming».
 *
 * Разрыв соединения (`request.signal`: F5, закрытие вкладки, потеря сети) ход НЕ прерывает:
 * реплика дописывается и сохраняется, после перезагрузки её покажет история (AI SDK
 * «chatbot-resume-streams»: disconnect ≠ stop). Lock держится до конца хода — повторная отправка
 * получает 409 `busy`. Останавливает ход только `POST …/messages/stop` (реестр active-turns)
 * или таймаут хода. Пока ход идёт — `: ping` раз в 15 с (прокси не рвут «немое» соединение).
 */
export const POST = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const body = Body.parse(await req.json().catch(() => ({})));

  // Граница доверия: из онбординга в модель — только после согласия и выбора роли «специалист».
  // Шаг берём сервером (клиент мог отстать); человек уже на итоге — обычный ход консультанта.
  let onboarding: OnboardingStepBrief | undefined;
  if (body.onboardingStep) {
    const userId = getSession(req)?.userId;
    if (!userId) throw errors.forbidden('Вопросы посреди знакомства доступны после входа');
    const aside = await asideContext(userId);
    if (!aside.consent || aside.role !== 'candidate') throw errors.conflict('Сначала дай согласие и выбери роль');
    onboarding = aside.step ?? undefined;
  }

  let conversationId: string;
  if (body.conversationId) {
    const conv = await prisma.conversation.findFirst({ where: { id: body.conversationId, candidateId }, select: { id: true } });
    if (!conv) throw errors.notFound('Разговор не найден');
    conversationId = conv.id;
  } else {
    const conv = await prisma.conversation.create({
      data: { candidateId, title: body.text.trim().slice(0, 80) || 'Новый разговор' },
      select: { id: true },
    });
    conversationId = conv.id;
  }

  const lock = await acquireConversationLock(conversationId);
  if (!lock) throw new AppError('busy', 'Консультант ещё отвечает в этом разговоре - дождись окончания', 409);

  const encoder = new TextEncoder();
  // Ход живёт дольше соединения: свой контроллер (стоп, таймаут), не req.signal.
  const turn = new AbortController();
  const unregister = registerTurn(conversationId, turn);
  const signal = turn.signal;
  // Клиент ушёл или стоп — нарезку реплики не ждать (сохранить и отдать message сразу).
  const pace = AbortSignal.any([req.signal, signal]);
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed || req.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const emit = (e: AgentEvent) => write(encodeSse(e));
      // Брошенный ход не висит на семафоре/ретраях дольше lock.
      const turnTimer = setTimeout(() => turn.abort(new Error('turn_timeout')), LOCK_MAX_HOLD_MS - 10_000);
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      try {
        emit({ type: 'conversation', id: conversationId });
        await runTurn(
          { candidateId, conversationId, text: body.text, ...(body.uploadIds ? { uploadIds: body.uploadIds } : {}), ...(body.urls ? { urls: body.urls } : {}), ...(onboarding ? { onboarding } : {}) },
          emit,
          signal,
          { pace },
        );
        // Память: факты из реплики — фоном, после завершённого хода (ответ уже отдан); в демо и на заглушке — нет.
        if (!signal.aborted && body.text.trim() && memoryExtractionEnabled()) {
          void scheduleMemoryExtraction({ owner: { candidateId }, text: body.text, llm: getLlm({ candidateId, conversationId }) });
        }
      } catch (err) {
        if (!signal.aborted) {
          console.error('[api/consultant] turn failed', err);
          const code = err instanceof AppError ? err.code : 'internal';
          const message = err instanceof AppError ? err.message : 'Внутренняя ошибка консультанта';
          emit({ type: 'error', code, message });
        }
      } finally {
        clearTimeout(turnTimer);
        clearInterval(heartbeat);
        emit({ type: 'done' });
        unregister();
        await lock.release();
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* уже закрыт клиентом */
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Conversation-Id': conversationId,
    },
  });
});
