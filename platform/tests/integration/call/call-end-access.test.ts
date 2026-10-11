// Завершение созвона с ИИ и доступ к его данным (ADR 0003 п. 4, ADR 0005 Г5, server/call/access.ts):
// что пишется в БД при finish, кто читает транскрипт, вердикт и запись — кандидат, чужой кандидат, работодатель
// до и после принятого приглашения. Покрывает qualifying (живой поток через API) и interview (строка созвона в БД).
import { rmSync } from 'node:fs';

const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fsp-call-end-access-${process.pid}`;
  process.env.CALL_DATA_DIR = dir;
  process.env.STT_PROVIDER = 'browser';
  return dir;
});

import { POST as audioRoute } from '@/app/api/call/[id]/audio/route';
import { POST as finishRoute } from '@/app/api/call/[id]/finish/route';
import { GET as recordingRoute } from '@/app/api/call/[id]/recording/route';
import { GET as viewRoute } from '@/app/api/call/[id]/route';
import { POST as turnRoute } from '@/app/api/call/[id]/turn/route';
import { GET as videoGet } from '@/app/api/call/[id]/video/route';
import { POST as consentRoute } from '@/app/api/call/consent/route';
import { GET as listRoute } from '@/app/api/call/route';
import { POST as startRoute } from '@/app/api/call/start/route';
import { CALL_RECORDING_CONSENT_VERSION, type CallVerdict, type CallView } from '@/server/call';
import { purgeExpiredRecordings } from '@/server/consent/recordings';
import { resetEnvCache } from '@/server/env';
import { clearStubResponses } from '@/server/llm/providers/stub';
import { signUserSession } from '@/server/session';

import { discloseAccepted, grantConsents } from '../../helpers/consents';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const A = 'cand-a';
const B = 'cand-b';
const cookieA = () => `cid=${signUserSession({ userId: 'user-a', role: 'candidate', candidateId: A })}`;
const cookieB = () => `cid=${signUserSession({ userId: 'user-b', role: 'candidate', candidateId: B })}`;
const cookieEmp = () => `cid=${signUserSession({ userId: 'user-emp', role: 'employer', employerProfileId: 'ep-1' })}`;
const cookieEmp2 = () => `cid=${signUserSession({ userId: 'user-emp2', role: 'employer', employerProfileId: 'ep-2' })}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (path: string, cookie?: string) => jsonRequest(path, 'GET', undefined, cookie);

const STRONG =
  'Составной индекс по status и created_at, потому что фильтр сначала по статусу, а сортировка по дате. Альтернативу с частичным индексом рассматривал, но он дороже в поддержке. Не уверен, как поведёт себя при росте в 10 раз, проверил бы нагрузкой. В итоге запрос ускорился с 2 секунд до 40 мс.';
const STRONG2 =
  'Ключ идемпотентности хранили в Postgres с уникальным индексом, потому что Redis при рестарте терял бы ключи и давал двойные списания. Думаю, при очень большом потоке упрёмся в индекс. В итоге дубли платежей ушли в ноль по логам.';

