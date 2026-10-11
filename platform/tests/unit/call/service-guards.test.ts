import { beforeEach, describe, expect, it, vi } from 'vitest';

// Сервис созвона (аудит 11.10): видео только с согласием на запись, список без видов без драйвера,
// projectSubmissionId — только у защиты. Без БД и файлов: prisma, согласие и запись сегментов подменены.
const db = vi.hoisted(() => ({
  callSession: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn() },
  callParticipant: { findMany: vi.fn(), count: vi.fn() },
  candidate: { findUnique: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));
const mode = vi.hoisted(() => vi.fn());
vi.mock('@/server/call/consent', () => ({ callRecordingMode: mode, CALL_RECORDING_CONSENT_VERSION: 'test-v1' }));
const video = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn() }));
vi.mock('@/server/call/video', () => ({ saveVideoSegment: video.save, listVideoSegments: video.list, readVideoSegment: vi.fn() }));
vi.mock('@/server/call/audio', async (orig) => ({
  ...(await orig<typeof import('@/server/call/audio')>()),
  listSegments: async () => [],
  callAudioDir: (id: string) => ({ rel: `calls/${id}`, abs: `/nonexistent/calls/${id}` }),
}));
const removeSegment = vi.hoisted(() => vi.fn());
vi.mock('@/server/consent/recordings', () => ({ removeSegment }));
vi.mock('@/server/consent/service', async (orig) => ({ ...(await orig<typeof import('@/server/consent/service')>()), assertAiAssessmentConsent: vi.fn() }));

import { registerCallDriver, type CallDriver } from '@/server/call/drivers';
import type { StartCallBody } from '@/server/call/schemas';
import { addVideo, listCalls, recordTurnTelemetry, startCall } from '@/server/call/service';
import type { LlmProvider } from '@/server/llm/types';

const row = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  candidateId: 'c1',
  kind: 'qualifying',
  projectSubmissionId: null,
  status: 'active',
  startedAt: new Date('2026-10-11T10:00:00Z'),
  finishedAt: null,
  transcriptJson: [],
  audioPath: null,
  verdictJson: null,
  policyVersion: 'test-v1',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mode.mockReset();
  db.callParticipant.findMany.mockResolvedValue([]);
  db.callParticipant.count.mockResolvedValue(0);
  video.list.mockResolvedValue([]);
});

describe('addVideo: согласие на запись (Г2)', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  beforeEach(() => {
    db.callSession.findUnique.mockResolvedValue(row());
    video.save.mockResolvedValue({ name: '000-0.webm', startMs: 0 });
  });

  it('согласие отозвано (text) или не дано (ask) — 409 call_recording_off, сегмент не сохраняется', async () => {
    for (const m of ['text', 'ask']) {
      mode.mockResolvedValue(m);
      await expect(addVideo('c1', 's1', bytes, 0)).rejects.toMatchObject({ code: 'call_recording_off', status: 409 });
    }
    expect(video.save).not.toHaveBeenCalled();
    expect(db.callSession.update).not.toHaveBeenCalled();
  });

  it('согласие действует — сегмент сохраняется, audioPath проставляется', async () => {
    mode.mockResolvedValue('audio');
    await expect(addVideo('c1', 's1', bytes, 0)).resolves.toEqual({ name: '000-0.webm', startMs: 0 });
    expect(video.save).toHaveBeenCalledTimes(1);
    expect(db.callSession.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { audioPath: 'calls/s1' } });
    expect(removeSegment).not.toHaveBeenCalled();
  });

  it('отзыв пришёлся между проверкой и записью — свой сегмент удаляется, 409', async () => {
    mode.mockResolvedValueOnce('audio').mockResolvedValue('text');
    await expect(addVideo('c1', 's1', bytes, 0)).rejects.toMatchObject({ code: 'call_recording_off', status: 409 });
    expect(removeSegment).toHaveBeenCalledWith('s1', 'video/000-0.webm');
  });
});

