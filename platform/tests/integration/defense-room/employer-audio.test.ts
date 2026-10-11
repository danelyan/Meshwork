// ADR 0008 п. 3: запись живой защиты пишет обе стороны. Подтверждение записи работодателем при входе,
// загрузка его дорожки только своей компанией и только в свою живую защиту, доступ — как к записи защиты.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fsp-empaudio-test-${process.pid}`;
  process.env.CALL_DATA_DIR = dir;
  process.env.STT_PROVIDER = 'browser';
  return dir;
});

import { POST as candAudioRoute } from '@/app/api/call/[id]/audio/route';
import { GET as fileRoute } from '@/app/api/call/[id]/employer-audio/file/route';
import { GET as listRoute } from '@/app/api/call/[id]/employer-audio/route';
import { GET as recordingRoute } from '@/app/api/call/[id]/recording/route';
import { POST as startRoute } from '@/app/api/defense-room/start/route';
import { POST as empAudioRoute } from '@/app/api/employer/call/[id]/audio/route';
import { POST as joinRoute } from '@/app/api/employer/call/[id]/join/route';
import { POST as leaveRoute } from '@/app/api/employer/call/[id]/leave/route';
import { CALL_RECORDING_CONSENT_VERSION } from '@/server/call/consent';
import { resetBus } from '@/server/defense-room/bus';
import { EMPLOYER_RECORDING_NOTICE_VERSION } from '@/server/defense-room/employer-audio';
import { resetEnvCache } from '@/server/env';
import { clearStubResponses } from '@/server/llm/providers/stub';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';
import { discloseAccepted, grantConsents, grantEmployerConsents } from '../../helpers/consents';

const CAND = 'cand-ea';
const CAND_COOKIE = `cid=${signUserSession({ userId: 'u-cand', role: 'candidate', candidateId: CAND })}`;
const EMP_A = `cid=${signUserSession({ userId: 'u-emp-a', role: 'employer', employerProfileId: 'ep-a' })}`;
const EMP_B = `cid=${signUserSession({ userId: 'u-emp-b', role: 'employer', employerProfileId: 'ep-b' })}`;
const EMP_C = `cid=${signUserSession({ userId: 'u-emp-c', role: 'employer', employerProfileId: 'ep-c' })}`;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown, cookie: string) => jsonRequest(url, 'POST', body, cookie);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6]);

const upload = (id: string, cookie: string, startMs = 1500) =>
  empAudioRoute(new Request(`http://localhost/api/employer/call/${id}/audio?startMs=${startMs}`, { method: 'POST', headers: { cookie, 'content-type': 'audio/webm' }, body: WEBM }), params(id));
const get = (url: string, cookie: string) => new Request(`http://localhost${url}`, { headers: { cookie } });

/**
 * Кандидат принял приглашения A и B (обе раскрыты), C — только отправлено. Проект сдан под вакансию A:
 * живая защита принадлежит A, B её не видит (ADR 0008), C — без accepted.
 */
async function seed() {
  await prisma.candidate.create({ data: { id: CAND, email: 'c@example.com', name: 'Кандидат' } });
  await prisma.user.create({ data: { id: 'u-cand', name: 'Кандидат', role: 'candidate', candidateId: CAND } });
  await prisma.consent.create({ data: { userId: 'u-cand', kind: 'call_recording', version: CALL_RECORDING_CONSENT_VERSION } });
  await grantConsents('u-cand', ['ai_assessment']);
  for (const x of ['a', 'b', 'c']) {
    await prisma.company.create({ data: { id: `co-${x}`, name: `Компания ${x}` } });
    await prisma.user.create({ data: { id: `u-emp-${x}`, name: `HR ${x}`, role: 'employer' } });
    await prisma.employerProfile.create({ data: { id: `ep-${x}`, userId: `u-emp-${x}`, companyId: `co-${x}` } });
  }
  await prisma.invitation.create({ data: { candidateId: CAND, companyId: 'co-a', status: 'accepted', salaryFrom: 200000, salaryTo: 250000 } });
  await prisma.invitation.create({ data: { candidateId: CAND, companyId: 'co-b', status: 'accepted', salaryFrom: 200000, salaryTo: 250000 } });
  await prisma.invitation.create({ data: { candidateId: CAND, companyId: 'co-c', status: 'sent', salaryFrom: 200000, salaryTo: 250000 } });
  await discloseAccepted();
  await grantEmployerConsents(['u-emp-a', 'u-emp-b', 'u-emp-c']);
  await prisma.projectTemplate.create({ data: { id: 'tpl-1', subcategoryId: 'backend.integrations', specialization: 'backend', grade: 'middle', title: 'Платежи', contractMd: '#', dirRef: 'x', hiddenTestsRef: 'hidden', visibleTestsRef: 'visible', image: 'node20', timeBudgetMin: 240 } });
  await prisma.vacancy.create({ data: { id: 'vac-1', companyId: 'co-a', title: 'Backend', specialization: 'backend', grade: 'middle', salaryFrom: 200000, salaryTo: 250000, needs: [] } });
  await prisma.projectTask.create({ data: { id: 'task-1', vacancyId: 'vac-1', templateId: 'tpl-1', specialization: 'backend', grade: 'middle', specJson: {}, rubricJson: { criteria: [] } } });
  await prisma.projectSubmission.create({
    data: {
      id: 'sub-1',
      projectTaskId: 'task-1',
      candidateId: CAND,
      repoUrl: 'https://github.com/fsp-demo/payments',
      commitSha: 'd3m0c0ffee0000000000000000000000000000aa',
      status: 'checked',
      resultJson: { tests: [{ name: 't0', passed: true }] },
    },
  });
}