async function seed() {
  await prisma.candidate.create({ data: { id: A, email: 'a@example.test', name: 'А', specialization: 'backend' } });
  await prisma.user.create({ data: { id: 'user-a', role: 'candidate', name: 'А', candidateId: A } });
  await prisma.candidateProfile.create({ data: { candidateId: A, claimedGrade: 'junior' } });
  await grantConsents('user-a', ['ai_assessment']);
  await prisma.candidate.create({ data: { id: B, email: 'b@example.test', name: 'Б', specialization: 'backend' } });
  await prisma.user.create({ data: { id: 'user-b', role: 'candidate', name: 'Б', candidateId: B } });
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
  await prisma.company.create({ data: { id: 'co-2', name: 'Другая компания' } });
  await prisma.user.create({ data: { id: 'user-emp', role: 'employer', name: 'Р' } });
  await prisma.user.create({ data: { id: 'user-emp2', role: 'employer', name: 'Р2' } });
  await prisma.employerProfile.create({ data: { id: 'ep-1', userId: 'user-emp', companyId: 'co-1' } });
  await prisma.employerProfile.create({ data: { id: 'ep-2', userId: 'user-emp2', companyId: 'co-2' } });
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

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

/** Квалифицирующий созвон через API: согласие на запись, старт, ответ голосом + текстом, второй ответ, finish. */
async function finishedQualifyingCall(): Promise<{ id: string; view: CallView; audioBytes: number }> {
  expect((await consentRoute(jsonRequest('/api/call/consent', 'POST', { version: CALL_RECORDING_CONSENT_VERSION }, cookieA()))).status).toBe(201);
  const s = await startRoute(jsonRequest('/api/call/start', 'POST', { kind: 'qualifying' }, cookieA()));
  expect(s.status).toBe(201);
  const { sessionId: id } = await json<{ sessionId: string }>(s);
  const pcm = new Uint8Array(16_000 * 2);
  const a = await audioRoute(new Request(`http://localhost/api/call/${id}/audio`, { method: 'POST', headers: { cookie: cookieA(), 'content-type': 'audio/l16' }, body: pcm }), ctx(id));
  expect(a.status).toBe(201);
  const { audioRef } = await json<{ audioRef: string }>(a);
  expect((await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG, audioRef }, cookieA()), ctx(id))).status).toBe(200);
  expect((await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG2 }, cookieA()), ctx(id))).status).toBe(200);
  const fin = await finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieA()), ctx(id));
  expect(fin.status).toBe(200);
  return { id, view: await json<CallView>(fin), audioBytes: pcm.byteLength };
}

/** Признаки слов кандидата в ответе: цитаты, формулировки утверждений, причина разбора теста, сам текст ответа. */
function expectNoCandidateWords(body: unknown) {
  const s = JSON.stringify(body);
  expect(s).not.toContain('"quote"');
  expect(s).not.toContain('"claimStatement"');
  expect(s).not.toContain('"reason"');
  expect(s).not.toContain('Составной индекс');
  expect(s).not.toContain('Ключ идемпотентности');
}

describe('finish квалифицирующего созвона: что лежит в БД', () => {
  it('статус, время, транскрипт с таймкодами, вердикт с картой глубины, папка аудио; поля длительности и видео нет', async () => {
    const { id, view } = await finishedQualifyingCall();
    expect(view.status).toBe('finished');
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('finished');
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(row.finishedAt!.getTime()).toBeGreaterThanOrEqual(row.startedAt.getTime());
    const tr = row.transcriptJson as { role: string; text: string; tMs: number; audioRef?: string }[];
    expect(tr.filter((e) => e.role === 'candidate').map((e) => e.text)).toEqual([STRONG, STRONG2]);
    expect(tr.every((e) => typeof e.tMs === 'number')).toBe(true);
    expect(tr.find((e) => e.role === 'candidate')!.audioRef).toBe('000.wav');
    const v = row.verdictJson as unknown as CallVerdict;
    expect(v.kind).toBe('qualifying');
    expect(v.interim).toBeUndefined();
    expect(v.depthMap.length).toBeGreaterThan(0);
    expect(typeof v.summary).toBe('string');
    expect(typeof v.evaluatedAt).toBe('string');
    expect(row.audioPath).toBe(`calls/${id}`);
    // Отдельной колонки длительности и видео в схеме нет: длительность = finishedAt − startedAt,
    // видео лежит в calls/<id>/video, отмечено тем же audioPath.
    expect(Object.keys(row)).not.toContain('durationMs');
    expect(Object.keys(row)).not.toContain('videoPath');
  });
});