describe('listCalls: строки вида без драйвера (защита проекта)', () => {
  const rows = [row({ id: 'd1', kind: 'defense', projectSubmissionId: 'sub1' }), row({ id: 'q1', kind: 'qualifying', status: 'finished', finishedAt: new Date('2026-10-11T10:20:00Z') })];
  beforeEach(() => {
    // Как Postgres: фильтр по kind — строкой или { in: [...] }; без фильтра — все строки кандидата.
    db.callSession.findMany.mockImplementation(async ({ where }: { where: { kind?: string | { in: string[] } } }) =>
      rows.filter((r) => (where.kind === undefined ? true : typeof where.kind === 'string' ? r.kind === where.kind : where.kind.in.includes(r.kind))),
    );
  });

  it('kind=defense при ожидающей строке защиты — пустой список, а не 501', async () => {
    await expect(listCalls('c1', 'defense')).resolves.toEqual([]);
  });

  it('без kind: строка защиты в список не попадает и его не ломает', async () => {
    const calls = await listCalls('c1');
    expect(calls.map((c) => c.id)).toEqual(['q1']);
  });

  it('kind=qualifying — как раньше', async () => {
    const calls = await listCalls('c1', 'qualifying');
    expect(calls.map((c) => [c.id, c.kind, c.status])).toEqual([['q1', 'qualifying', 'finished']]);
  });
});

describe('startCall: projectSubmissionId', () => {
  it('interview с projectSubmissionId — 400, строка созвона не создаётся', async () => {
    registerCallDriver({ kind: 'interview', limits: { minQuestions: 1, maxQuestions: 2 }, nextQuestion: vi.fn(), evaluate: vi.fn() } as unknown as CallDriver);
    mode.mockResolvedValue('audio');
    const body: StartCallBody = { kind: 'interview', projectSubmissionId: 'not-mine' };
    await expect(startCall('c1', body, {} as LlmProvider)).rejects.toMatchObject({ code: 'bad_request', status: 400 });
    expect(db.callSession.create).not.toHaveBeenCalled();
  });
});

describe('recordTurnTelemetry: водопад из браузера дописывается в реплику ИИ', () => {
  const client = { uploadMs: 800, endToFirstDeltaMs: null, endToReplyMs: 2100, endToSoundMs: 2400, streamed: false, ackMs: 150 };
  const transcript = [
    { index: 0, role: 'ai', text: 'Привет! Что такое индекс?', at: 'x', tMs: 0, timing: { llmMs: 1300, firstSentenceMs: null, sentences: 0, streaming: false } },
    { index: 1, role: 'candidate', text: 'B-дерево', at: 'x', tMs: 5000, audioRef: '000.wav', timing: { sttMs: 812 } },
    { index: 2, role: 'ai', text: 'Почему именно B-дерево?', at: 'x', tMs: 7000, timing: { llmMs: 1500, firstSentenceMs: null, sentences: 0, streaming: false } },
  ];
  beforeEach(() => {
    db.callSession.findUnique.mockResolvedValue(row({ transcriptJson: transcript }));
    (db as unknown as { $transaction: unknown }).$transaction = async (fn: (tx: unknown) => unknown) => fn({ ...db, $queryRaw: async () => [] });
    db.callSession.update.mockResolvedValue(row());
  });

  it('серверный тайминг сохраняется, client — рядом; созвон уже завершён — тоже можно', async () => {
    db.callSession.findUnique.mockResolvedValue(row({ status: 'finished', transcriptJson: transcript }));
    const e = await recordTurnTelemetry('c1', 's1', { index: 2, client });
    expect(e.timing).toEqual({ llmMs: 1500, firstSentenceMs: null, sentences: 0, streaming: false, client });
    const saved = db.callSession.update.mock.calls[0]![0].data.transcriptJson as typeof transcript;
    expect(saved[2]!.timing).toEqual(e.timing);
    expect(saved[0]).toEqual(transcript[0]);
    expect(saved[1]!.timing).toEqual({ sttMs: 812 });
  });

  it('index не реплика ИИ — 404', async () => {
    await expect(recordTurnTelemetry('c1', 's1', { index: 1, client })).rejects.toMatchObject({ status: 404 });
  });
});
