// Видео с камеры в созвоне с Кирой (kind=qualifying): тот же механизм хранения, что в комнате интервью
// (<CALL_DATA_DIR>/calls/<id>/video), тот же доступ (работодателю – после принятого приглашения с раскрытием Г5),
// удаление при отзыве Г2 и по сроку хранения вместе с аудио; без действующего Г2 видео не принимается.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fsp-call-video-test-${process.pid}`;
  process.env.CALL_DATA_DIR = dir;
  process.env.STT_PROVIDER = 'browser';
  return dir;
});

import { GET as videoGet, POST as videoPost } from '@/app/api/call/[id]/video/route';
import { GET as viewRoute } from '@/app/api/call/[id]/route';
import { POST as consentRoute } from '@/app/api/call/consent/route';
import { POST as startRoute } from '@/app/api/call/start/route';
import { DELETE as revokeRoute } from '@/app/api/consents/[kind]/route';
import { CALL_RECORDING_CONSENT_VERSION, type CallView } from '@/server/call';
import { purgeExpiredRecordings } from '@/server/consent/recordings';
import { resetEnvCache } from '@/server/env';
import { clearStubResponses } from '@/server/llm/providers/stub';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';
import { discloseAccepted, grantConsents } from '../../helpers/consents';

const A = 'cand-a';
const cookieA = () => `cid=${signUserSession({ userId: 'user-a', role: 'candidate', candidateId: A })}`;
const cookieEmp = () => `cid=${signUserSession({ userId: 'user-emp', role: 'employer', employerProfileId: 'ep-1' })}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed() {
  await prisma.candidate.create({ data: { id: A, email: 'a@example.test', name: 'А', specialization: 'backend' } });
  await prisma.user.create({ data: { id: 'user-a', role: 'candidate', name: 'А', candidateId: A } });
  await prisma.candidateProfile.create({ data: { candidateId: A, claimedGrade: 'junior' } });
  await grantConsents('user-a', ['ai_assessment']); // Г3 (ADR 0005): созвон оценивает ИИ
  await prisma.claimCatalog.createMany({
    data: [
      { id: 'be.sql-indexes', specialization: 'backend', statement: 'Подбирает индексы под запросы', grades: ['junior', 'middle'], weight: 3, proof: [], markers: [], limits: '' },
      { id: 'be.idempotency', specialization: 'backend', statement: 'Проектирует идемпотентные операции', grades: ['middle'], weight: 2, proof: [], markers: [], limits: '' },
    ],
  });
  await prisma.claim.createMany({
    data: [
      { id: 'cl-1', candidateId: A, catalogId: 'be.sql-indexes', statement: 'Ускорял запросы индексами', level: 'self_reported', quote: 'оптимизировал медленные отчёты индексами', sourceRef: 'cv#1', sourceKind: 'resume', limits: '', suggestedProof: [], status: 'confirmed' },
      { id: 'cl-2', candidateId: A, catalogId: 'be.idempotency', statement: 'Делал идемпотентные платежи', level: 'artifact', quote: 'повтор платежа без дублей', sourceRef: 'cv#2', sourceKind: 'resume', limits: '', suggestedProof: [], status: 'confirmed' },
    ],
  });
  await prisma.company.create({ data: { id: 'co-1', name: 'Компания' } });
  await prisma.user.create({ data: { id: 'user-emp', role: 'employer', name: 'Р' } });
  await prisma.employerProfile.create({ data: { id: 'ep-1', userId: 'user-emp', companyId: 'co-1' } });
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const revokeConsent = (kind: string) => {
  const req = jsonRequest(`/api/consents/${kind}`, 'DELETE', undefined, cookieA());
  req.headers.set('origin', 'http://localhost');
  return revokeRoute(req, { params: Promise.resolve({ kind }) });
};
const BODY = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 7, 8, 9]);
const upload = (id: string, startMs = 1500) =>
  videoPost(new Request(`http://localhost/api/call/${id}/video?startMs=${startMs}`, { method: 'POST', headers: { cookie: cookieA(), 'content-type': 'video/webm' }, body: BODY }), ctx(id));