describe('кандидат: свой созвон', () => {
  it('GET /api/call — завершённый созвон в истории с транскриптом и вердиктом; старый созвон открывается по id', async () => {
    const { id } = await finishedQualifyingCall();
    const list = await json<{ calls: CallView[] }>(await listRoute(get('/api/call', cookieA())));
    const mine = list.calls.find((c) => c.id === id)!;
    expect(mine).toBeDefined();
    expect(mine).toMatchObject({ status: 'finished', access: 'full', hasRecording: true });
    expect(mine.transcript!.length).toBeGreaterThan(0);
    expect((mine.verdict as CallVerdict).runs).toBeGreaterThan(0);

    const one = await viewRoute(get(`/api/call/${id}`, cookieA()), ctx(id));
    expect(one.status).toBe(200);
    const v = await json<CallView>(one);
    expect(v.access).toBe('full');
    expect(JSON.stringify(v.verdict)).toContain('"quote"');
    expect((await recordingRoute(get(`/api/call/${id}/recording`, cookieA()), ctx(id))).status).toBe(200);
  });

  it('чужой кандидат — 404 на вид, запись, видео и finish; список чужих созвонов не содержит', async () => {
    const { id } = await finishedQualifyingCall();
    expect((await viewRoute(get(`/api/call/${id}`, cookieB()), ctx(id))).status).toBe(404);
    expect((await recordingRoute(get(`/api/call/${id}/recording`, cookieB()), ctx(id))).status).toBe(404);
    expect((await videoGet(get(`/api/call/${id}/video?segment=000-0.webm`, cookieB()), ctx(id))).status).toBe(404);
    expect((await finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieB()), ctx(id))).status).toBe(404);
    const listB = await json<{ calls: CallView[] }>(await listRoute(get('/api/call', cookieB())));
    expect(listB.calls.map((c) => c.id)).not.toContain(id);
  });

  it('без сессии — 401', async () => {
    const { id } = await finishedQualifyingCall();
    expect((await viewRoute(get(`/api/call/${id}`), ctx(id))).status).toBe(401);
    expect((await recordingRoute(get(`/api/call/${id}/recording`), ctx(id))).status).toBe(401);
    expect((await listRoute(get('/api/call'))).status).toBe(401);
  });
});

