// lane live-slots (ADR 0008): правила слотов — лимит 2–5, длительность, окно [now+2ч, now+14д], подстатус и no_show.
import { formatMsk, isoToMskLocal, mskLocalToIso } from '@/lib/msk';
import { canCancel, deriveSubStatus, isRoomOpen, validateProposal } from '@/server/live-defense/rules';

const now = new Date('2026-10-11T12:00:00.000Z');
const at = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();

describe('validateProposal', () => {
  it('2–5 слотов, сортировка, endsAt по длительности', () => {
    const s = validateProposal({ slots: [at(5), at(3)], durationMin: 45 }, now);
    expect(s.map((x) => x.startsAt.toISOString())).toEqual([at(3), at(5)]);
    expect(s[0]!.endsAt.getTime() - s[0]!.startsAt.getTime()).toBe(45 * 60_000);
  });
  it('лимит: 1 и 6 слотов — slot_count', () => {
    expect(() => validateProposal({ slots: [at(3)], durationMin: 30 }, now)).toThrow(expect.objectContaining({ code: 'slot_count' }));
    expect(() => validateProposal({ slots: [3, 4, 5, 6, 7, 8].map(at), durationMin: 30 }, now)).toThrow(expect.objectContaining({ code: 'slot_count' }));
    expect(validateProposal({ slots: [3, 4, 5, 6, 7].map(at), durationMin: 30 }, now)).toHaveLength(5);
  });
  it('длительность только 30/45', () => {
    expect(() => validateProposal({ slots: [at(3), at(4)], durationMin: 60 }, now)).toThrow(expect.objectContaining({ code: 'slot_duration' }));
  });
  it('окно: раньше чем через 2 часа и позже 14 дней — slot_window; границы включены', () => {
    expect(() => validateProposal({ slots: [at(1.9), at(4)], durationMin: 30 }, now)).toThrow(expect.objectContaining({ code: 'slot_window' }));
    expect(() => validateProposal({ slots: [at(3), at(14 * 24 + 1)], durationMin: 30 }, now)).toThrow(expect.objectContaining({ code: 'slot_window' }));
    expect(validateProposal({ slots: [at(2), at(14 * 24)], durationMin: 30 }, now)).toHaveLength(2);
  });
  it('пересекающиеся слоты и мусор — 400', () => {
    expect(() => validateProposal({ slots: [at(3), at(3.5)], durationMin: 45 }, now)).toThrow(expect.objectContaining({ code: 'slot_overlap' }));
    expect(() => validateProposal({ slots: ['nope', at(4)], durationMin: 30 }, now)).toThrow(expect.objectContaining({ code: 'slot_invalid' }));
  });
});

describe('комната, отмена, подстатус', () => {
  const startsAt = new Date(at(1));
  it('комната открывается за 10 минут', () => {
    expect(isRoomOpen(startsAt, new Date(startsAt.getTime() - 11 * 60_000))).toBe(false);
    expect(isRoomOpen(startsAt, new Date(startsAt.getTime() - 10 * 60_000))).toBe(true);
  });
  it('отмена — не позднее чем за 1 час', () => {
    expect(canCancel(startsAt, new Date(startsAt.getTime() - 61 * 60_000))).toBe(true);
    expect(canCancel(startsAt, new Date(startsAt.getTime() - 59 * 60_000))).toBe(false);
  });
  it('no_show при опоздании >15 минут у не пришедшей стороны; done по завершённой сессии', () => {
    const late = new Date(startsAt.getTime() + 16 * 60_000);
    const base = { status: 'scheduled' as const, startsAt };
    expect(deriveSubStatus({ ...base, call: { status: 'pending', startedAt: now }, employerJoinedAt: null }, new Date(startsAt.getTime() + 5 * 60_000))).toEqual({ status: 'scheduled', noShow: [] });
    expect(deriveSubStatus({ ...base, call: { status: 'pending', startedAt: now }, employerJoinedAt: startsAt }, late)).toEqual({ status: 'no_show', noShow: ['candidate'] });
    expect(deriveSubStatus({ ...base, call: { status: 'active', startedAt: startsAt }, employerJoinedAt: null }, late)).toEqual({ status: 'no_show', noShow: ['employer'] });
    expect(deriveSubStatus({ ...base, call: { status: 'finished', startedAt: startsAt }, employerJoinedAt: startsAt }, late)).toEqual({ status: 'done', noShow: [] });
    expect(deriveSubStatus({ status: 'cancelled', startsAt, call: null, employerJoinedAt: null }, late)).toEqual({ status: 'cancelled', noShow: [] });
  });
});

describe('МСК', () => {
  it('datetime-local по МСК ↔ UTC', () => {
    expect(mskLocalToIso('2026-10-12T14:30')).toBe('2026-10-12T11:30:00.000Z');
    expect(isoToMskLocal('2026-10-12T11:30:00.000Z')).toBe('2026-10-12T14:30');
    expect(formatMsk('2026-10-12T11:30:00.000Z')).toContain('14:30 МСК');
    expect(mskLocalToIso('bad')).toBeNull();
  });
});
