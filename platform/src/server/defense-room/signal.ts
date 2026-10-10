import { prisma } from '../db';
import { AppError, errors } from '../errors';
import type { SessionPrincipal } from '../session';
import { resolveViewer } from './access';
import { CANDIDATE_PEER, isConnected, publish } from './bus';
import type { SignalPayload } from './types';

/**
 * Сигналинг WebRTC (ADR 0003): клиент шлёт SDP или ICE-кандидата POST-ом, сервер проверяет, что
 * отправитель — участник звонка, и доставляет адресату через его SSE (`signal`). Пары только
 * «кандидат ↔ работодатель»: работодатель шлёт кандидату, кандидат — конкретному работодателю
 * (`to: employer:<userId>`). Медиа идёт напрямую P2P через публичный STUN; TURN нет, поэтому за
 * симметричным NAT соединение не поднимется — клиент по таймауту ICE уходит в текстовый канал.
 */

export const SIGNAL_LIMITS = { sdpMaxChars: 20_000, candidateMaxChars: 1_000 } as const;

export async function relaySignal(
  principal: SessionPrincipal | null,
  sessionId: string,
  input: { to?: string; payload: SignalPayload },
): Promise<{ delivered: true }> {
  const { viewer, session } = await resolveViewer(principal, sessionId);
  if (session.status !== 'active') throw errors.conflict('Звонок завершён');
  const { payload } = input;
  if (!payload.description && payload.candidate === undefined) throw errors.badRequest('Нужен sdp или ice');
  if ((payload.description?.sdp?.length ?? 0) > SIGNAL_LIMITS.sdpMaxChars) throw errors.payloadTooLarge('SDP слишком большой');
  if ((payload.candidate?.candidate.length ?? 0) > SIGNAL_LIMITS.candidateMaxChars) throw errors.payloadTooLarge('ICE-кандидат слишком большой');

  let to: string;
  if (viewer.role === 'employer') {
    const joined = await prisma.callParticipant.count({ where: { callSessionId: sessionId, userId: viewer.userId, leftAt: null } });
    if (!joined) throw errors.conflict('Сначала подключись к защите');
    to = CANDIDATE_PEER;
  } else {
    const m = /^employer:([A-Za-z0-9_-]{1,64})$/.exec(input.to ?? '');
    if (!m) throw errors.badRequest('Укажи адресата: employer:<userId>');
    const joined = await prisma.callParticipant.count({ where: { callSessionId: sessionId, userId: m[1]!, leftAt: null } });
    if (!joined) throw errors.notFound('Участник не подключён');
    to = input.to!;
  }
  if (!isConnected(sessionId, to)) throw new AppError('peer_offline', 'Собеседник не на связи - остаёмся в тексте', 409);
  publish(sessionId, { type: 'signal', from: viewer.peer, to, payload });
  return { delivered: true };
}
