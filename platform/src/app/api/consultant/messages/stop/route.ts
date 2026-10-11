import { z } from 'zod';

import { stopTurn } from '@/server/agent/active-turns';
import { prisma } from '@/server/db';
import { errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

const Body = z.object({ conversationId: z.string().min(1).max(64) });

/**
 * Кнопка «Стоп»: отменить активный ход разговора. Ход сохраняет показанный кусок реплики
 * как ответ ассистента (если дельты были) и отдаёт в свой поток `message` + `done`;
 * ответ endpoint приходит после этого (не дольше 5 с). Паттерн — AI SDK «chatbot-resume-streams»
 * (отдельный stop-endpoint; разрыв соединения ход не останавливает).
 * Чужой разговор — 404; активного хода нет — 204 (стоп идемпотентен).
 */
export const POST = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const body = Body.parse(await req.json().catch(() => ({})));
  const conv = await prisma.conversation.findFirst({ where: { id: body.conversationId, candidateId }, select: { id: true } });
  if (!conv) throw errors.notFound('Разговор не найден');
  const stopped = await stopTurn(conv.id);
  return stopped ? Response.json({ stopped: true }) : new Response(null, { status: 204 });
});
