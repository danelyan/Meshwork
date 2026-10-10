import { vi } from 'vitest';

const db = vi.hoisted(() => ({
  employerProfile: { findUnique: vi.fn() },
  invitation: { count: vi.fn() },
  callParticipant: { count: vi.fn() },
  candidate: { findUnique: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import { publicVerdict, resolveCallAccess } from '@/server/call/access';
import type { CallVerdict } from '@/server/call/types';

const call = { id: 'call-1', candidateId: 'cand-1' };
const employer = { role: 'employer' as const, userId: 'u-emp', employerProfileId: 'ep-1' };

beforeEach(() => {
  vi.resetAllMocks();
  db.employerProfile.findUnique.mockResolvedValue({ companyId: 'co-1' });
  db.candidate.findUnique.mockResolvedValue({ hiddenFromEmployers: false });
  db.callParticipant.count.mockResolvedValue(0);
});

describe('гейт записи созвона для работодателя (R-C-16, ADR 0003 п. 4)', () => {
  it('кандидату — свой созвон и запись всегда; чужой — 404', async () => {
    await expect(resolveCallAccess({ role: 'candidate', candidateId: 'cand-1' }, call)).resolves.toEqual({ role: 'candidate', access: 'full', recording: true });
    await expect(resolveCallAccess({ role: 'candidate', candidateId: 'cand-2' }, call)).rejects.toMatchObject({ status: 404 });
  });

  it('без принятого приглашения — только оценки, без записи', async () => {
    db.invitation.count.mockResolvedValue(0);
    await expect(resolveCallAccess(employer, call)).resolves.toEqual({ role: 'employer', access: 'summary', recording: false });
    expect(db.invitation.count).toHaveBeenCalledWith({ where: { companyId: 'co-1', candidateId: 'cand-1', status: 'accepted' } });
  });

  it('после accepted — транскрипт и запись', async () => {
    db.invitation.count.mockResolvedValue(1);
    await expect(resolveCallAccess(employer, call)).resolves.toEqual({ role: 'employer', access: 'full', recording: true });
  });

  it('участник комнаты без accepted — транскрипт, но не запись', async () => {
    db.invitation.count.mockResolvedValue(0);
    db.callParticipant.count.mockResolvedValue(1);
    await expect(resolveCallAccess(employer, call)).resolves.toEqual({ role: 'employer', access: 'full', recording: false });
  });

  it('скрытый кандидат без accepted — 404', async () => {
    db.invitation.count.mockResolvedValue(0);
    db.candidate.findUnique.mockResolvedValue({ hiddenFromEmployers: true });
    await expect(resolveCallAccess(employer, call)).rejects.toMatchObject({ status: 404 });
  });

  it('публичный вердикт без цитат и формулировок кандидата', () => {
    const v: CallVerdict = {
      kind: 'qualifying',
      depthMap: [
        { topic: 'Индексы', catalogId: 'be.idx', claimed: true, claimStatement: 'Моя формулировка', probed: 2, maxLevel: 3, confirmed: true, scores: { depth: 2, why: 2, boundary: 1, completion: 1 }, total: 6, quote: 'дословно кандидат', runs: [] },
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
  });
});
