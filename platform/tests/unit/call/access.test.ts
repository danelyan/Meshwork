import { vi } from 'vitest';

const db = vi.hoisted(() => ({
  employerProfile: { findUnique: vi.fn() },
  invitation: { findMany: vi.fn() },
  consent: { findMany: vi.fn() },
  callParticipant: { count: vi.fn() },
  candidate: { findUnique: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import { eventForAccess, publicVerdict, resolveCallAccess } from '@/server/call/access';
import type { CallVerdict } from '@/server/call/types';

const call = { id: 'call-1', candidateId: 'cand-1' };
const employer = { role: 'employer' as const, userId: 'u-emp', employerProfileId: 'ep-1' };

beforeEach(() => {
  vi.resetAllMocks();
  db.employerProfile.findUnique.mockResolvedValue({ companyId: 'co-1' });
  db.candidate.findUnique.mockResolvedValue({ hiddenFromEmployers: false });
  db.callParticipant.count.mockResolvedValue(0);
  db.consent.findMany.mockResolvedValue([]);
});

/** Принятые приглашения компании; раскрытие (Г5, ADR 0005) — по `disclosed`. */
const accepted = (n: number, disclosed = true) => {
  const invs = Array.from({ length: n }, (_, i) => ({ id: `inv-${i}`, candidateId: 'cand-1' }));
  db.invitation.findMany.mockResolvedValue(invs);
  db.consent.findMany.mockResolvedValue(disclosed ? invs.map((i) => ({ context: { invitationId: i.id } })) : []);
};

describe('гейт записи созвона для работодателя (R-C-16, ADR 0003 п. 4)', () => {
  it('кандидату — свой созвон и запись всегда; чужой — 404', async () => {
    await expect(resolveCallAccess({ role: 'candidate', candidateId: 'cand-1' }, call)).resolves.toEqual({ role: 'candidate', access: 'full', recording: true });
    await expect(resolveCallAccess({ role: 'candidate', candidateId: 'cand-2' }, call)).rejects.toMatchObject({ status: 404 });
  });

  it('без принятого приглашения — только оценки, без записи', async () => {
    accepted(0);
    await expect(resolveCallAccess(employer, call)).resolves.toEqual({ role: 'employer', access: 'summary', recording: false });
    expect(db.invitation.findMany).toHaveBeenCalledWith({ where: { companyId: 'co-1', candidateId: { in: ['cand-1'] }, status: 'accepted' }, select: { id: true, candidateId: true } });
  });

  it('accepted, но раскрытие отозвано (Г5) — снова только оценки', async () => {
    accepted(1, false);
    await expect(resolveCallAccess(employer, call)).resolves.toEqual({ role: 'employer', access: 'summary', recording: false });
  });

  it('после accepted — транскрипт и запись', async () => {
    accepted(1);
    await expect(resolveCallAccess(employer, call)).resolves.toEqual({ role: 'employer', access: 'full', recording: true });
  });

  it('участник комнаты без раскрытия: пока созвон идёт — транскрипт без записи; после завершения — только оценки', async () => {
    accepted(0);
    db.callParticipant.count.mockResolvedValue(1);
    await expect(resolveCallAccess(employer, { ...call, status: 'active' })).resolves.toEqual({ role: 'employer', access: 'full', recording: false });
    await expect(resolveCallAccess(employer, { ...call, status: 'finished' })).resolves.toEqual({ role: 'employer', access: 'summary', recording: false });
    await expect(resolveCallAccess(employer, call)).resolves.toEqual({ role: 'employer', access: 'summary', recording: false });
  });

  it('скрытый кандидат без accepted — 404', async () => {
    accepted(0);
    db.candidate.findUnique.mockResolvedValue({ hiddenFromEmployers: true });
    await expect(resolveCallAccess(employer, call)).rejects.toMatchObject({ status: 404 });
  });

  it('публичный вердикт без цитат и формулировок кандидата', () => {
    const v: CallVerdict = {
      kind: 'qualifying',
      depthMap: [
        { topic: 'Индексы', catalogId: 'be.idx', claimed: true, claimStatement: 'Моя формулировка', probed: 2, maxLevel: 3, confirmed: true, status: 'confirmed', scores: { depth: 2, why: 2, boundary: 1, completion: 1 }, total: 6, quote: 'дословно кандидат', runs: [] },
      ],
      runs: 3,
      validRuns: 3,
      upgradedCatalogIds: ['be.idx'],
      summary: 's',
      evaluatedAt: '2026-10-10T00:00:00.000Z',
      thresholdVersion: 'v',
      disclaimer: 'd',
    };
    const json = JSON.stringify(publicVerdict(v));
    expect(json).not.toContain('дословно кандидат');
    expect(json).not.toContain('Моя формулировка');
    expect(json).toContain('"total":6');

    // SSE для summary-зрителя: вердикт уходит публичным, полный — только при full.
    const ev = { type: 'verdict' as const, verdict: v };
    const pub = JSON.stringify(eventForAccess(ev, 'summary'));
    expect(pub).not.toContain('дословно кандидат');
    expect(pub).toContain('"total":6');
    expect(eventForAccess(ev, 'full')).toBe(ev);
  });

  it('SSE summary-зрителю: только status, participant, verdict', () => {
    const entry = { index: 1, role: 'candidate' as const, text: 'ответ кандидата', at: '2026-10-10T00:00:00.000Z', tMs: 10 };
    const hidden = [
      { type: 'utterance' as const, entry },
      { type: 'ai_state' as const, state: 'thinking' as const },
      { type: 'mute' as const, aiMuted: true, userId: 'u' },
      { type: 'question' as const, questionId: 'q', status: 'queued' as const },
      { type: 'signal' as const, from: 'u', payload: { sdp: 'x' } },
      { type: 'error' as const, code: 'llm_unavailable', message: 'm' },
    ];
    for (const ev of hidden) {
      expect(eventForAccess(ev, 'summary')).toBeNull();
      expect(eventForAccess(ev, 'full')).toBe(ev);
    }
    const status = { type: 'status' as const, status: 'finished' as const };
    const joined = { type: 'participant' as const, userId: 'u', role: 'employer' as const, action: 'joined' as const };
    expect(eventForAccess(status, 'summary')).toBe(status);
    expect(eventForAccess(joined, 'summary')).toBe(joined);
  });
});