const fetchSeg = (id: string, seg: string, cookie: string) => videoGet(new Request(`http://localhost/api/call/${id}/video?segment=${seg}`, { headers: { cookie } }), ctx(id));
const videoDir = (id: string) => path.join(dataDir, 'calls', id, 'video');

async function startQualifying(): Promise<string> {
  await consentRoute(jsonRequest('/api/call/consent', 'POST', { version: CALL_RECORDING_CONSENT_VERSION }, cookieA()));
  const s = await startRoute(jsonRequest('/api/call/start', 'POST', { kind: 'qualifying' }, cookieA()));
  expect(s.status).toBe(201);
  const started = await json<{ sessionId: string; call: CallView }>(s);
  expect(started.call.kind).toBe('qualifying');
  return started.sessionId;
}

beforeAll(() => resetEnvCache());
beforeEach(async () => {
  await resetDb();
  clearStubResponses();
  rmSync(dataDir, { recursive: true, force: true });
  await seed();
});
afterAll(async () => {
  rmSync(dataDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe('видео в созвоне с Кирой (qualifying)', () => {
  it('хранится файлом рядом с аудио; кандидату – всегда, работодателю – только после принятого приглашения с раскрытием', async () => {
    const id = await startQualifying();
    const up = await upload(id);
    expect(up.status).toBe(201);
    const seg = await json<{ name: string; startMs: number }>(up);
    expect(seg).toEqual({ name: '000-1500.webm', startMs: 1500 });
    expect(existsSync(path.join(videoDir(id), seg.name))).toBe(true);
    // audioPath помечает созвон с файлами: по нему работают отзыв Г2 и очистка по сроку.
    expect((await prisma.callSession.findUniqueOrThrow({ where: { id } })).audioPath).toBe(`calls/${id}`);

    const mine = await fetchSeg(id, seg.name, cookieA());
    expect(mine.status).toBe(200);
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(BODY);

    expect((await fetchSeg(id, seg.name, cookieEmp())).status).toBe(403);
    expect((await json<CallView>(await viewRoute(jsonRequest(`/api/call/${id}`, 'GET', undefined, cookieEmp()), ctx(id)))).videoSegments).toEqual([]);

    // Принятое приглашение без раскрытия (Г5) доступа не открывает.
    await prisma.invitation.create({ data: { id: 'inv-v', companyId: 'co-1', employerProfileId: 'ep-1', candidateId: A, salaryFrom: 1, salaryTo: 2, status: 'accepted' } });
    expect((await fetchSeg(id, seg.name, cookieEmp())).status).toBe(403);
    await discloseAccepted();
    const emp = await fetchSeg(id, seg.name, cookieEmp());
    expect(emp.status).toBe(200);
    expect((await json<CallView>(await viewRoute(jsonRequest(`/api/call/${id}`, 'GET', undefined, cookieEmp()), ctx(id)))).videoSegments).toEqual([seg]);
  });

  it('отзыв согласия на запись (Г2) удаляет видео вместе с аудио; новые сегменты после отзыва – 409', async () => {
    const id = await startQualifying();
    expect((await upload(id)).status).toBe(201);
    expect(existsSync(videoDir(id))).toBe(true);
    expect((await revokeConsent('call_recording')).status).toBe(200);
    expect(existsSync(path.join(dataDir, 'calls', id))).toBe(false);
    expect((await prisma.callSession.findUniqueOrThrow({ where: { id } })).audioPath).toBeNull();
    const again = await upload(id, 60_000);
    expect(again.status).toBe(409);
    expect((await json<{ error: { code: string } }>(again)).error.code).toBe('call_recording_off');
    expect(existsSync(videoDir(id))).toBe(false);
  });

  it('очистка по сроку хранения удаляет видео завершённого созвона (даже без аудио)', async () => {
    const id = await startQualifying();
    expect((await upload(id)).status).toBe(201);
    await prisma.callSession.update({ where: { id }, data: { status: 'finished', startedAt: new Date(Date.now() - 100 * 86400_000) } });
    expect(await purgeExpiredRecordings(new Date(), 90)).toBe(1);
    expect(existsSync(path.join(dataDir, 'calls', id))).toBe(false);
  });
});
