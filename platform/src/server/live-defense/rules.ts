// Правила слотов живой защиты (ADR 0008, «Назначение живой защиты: слоты»). Чистые функции – без БД.
import { AppError } from '../errors';

export const LIVE_SLOT_RULES = {
  minSlots: 2,
  maxSlots: 5,
  durations: [30, 45] as const,
  /** Не раньше чем через 2 часа от текущего момента. */
  minLeadMs: 2 * 60 * 60 * 1000,
  /** Не позже 14 дней. */
  maxAheadMs: 14 * 24 * 60 * 60 * 1000,
  maxCommentChars: 300,
  /** Комната открывается за 10 минут до начала. */
  roomOpensBeforeMs: 10 * 60 * 1000,
  /** Опоздание больше 15 минут – no_show. */
  noShowAfterMs: 15 * 60 * 1000,
  /** Отмена – не позднее чем за 1 час. */
  cancelBeforeMs: 60 * 60 * 1000,
  minReasonChars: 3,
  maxReasonChars: 300,
} as const;

export type LiveDefenseSubStatus = 'slots_proposed' | 'scheduled' | 'done' | 'cancelled' | 'no_show';
export type LiveActor = 'candidate' | 'employer';

export interface SlotRange {
  startsAt: Date;
  endsAt: Date;
}

/** Проверить предложение: 2–5 слотов, 30/45 мин, окно [now+2ч, now+14д], слоты не пересекаются. Возвращает слоты по возрастанию. */
export function validateProposal(input: { slots: string[]; durationMin: number }, now: Date): SlotRange[] {
  const R = LIVE_SLOT_RULES;
  if (!(R.durations as readonly number[]).includes(input.durationMin)) {
    throw new AppError('slot_duration', 'Длительность защиты - 30 или 45 минут', 400);
  }
  if (input.slots.length < R.minSlots || input.slots.length > R.maxSlots) {
    throw new AppError('slot_count', `Предложите от ${R.minSlots} до ${R.maxSlots} слотов`, 400);
  }
  const ms = input.durationMin * 60_000;
  const out = input.slots.map((s) => {
    const startsAt = new Date(s);
    if (Number.isNaN(startsAt.getTime())) throw new AppError('slot_invalid', 'Некорректное время слота', 400);
    // Минуты без секунд: время слота человек выбирает по часам.
    startsAt.setUTCSeconds(0, 0);
    if (startsAt.getTime() < now.getTime() + R.minLeadMs) throw new AppError('slot_window', 'Слот - не раньше чем через 2 часа от текущего момента', 400);
    if (startsAt.getTime() > now.getTime() + R.maxAheadMs) throw new AppError('slot_window', 'Слот - не позже чем через 14 дней', 400);
    return { startsAt, endsAt: new Date(startsAt.getTime() + ms) };
  });
  out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (let i = 1; i < out.length; i++) {
    if (overlaps(out[i - 1]!, out[i]!)) throw new AppError('slot_overlap', 'Слоты пересекаются - разведите их по времени', 400);
  }
  return out;
}

export function overlaps(a: SlotRange, b: SlotRange): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export function roomOpensAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() - LIVE_SLOT_RULES.roomOpensBeforeMs);
}

export function isRoomOpen(startsAt: Date, now: Date): boolean {
  return now >= roomOpensAt(startsAt);
}

/** Отмена разрешена не позднее чем за 1 час до начала. */
export function canCancel(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() - now.getTime() >= LIVE_SLOT_RULES.cancelBeforeMs;
}

export interface DeriveInput {
  status: LiveDefenseSubStatus;
  startsAt: Date | null;
  /** Сессия живой защиты: статус и когда кандидат начал (pending → active). */
  call: { status: 'active' | 'finished' | 'cancelled' | 'pending'; startedAt: Date } | null;
  /** Когда работодатель компании впервые вошёл в комнату; null – не входил. */
  employerJoinedAt: Date | null;
}

/**
 * Подстатус при чтении (без крона): scheduled → done, когда сессия защиты завершена;
 * опоздание больше 15 минут – флаг no_show у не пришедшей стороны.
 */
export function deriveSubStatus(d: DeriveInput, now: Date): { status: LiveDefenseSubStatus; noShow: LiveActor[] } {
  if (d.status !== 'scheduled' || !d.startsAt) return { status: d.status, noShow: [] };
  const deadline = new Date(d.startsAt.getTime() + LIVE_SLOT_RULES.noShowAfterMs);
  const noShow: LiveActor[] = [];
  const candidateCame = !!d.call && d.call.status !== 'pending' && d.call.status !== 'cancelled' && d.call.startedAt <= deadline;
  const employerCame = !!d.employerJoinedAt && d.employerJoinedAt <= deadline;
  if (now > deadline) {
    if (!candidateCame) noShow.push('candidate');
    if (!employerCame) noShow.push('employer');
  }
  if (d.call?.status === 'finished') return { status: 'done', noShow };
  if (noShow.length) return { status: 'no_show', noShow };
  return { status: 'scheduled', noShow };
}