describe('работодатель: доступ к завершённому созвону', () => {
  const summaryOnly = async (id: string, cookie = cookieEmp()) => {
    const res = await viewRoute(get(`/api/call/${id}`, cookie), ctx(id));
    expect(res.status).toBe(200);
    const v = await json<CallView>(res);
    expect(v.access).toBe('summary');
    expect(v.transcript).toBeNull();
    expect(v.hasRecording).toBe(false);
    expect(v.videoSegments).toEqual([]);
    expect(v.verdict).not.toBeNull();
    expectNoCandidateWords(v);
    expect((await recordingRoute(get(`/api/call/${id}/recording`, cookie), ctx(id))).status).toBe(403);
    expect((await videoGet(get(`/api/call/${id}/video?segment=000-0.webm`, cookie), ctx(id))).status).toBe(403);
    return v;
  };

  it('без приглашения — только оценки по темам, без транскрипта, цитат и записи', async () => {
    const { id } = await finishedQualifyingCall();
    const v = await summaryOnly(id);
    expect((v.verdict as { depthMap: unknown[] }).depthMap.length).toBeGreaterThan(0);
  });

  it('приглашение отправлено/просмотрено, но не принято — всё ещё summary', async () => {
    const { id } = await finishedQualifyingCall();
    const inv = await prisma.invitation.create({ data: { candidateId: A, companyId: 'co-1', status: 'sent', salaryFrom: 1, salaryTo: 2 } });
    await summaryOnly(id);
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: 'viewed' } });
    await summaryOnly(id);
  });

  it('accepted без раскрытия Г5 — summary: сервер проверяет не только статус приглашения', async () => {
    const { id } = await finishedQualifyingCall();
    await prisma.invitation.create({ data: { candidateId: A, companyId: 'co-1', status: 'accepted', salaryFrom: 1, salaryTo: 2 } });
    await summaryOnly(id);
  });

  it('accepted + Г5 — транскрипт, цитаты, аудио; другой компании — по-прежнему summary', async () => {
    const { id, audioBytes } = await finishedQualifyingCall();
    await prisma.invitation.create({ data: { candidateId: A, companyId: 'co-1', status: 'accepted', salaryFrom: 1, salaryTo: 2 } });
    await discloseAccepted();
    const res = await viewRoute(get(`/api/call/${id}`, cookieEmp()), ctx(id));
    expect(res.status).toBe(200);
    const v = await json<CallView>(res);
    expect(v.access).toBe('full');
    expect(v.transcript!.filter((e) => e.role === 'candidate').map((e) => e.text)).toEqual([STRONG, STRONG2]);
    expect(v.hasRecording).toBe(true);
    expect(JSON.stringify(v.verdict)).toContain('"quote"');
    const rec = await recordingRoute(get(`/api/call/${id}/recording`, cookieEmp()), ctx(id));
    expect(rec.status).toBe(200);
    expect((await rec.arrayBuffer()).byteLength).toBe(44 + audioBytes);
    await summaryOnly(id, cookieEmp2());
  });

  it('приглашение отозвано (withdrawn) после accepted — доступ закрывается обратно до summary', async () => {
    const { id } = await finishedQualifyingCall();
    const inv = await prisma.invitation.create({ data: { candidateId: A, companyId: 'co-1', status: 'accepted', salaryFrom: 1, salaryTo: 2 } });
    await discloseAccepted();
    expect((await json<CallView>(await viewRoute(get(`/api/call/${id}`, cookieEmp()), ctx(id)))).access).toBe('full');
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: 'withdrawn' } });
    await summaryOnly(id);
  });

  it('hired тоже открывает полный доступ (вместе с Г5)', async () => {
    const { id } = await finishedQualifyingCall();
    await prisma.invitation.create({ data: { candidateId: A, companyId: 'co-1', status: 'accepted', salaryFrom: 1, salaryTo: 2 } });
    await discloseAccepted();
    await prisma.invitation.updateMany({ where: { candidateId: A }, data: { status: 'hired' } });
    expect((await json<CallView>(await viewRoute(get(`/api/call/${id}`, cookieEmp()), ctx(id)))).access).toBe('full');
  });

  it('кандидат скрыт от работодателей — 404 без accepted', async () => {
    const { id } = await finishedQualifyingCall();
    await prisma.candidate.update({ where: { id: A }, data: { hiddenFromEmployers: true } });
    expect((await viewRoute(get(`/api/call/${id}`, cookieEmp()), ctx(id))).status).toBe(404);
    expect((await recordingRoute(get(`/api/call/${id}/recording`, cookieEmp()), ctx(id))).status).toBe(404);
  });

  it('факт: GET /api/call/{id} отдаёт работодателю summary без принятых оферты и обязательства по данным (ADR 0005)', async () => {
    // В отличие от /api/employer/*, где assertEmployerConsents обязателен, здесь согласия работодателя не проверяются.
    const { id } = await finishedQualifyingCall();
    expect(await prisma.consent.count({ where: { userId: 'user-emp' } })).toBe(0);
    const res = await viewRoute(get(`/api/call/${id}`, cookieEmp()), ctx(id));
    expect(res.status).toBe(200);
    expect((await json<CallView>(res)).access).toBe('summary');
  });
});

