import { vi } from 'vitest';

// ИИ-защита до приглашения (ADR 0008 п. 1): границы доступа работодателя и запуск кандидатом.
const db = vi.hoisted(() => ({
  projectSubmission: { findUnique: vi.fn() },
  callSession: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  invitation: { findMany: vi.fn() },
  consent: { findMany: vi.fn() },
  employerProfile: { findUnique: vi.fn() },
  callParticipant: { count: vi.fn() },
  candidate: { findUnique: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));
const start = vi.hoisted(() => vi.fn());
vi.mock('@/server/defense-room/session', () => ({ startDefenseRoom: start }));

import { resolveCallAccess } from '@/server/call/access';
import { getEmployerAiDefense, publicAiDefenseVerdict, startAiDefense } from '@/server/defense-room/ai-defense';
import type { DefenseRoomVerdict } from '@/server/defense-room/types';
import type { LlmProvider } from '@/server/llm/types';

const verdict: DefenseRoomVerdict = {
  scores: { depth: 2, why: 1, boundary: 1, completion: 2 },
  total: 6,
  totalMean: 5.5,
  items: [
    {
      itemId: 'q1',
      source: 'qlc',
      type: 'why',
      ref: 'src/secret-name.ts:L1-L9',
      label: 'почему так · src/secret-name.ts:L1-L9',
      question: 'Почему Иван Петров выбрал этот кэш?',
      scores: { depth: 2, why: 1, boundary: 1, completion: 2 },
      total: 6,
      passed: true,
      runs: [6, 6, 5],
      agreement: { same: 3, of: 3 },
      answers: 2,
      quote: 'меня зовут Иван',
    },
  ],
  passed: true,
  runs: [6, 6, 5],
  flags: ['uneven_understanding'],
  summary: 'Цитата кандидата: «меня зовут Иван»',
  quotes: ['меня зовут Иван'],
  projectScore: 0.9,
  answered: 4,
  employerQuestions: { asked: 0, answered: 0 },
  thresholdVersion: 'v',
  evaluatedAt: '2026-10-11T10:00:00.000Z',
};

const transcript = [{ index: 0, role: 'candidate', text: 'меня зовут Иван', at: '2026-10-11T10:00:00.000Z', tMs: 0 }];
const session = { id: 'cs-ai', status: 'finished', verdictJson: verdict, finishedAt: new Date('2026-10-11T10:05:00Z'), audioPath: 'calls/cs-ai', transcriptJson: transcript, projectSubmissionId: 'sub-1' };
const submission = (over: Partial<{ companyId: string; hidden: boolean }> = {}) => ({
  id: 'sub-1',
  candidateId: 'cand-1',
  repoUrl: 'https://github.com/ivan-petrov/project',
  candidate: { name: 'Иван Петров', hiddenFromEmployers: over.hidden ?? false },
  projectTask: { vacancy: { companyId: over.companyId ?? 'co-1' } },
});
const accepted = (yes: boolean) => {
  const invs = yes ? [{ id: 'inv-1', candidateId: 'cand-1' }] : [];
  db.invitation.findMany.mockResolvedValue(invs);
  db.consent.findMany.mockResolvedValue(invs.map((i) => ({ context: { invitationId: i.id } })));
};

beforeEach(() => {
  vi.resetAllMocks();
  db.callSession.findMany.mockResolvedValue([session]);
  db.consent.findMany.mockResolvedValue([]);
});

describe('вердикт ИИ-защиты для работодателя', () => {
  it('до accepted — псевдоним, баллы и флаги; без транскрипта, записи, repoUrl и текста кандидата', async () => {
    db.projectSubmission.findUnique.mockResolvedValue(submission());
    accepted(false);
    const v = await getEmployerAiDefense('co-1', 'sub-1');
    expect(v.disclosed).toBe(false);
    expect(v.candidate.displayName).not.toContain('Иван');
    expect(v.aiDefense?.verdict).toMatchObject({ total: 6, totalMean: 5.5, passed: true, flags: ['uneven_understanding'] });
    expect(v).not.toHaveProperty('transcript');
    expect(v).not.toHaveProperty('hasRecording');
    expect(v).not.toHaveProperty('sessionId');
    expect(v).not.toHaveProperty('repoUrl');
    const json = JSON.stringify(v);
    for (const leak of ['Иван', 'ivan-petrov', 'secret-name', 'cs-ai', 'calls/']) expect(json).not.toContain(leak);
  });

  it('после accepted с раскрытием — транскрипт, запись и репозиторий', async () => {
    db.projectSubmission.findUnique.mockResolvedValue(submission());
    accepted(true);
    const v = await getEmployerAiDefense('co-1', 'sub-1');
    expect(v).toMatchObject({ disclosed: true, candidate: { displayName: 'Иван Петров' }, sessionId: 'cs-ai', hasRecording: true, repoUrl: 'https://github.com/ivan-petrov/project' });
    expect(v.transcript).toEqual(transcript);
  });

  it('сдача вакансии чужой компании — 404', async () => {
    db.projectSubmission.findUnique.mockResolvedValue(submission({ companyId: 'co-2' }));
    accepted(true);
    await expect(getEmployerAiDefense('co-1', 'sub-1')).rejects.toMatchObject({ status: 404 });
  });

  it('скрытый кандидат — 404, даже при accepted', async () => {
    db.projectSubmission.findUnique.mockResolvedValue(submission({ hidden: true }));
    accepted(true);
    await expect(getEmployerAiDefense('co-1', 'sub-1')).rejects.toMatchObject({ status: 404 });
  });

  it('несуществующая сдача — 404', async () => {
    db.projectSubmission.findUnique.mockResolvedValue(null);
    await expect(getEmployerAiDefense('co-1', 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('публичный вердикт — без формулировок вопросов, мест в коде, цитат и summary', () => {
    const p = publicAiDefenseVerdict(verdict);
    expect(p.items).toEqual([{ type: 'why', label: 'почему так', total: 6, passed: true }]);
    expect(p).not.toHaveProperty('quotes');
    expect(p).not.toHaveProperty('summary');
    expect(p.notes).toHaveLength(1);
  });
});

describe('созвон-защита через /api/call/{id} до accepted', () => {
  const employer = { role: 'employer' as const, userId: 'u-emp', employerProfileId: 'ep-1' };
  it('kind=defense без раскрытия — 404 (не карта глубины, не запись); после accepted — полный доступ', async () => {
    db.employerProfile.findUnique.mockResolvedValue({ companyId: 'co-1' });
    db.callParticipant.count.mockResolvedValue(0);
    db.callSession.count.mockResolvedValue(1);
    db.candidate.findUnique.mockResolvedValue({ hiddenFromEmployers: false });
    accepted(false);
    await expect(resolveCallAccess(employer, { id: 'cs-ai', candidateId: 'cand-1', status: 'finished', kind: 'defense' })).rejects.toMatchObject({ status: 404 });
    accepted(true);
    db.callSession.count.mockResolvedValue(1);
    await expect(resolveCallAccess(employer, { id: 'cs-ai', candidateId: 'cand-1', status: 'finished', kind: 'defense' })).resolves.toEqual({ role: 'employer', access: 'full', recording: true });
  });

  it('accepted не открывает запись живой защиты другой компании', async () => {
    db.employerProfile.findUnique.mockResolvedValue({ companyId: 'co-1' });
    accepted(true);
    db.callSession.count.mockResolvedValue(0);
    await expect(resolveCallAccess(employer, { id: 'cs-foreign', candidateId: 'cand-1', status: 'finished', kind: 'defense' })).rejects.toMatchObject({ status: 404 });
    expect(db.callSession.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'cs-foreign' }) }));
  });
});

describe('запуск ИИ-защиты кандидатом', () => {
  const llm = {} as LlmProvider;
  const sub = (over: Partial<{ candidateId: string; status: string; isDemo: boolean }> = {}) => ({
    candidateId: over.candidateId ?? 'cand-1',
    status: over.status ?? 'checked',
    candidate: { isDemo: over.isDemo ?? false },
  });

  it('свой проверенный сабмит — старт с ai: true', async () => {
    db.projectSubmission.findUnique.mockResolvedValue(sub());
    db.callSession.findFirst.mockResolvedValue(null);
    start.mockResolvedValue({ sessionId: 'cs-new', resumed: false });
    await expect(startAiDefense('cand-1', 'sub-1', llm)).resolves.toMatchObject({ sessionId: 'cs-new' });
    expect(start).toHaveBeenCalledWith('cand-1', { mode: 'project', projectSubmissionId: 'sub-1', ai: true }, llm, {});
  });

  it('чужой сабмит — 404; не проверенный — 409', async () => {
    db.projectSubmission.findUnique.mockResolvedValue(sub({ candidateId: 'cand-2' }));
    await expect(startAiDefense('cand-1', 'sub-1', llm)).rejects.toMatchObject({ status: 404 });
    db.projectSubmission.findUnique.mockResolvedValue(sub({ status: 'running' }));
    await expect(startAiDefense('cand-1', 'sub-1', llm)).rejects.toMatchObject({ status: 409 });
    expect(start).not.toHaveBeenCalled();
  });

  it('второй запуск за сутки — 429; демо-кандидата не ограничиваем', async () => {
    db.projectSubmission.findUnique.mockResolvedValue(sub());
    db.callSession.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ startedAt: new Date(Date.now() - 60_000) });
    await expect(startAiDefense('cand-1', 'sub-1', llm)).rejects.toMatchObject({ status: 429, code: 'ai_defense_limit' });
    expect(start).not.toHaveBeenCalled();

    db.projectSubmission.findUnique.mockResolvedValue(sub({ isDemo: true }));
    db.callSession.findFirst.mockResolvedValue(null);
    start.mockResolvedValue({ sessionId: 'cs-demo', resumed: false });
    await expect(startAiDefense('cand-1', 'sub-1', llm)).resolves.toMatchObject({ sessionId: 'cs-demo' });
  });

  it('идущая ИИ-защита возобновляется без проверки лимита', async () => {
    db.projectSubmission.findUnique.mockResolvedValue(sub());
    db.callSession.findFirst.mockResolvedValueOnce({ id: 'cs-active' });
    start.mockResolvedValue({ sessionId: 'cs-active', resumed: true });
    await expect(startAiDefense('cand-1', 'sub-1', llm)).resolves.toMatchObject({ resumed: true });
    expect(db.callSession.findFirst).toHaveBeenCalledTimes(1);
  });
});
