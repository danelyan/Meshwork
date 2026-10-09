import { z } from 'zod';

import { runEmployerTurn } from '@/server/agent/employer/loop';
import type { EmployerAgentEvent } from '@/server/agent/employer/types';
import { encodeSse } from '@/server/agent/events';
import { acquireConversationLock } from '@/server/agent/lock';
import { enrichEvent } from '@/server/agent/employer/names';
import { prisma } from '@/server/db';
import { loadEmployerContext } from '@/server/employer';
import { AppError, errors, withErrors } from '@/server/errors';
import { requireEmployer } from '@/server/session';

export const dynamic = 'force-dynamic';

const Body = z.object({
  conversationId: z.string().min(1).max(64).optional(),
  text: z.string().trim().min(1, 'Напиши сообщение').max(4_000),
});


/**
 * Ход помощника работодателя: POST → SSE-поток EmployerAgentEvent, как у консультанта
 * (app/api/consultant/messages). Только роль employer (requireEmployer: 401/403);
 * разговор — свой EmployerConversation, чужой → 404; один ход на разговор — иначе 409.
 */
export const POST = withErrors(async (req: Request) => {
  const { employerProfileId } = requireEmployer(req);
  const body = Body.parse(await req.json().catch(() => ({})));

  let conversationId: string;
  if (body.conversationId) {
    const conv = await prisma.employerConversation.findFirst({ where: { id: body.conversationId, employerProfileId }, select: { id: true } });
    if (!conv) throw errors.notFound('Разговор не найден');
    conversationId = conv.id;
  } else {
    const conv = await prisma.employerConversation.create({ data: { employerProfileId, title: body.text.slice(0, 80) }, select: { id: true } });
    conversationId = conv.id;
  }

  const { companyId } = await loadEmployerContext(employerProfileId);
  const lock = await acquireConversationLock(`emp:${conversationId}`);
  if (!lock) throw new AppError('busy', 'Помощник ещё отвечает в этом разговоре — дождись окончания', 409);

  const encoder = new TextEncoder();
  const signal = req.signal;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: EmployerAgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(e)));
        } catch {
          closed = true;
        }
      };
      // Имя принявшего добавляется к карточке только здесь, на пути к клиенту: инструменты
      // и история модели его не видят. Очередь сохраняет порядок событий.
      let chain: Promise<void> = Promise.resolve();
      const emit = (e: EmployerAgentEvent) => {
        chain = chain.then(async () => {
          try {
            send(await enrichEvent(companyId, e));
          } catch {
            send(e); // без имени: карточка с псевдонимом безопаснее потерянной
          }
        });
      };
      try {
        emit({ type: 'conversation', id: conversationId });
        await runEmployerTurn({ employerProfileId, conversationId, text: body.text }, emit, signal);
      } catch (err) {
        if (!signal.aborted) {
          console.error('[api/employer/assistant] turn failed', err);
          const code = err instanceof AppError ? err.code : 'internal';
          const message = err instanceof AppError ? err.message : 'Внутренняя ошибка помощника';
          emit({ type: 'error', code, message });
        }
      } finally {
        emit({ type: 'done' });
        await chain;
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