async function startLive(): Promise<string> {
  const res = await startRoute(post('/api/defense-room/start', { mode: 'project', projectSubmissionId: 'sub-1' }, CAND_COOKIE));
  expect(res.status).toBe(201);
  return ((await res.json()) as { sessionId: string }).sessionId;
}

describe('голос работодателя в записи живой защиты', () => {
  beforeEach(async () => {
    resetEnvCache();
    rmSync(dataDir, { recursive: true, force: true });
    await resetDb();
    resetBus();
    clearStubResponses();
    await seed();
  });
  afterAll(async () => {
    rmSync(dataDir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it('без подтверждения записи в эфир не пускает; с подтверждением — сохраняет его в участнике', async () => {
    const id = await startLive();
    const refused = await joinRoute(post('/x', {}, EMP_A), params(id));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe('recording_consent_required');
    expect((await joinRoute(post('/x', { recordingConsent: false }, EMP_A), params(id))).status).toBe(409);
    expect(await prisma.callParticipant.count({ where: { callSessionId: id } })).toBe(0);

    expect((await joinRoute(post('/x', { recordingConsent: true }, EMP_A), params(id))).status).toBe(200);
    const p = await prisma.callParticipant.findFirstOrThrow({ where: { callSessionId: id, userId: 'u-emp-a' } });
    expect(p.recordingConsentAt).toBeInstanceOf(Date);
    expect(p.recordingConsentVersion).toBe(EMPLOYER_RECORDING_NOTICE_VERSION);
  });

  it('дорожка работодателя пишется отдельно; запись кандидата не задета', async () => {
    const id = await startLive();
    await joinRoute(post('/x', { recordingConsent: true }, EMP_A), params(id));

    const up = await upload(id, EMP_A, 1500);
    expect(up.status).toBe(201);
    expect(await up.json()).toEqual({ name: '000-1500.webm', startMs: 1500 });
    expect(existsSync(path.join(dataDir, 'calls', id, 'employer', '000-1500.webm'))).toBe(true);
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id } });
    expect(row.employerAudioPath).toBe(`calls/${id}/employer`);

    // Аудио кандидата — прежним механизмом, в свою папку; в его WAV дорожка работодателя не попадает.
    const pcm = new Uint8Array(16000 * 2 * 0.5);
    const cand = await candAudioRoute(new Request(`http://localhost/api/call/${id}/audio`, { method: 'POST', headers: { cookie: CAND_COOKIE, 'content-type': 'audio/l16' }, body: pcm }), params(id));
    expect(cand.status).toBe(201);
    expect((await cand.json()).audioRef).toBe('000.wav');
    const wav = await recordingRoute(get(`/api/call/${id}/recording`, CAND_COOKIE), params(id));
    expect(wav.status).toBe(200);
    expect((await wav.arrayBuffer()).byteLength).toBe(44 + pcm.byteLength);
    expect((await prisma.callSession.findUniqueOrThrow({ where: { id } })).audioPath).toBe(`calls/${id}`);
  });

  it('загружает только своя компания и только в свою живую защиту, подключённым участником', async () => {
    const id = await startLive();
    // B принят, но живая защита по вакансии A — 404; C без accepted — 404.
    expect((await joinRoute(post('/x', { recordingConsent: true }, EMP_B), params(id))).status).toBe(404);
    expect((await upload(id, EMP_B)).status).toBe(404);
    expect((await upload(id, EMP_C)).status).toBe(404);
    // Кандидату маршрут работодателя закрыт.
    expect((await upload(id, CAND_COOKIE)).status).toBe(403);
    // A не подключён — 409.
    expect((await upload(id, EMP_A)).status).toBe(409);
    await joinRoute(post('/x', { recordingConsent: true }, EMP_A), params(id));
    expect((await upload(id, EMP_A)).status).toBe(201);
    await leaveRoute(post('/x', {}, EMP_A), params(id));
    expect((await upload(id, EMP_A)).status).toBe(409);
    expect(existsSync(path.join(dataDir, 'calls', id, 'employer'))).toBe(true);
  });

  it('участник без подтверждения записи (старый вход) — дорожка не принимается', async () => {
    const id = await startLive();
    await prisma.callParticipant.create({ data: { callSessionId: id, userId: 'u-emp-a', role: 'employer' } });
    const res = await upload(id, EMP_A);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('recording_consent_required');
    // Повторный join с подтверждением дописывает его в ту же строку участника.
    expect((await joinRoute(post('/x', { recordingConsent: true }, EMP_A), params(id))).status).toBe(200);
    expect((await upload(id, EMP_A)).status).toBe(201);
  });

  it('кандидат отозвал согласие на запись — голос работодателя тоже не пишется', async () => {
    const id = await startLive();
    await joinRoute(post('/x', { recordingConsent: true }, EMP_A), params(id));
    await prisma.consent.updateMany({ where: { userId: 'u-cand', kind: 'call_recording' }, data: { revokedAt: new Date() } });
    const res = await upload(id, EMP_A);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('call_recording_off');
    expect(existsSync(path.join(dataDir, 'calls', id, 'employer'))).toBe(false);
  });

  it('ИИ-защита: дорожки работодателя нет', async () => {
    const id = await startLive();
    await prisma.callSession.update({ where: { id }, data: { aiDefense: true } });
    expect((await upload(id, EMP_A)).status).toBe(409);
    expect((await listRoute(get(`/api/call/${id}/employer-audio`, CAND_COOKIE), params(id))).status).toBe(404);
  });

  it('доступ к дорожке — как к записи защиты: кандидат и компания-владелец с раскрытием', async () => {
    const id = await startLive();
    await joinRoute(post('/x', { recordingConsent: true }, EMP_A), params(id));
    await upload(id, EMP_A, 0);
    await prisma.callSession.update({ where: { id }, data: { status: 'finished', finishedAt: new Date() } });

    const own = await listRoute(get(`/api/call/${id}/employer-audio`, CAND_COOKIE), params(id));
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ segments: [{ name: '000-0.webm', startMs: 0 }] });
    const a = await fileRoute(get(`/api/call/${id}/employer-audio/file?segment=000-0.webm`, EMP_A), params(id));
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('audio/webm');
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(WEBM);
    expect((await fileRoute(get(`/api/call/${id}/employer-audio/file?segment=000-0.webm`, CAND_COOKIE), params(id))).status).toBe(200);

    // Чужая компания (даже с accepted) и компания без accepted — 404.
    expect((await listRoute(get(`/api/call/${id}/employer-audio`, EMP_B), params(id))).status).toBe(404);
    expect((await fileRoute(get(`/api/call/${id}/employer-audio/file?segment=000-0.webm`, EMP_C), params(id))).status).toBe(404);
    // Неверное имя сегмента — 400 (без обхода пути).
    expect((await fileRoute(get(`/api/call/${id}/employer-audio/file?segment=../x.webm`, EMP_A), params(id))).status).toBe(400);

    // Кандидат отозвал раскрытие (Г5) — запись компании закрыта, как запись кандидата.
    await prisma.consent.updateMany({ where: { kind: 'identity_disclosure' }, data: { revokedAt: new Date() } });
    const closed = await listRoute(get(`/api/call/${id}/employer-audio`, EMP_A), params(id));
    expect([403, 404]).toContain(closed.status);
    const closedCand = await recordingRoute(get(`/api/call/${id}/recording`, EMP_A), params(id));
    expect([403, 404]).toContain(closedCand.status);
  });
});