describe('ИИнтервью (kind=interview): те же правила доступа', () => {
  async function interviewRow(): Promise<string> {
    const startedAt = new Date(Date.now() - 10 * 60_000);
    const verdict = {
      kind: 'interview',
      depthMap: [
        { topic: 'Подбирает индексы под запросы', catalogId: 'be.sql-indexes', claimed: true, claimStatement: 'Ускорял запросы индексами', probed: 1, maxLevel: 1, confirmed: true, status: 'confirmed', scores: { depth: 2, why: 2, boundary: 1, completion: 1 }, total: 6, quote: 'Составной индекс по status' },
      ],
      testOwnership: { status: 'explained', reason: 'Составной индекс объяснил сам', items: [{ templateId: 't1', title: 'Задача 1', correct: true }] },
      runs: 3,
      validRuns: 3,
      upgradedCatalogIds: [],
      summary: 'Итог',
      evaluatedAt: new Date().toISOString(),
      thresholdVersion: 'v1',
      disclaimer: 'd',
    };
    const row = await prisma.callSession.create({
      data: {
        candidateId: A,
        kind: 'interview',
        status: 'finished',
        startedAt,
        finishedAt: new Date(),
        policyVersion: CALL_RECORDING_CONSENT_VERSION,
        transcriptJson: [
          { role: 'ai', text: 'Расскажи про индексы', at: startedAt.toISOString(), tMs: 0 },
          { role: 'candidate', text: STRONG, at: startedAt.toISOString(), tMs: 5000 },
        ],
        verdictJson: verdict,
      },
    });
    return row.id;
  }

  it('кандидат — full; чужой — 404; работодатель без accepted — summary без цитат и reason; после accepted+Г5 — full', async () => {
    const id = await interviewRow();
    const own = await json<CallView>(await viewRoute(get(`/api/call/${id}`, cookieA()), ctx(id)));
    expect(own).toMatchObject({ kind: 'interview', access: 'full', status: 'finished' });
    expect(own.transcript).toHaveLength(2);
    const list = await json<{ calls: CallView[] }>(await listRoute(get('/api/call?kind=interview', cookieA())));
    expect(list.calls.map((c) => c.id)).toContain(id);

    expect((await viewRoute(get(`/api/call/${id}`, cookieB()), ctx(id))).status).toBe(404);

    const emp = await json<CallView>(await viewRoute(get(`/api/call/${id}`, cookieEmp()), ctx(id)));
    expect(emp.access).toBe('summary');
    expect(emp.transcript).toBeNull();
    expectNoCandidateWords(emp);
    expect((emp.verdict as { testOwnership?: unknown }).testOwnership).toEqual({ status: 'explained', items: [{ title: 'Задача 1' }] });

    await prisma.invitation.create({ data: { candidateId: A, companyId: 'co-1', status: 'accepted', salaryFrom: 1, salaryTo: 2 } });
    await discloseAccepted();
    const full = await json<CallView>(await viewRoute(get(`/api/call/${id}`, cookieEmp()), ctx(id)));
    expect(full.access).toBe('full');
    expect(full.transcript).toHaveLength(2);
  });
});

describe('срок хранения записи', () => {
  it('purgeExpiredRecordings: созвон старше срока теряет аудио и audioPath; транскрипт и вердикт остаются', async () => {
    const { id } = await finishedQualifyingCall();
    await prisma.callSession.update({ where: { id }, data: { startedAt: new Date(Date.now() - 91 * 24 * 3600_000) } });
    expect(await purgeExpiredRecordings(new Date(), 90)).toBe(1);
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id } });
    expect(row.audioPath).toBeNull();
    expect(row.verdictJson).not.toBeNull();
    expect((row.transcriptJson as unknown[]).length).toBeGreaterThan(0);
    expect((await recordingRoute(get(`/api/call/${id}/recording`, cookieA()), ctx(id))).status).toBe(404);
  });

  it('созвон моложе срока не трогается', async () => {
    const { id } = await finishedQualifyingCall();
    expect(await purgeExpiredRecordings(new Date(), 90)).toBe(0);
    expect((await prisma.callSession.findUniqueOrThrow({ where: { id } })).audioPath).toBe(`calls/${id}`);
  });
});
