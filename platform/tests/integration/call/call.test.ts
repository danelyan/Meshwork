import { rmSync } from 'node:fs';

const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fsp-call-test-${process.pid}`;
  process.env.CALL_DATA_DIR = dir;
  process.env.STT_PROVIDER = 'browser';
  return dir;
});

import { POST as audioRoute } from '@/app/api/call/[id]/audio/route';
import { GET as eventsRoute } from '@/app/api/call/[id]/events/route';
import { POST as finishRoute } from '@/app/api/call/[id]/finish/route';
import { GET as recordingRoute } from '@/app/api/call/[id]/recording/route';
import { GET as viewRoute } from '@/app/api/call/[id]/route';
import { POST as turnRoute } from '@/app/api/call/[id]/turn/route';
import { POST as consentRoute } from '@/app/api/call/consent/route';
import { GET as listRoute } from '@/app/api/call/route';
import { POST as startRoute } from '@/app/api/call/start/route';
import { CALL_RECORDING_CONSENT_VERSION, type CallVerdict, type CallView } from '@/server/call';
import { resetEnvCache } from '@/server/env';
import { clearStubResponses, registerStubResponse } from '@/server/llm/providers/stub';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';


const A = 'cand-a';
const cookieA = () => `cid=${signUserSession({ userId: 'user-a', role: 'candidate', candidateId: A })}`;
const cookieEmp = () => `cid=${signUserSession({ userId: 'user-emp', role: 'employer', employerProfileId: 'ep-1' })}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const STRONG =
  'Составной индекс по status и created_at, потому что фильтр сначала по статусу, а сортировка по дате. Альтернативу с частичным индексом рассматривал, но он дороже в поддержке. Не уверен, как поведёт себя при росте в 10 раз, проверил бы нагрузкой. В итоге запрос ускорился с 2 секунд до 40 мс.';
const STRONG2 =
  'Ключ идемпотентности хранили в Postgres с уникальным индексом, потому что Redis при рестарте терял бы ключи и давал двойные списания. Думаю, при очень большом потоке упрёмся в индекс. В итоге дубли платежей ушли в ноль по логам.';

async function seed() {
  await prisma.candidate.create({ data: { id: A, email: 'a@example.test', name: 'А', specialization: 'backend' } });
  await prisma.user.create({ data: { id: 'user-a', role: 'candidate', name: 'А', candidateId: A } });
  await prisma.candidateProfile.create({ data: { candidateId: A, claimedGrade: 'junior' } });
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

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
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

async function consentAndStart() {
  const c = await consentRoute(jsonRequest('/api/call/consent', 'POST', { version: CALL_RECORDING_CONSENT_VERSION }, cookieA()));
  expect(c.status).toBe(201);
  const s = await startRoute(jsonRequest('/api/call/start', 'POST', { kind: 'qualifying' }, cookieA()));
  expect(s.status).toBe(201);
  return json<{ sessionId: string; call: CallView; webrtc: { iceServers: unknown[] } }>(s);
}

describe('квалифицирующий созвон: start → 2 turn → finish → вердикт → platform (stub)', () => {
  it('без согласия на запись старт — 409 call_consent_required', async () => {
    const res = await startRoute(jsonRequest('/api/call/start', 'POST', { kind: 'qualifying' }, cookieA()));
    expect(res.status).toBe(409);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe('call_consent_required');
    const list = await json<{ consent: { given: boolean; version: string } }>(await listRoute(jsonRequest('/api/call', 'GET', undefined, cookieA())));
    expect(list.consent).toMatchObject({ given: false, version: CALL_RECORDING_CONSENT_VERSION });
  });

  it('полный сценарий', async () => {
    const started = await consentAndStart();
    const id = started.sessionId;
    expect(started.webrtc.iceServers.length).toBeGreaterThan(0);
    const first = started.call.transcript![0]!;
    expect(first.role).toBe('ai');
    expect(first.meta).toMatchObject({ topic: 'Подбирает индексы под запросы', catalogId: 'be.sql-indexes', level: 1 });
    expect(started.call.progress).toMatchObject({ awaitingAnswer: true, answered: 0, minQuestions: 4, maxQuestions: 6 });

    // повторный старт — тот же созвон
    const again = await startRoute(jsonRequest('/api/call/start', 'POST', { kind: 'qualifying' }, cookieA()));
    expect(again.status).toBe(200);
    expect((await json<{ sessionId: string }>(again)).sessionId).toBe(id);

    // ответ 1: голосом (сегмент аудио + текст из браузера) — сильный → глубже по той же теме
    const pcm = new Uint8Array(16_000 * 2); // 1 с тишины
    const audioRes = await audioRoute(new Request(`http://localhost/api/call/${id}/audio`, { method: 'POST', headers: { cookie: cookieA(), 'content-type': 'audio/l16' }, body: pcm }), ctx(id));
    expect(audioRes.status).toBe(201);
    const audio = await json<{ audioRef: string; text: string | null }>(audioRes);
    expect(audio).toEqual({ audioRef: '000.wav', text: null });
    const t1 = await json<{ ai: { meta: { level: number; topic: string; routedBy: string } }; done: boolean }>(
      await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG, audioRef: audio.audioRef }, cookieA()), ctx(id)),
    );
    expect(t1.done).toBe(false);
    expect(t1.ai.meta).toMatchObject({ topic: 'Подбирает индексы под запросы', level: 2, routedBy: 'strong' });

    // ответ 2 текстом — сильный, но два вопроса по теме: следующая тема
    const t2 = await json<{ ai: { meta: { level: number; topic: string } } }>(
      await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG2 }, cookieA()), ctx(id)),
    );
    expect(t2.ai.meta.topic).toBe('Проектирует идемпотентные операции');

    const fin = await finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieA()), ctx(id));
    expect(fin.status).toBe(200);
    const view = await json<CallView>(fin);
    expect(view.status).toBe('finished');
    const verdict = view.verdict as CallVerdict;
    expect(verdict.runs).toBe(3);
    expect(verdict.validRuns).toBe(3);
    // Вторая тема спрошена, но без ответа — «не проверено», не входит в оценку.
    expect(verdict.depthMap).toHaveLength(2);
    expect(verdict.depthMap[0]).toMatchObject({ topic: 'Подбирает индексы под запросы', catalogId: 'be.sql-indexes', claimed: true, probed: 2, maxLevel: 2, confirmed: true, status: 'confirmed' });
    expect(verdict.depthMap[1]).toMatchObject({ catalogId: 'be.idempotency', status: 'not_probed', confirmed: false, probed: 0 });
    expect(verdict.upgradedCatalogIds).toEqual(['be.sql-indexes']);
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: 'cl-1' } })).level).toBe('platform');
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: 'cl-2' } })).level).toBe('artifact');

    // транскрипт с таймкодами, аудио на диске
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id } });
    expect(row.audioPath).toBe(`calls/${id}`);
    const tr = row.transcriptJson as { role: string; tMs: number; audioRef?: string }[];
    expect(tr.map((e) => e.role)).toEqual(['ai', 'candidate', 'ai', 'candidate', 'ai']);
    expect(tr[1]!.audioRef).toBe('000.wav');
    expect(tr.every((e) => typeof e.tMs === 'number')).toBe(true);

    // повторный finish — тот же вердикт, без пересчёта
    const fin2 = await json<CallView>(await finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieA()), ctx(id)));
    expect((fin2.verdict as CallVerdict).evaluatedAt).toBe(verdict.evaluatedAt);
    // после завершения реплики не принимаются
    expect((await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: 'ещё' }, cookieA()), ctx(id))).status).toBe(409);

    // запись: кандидату — WAV; работодателю без accepted — 403 и только оценки
    const rec = await recordingRoute(jsonRequest(`/api/call/${id}/recording`, 'GET', undefined, cookieA()), ctx(id));
    expect(rec.status).toBe(200);
    expect(rec.headers.get('content-type')).toBe('audio/wav');
    expect((await rec.arrayBuffer()).byteLength).toBe(44 + pcm.byteLength);
    expect((await recordingRoute(jsonRequest(`/api/call/${id}/recording`, 'GET', undefined, cookieEmp()), ctx(id))).status).toBe(403);
    const empView = await json<CallView>(await viewRoute(jsonRequest(`/api/call/${id}`, 'GET', undefined, cookieEmp()), ctx(id)));
    expect(empView.access).toBe('summary');
    expect(empView.transcript).toBeNull();
    expect(JSON.stringify(empView.verdict)).not.toContain('quote');

    // после принятого приглашения — всё
    await prisma.invitation.create({ data: { candidateId: A, companyId: 'co-1', status: 'accepted', salaryFrom: 1, salaryTo: 2 } });
    expect((await recordingRoute(jsonRequest(`/api/call/${id}/recording`, 'GET', undefined, cookieEmp()), ctx(id))).status).toBe(200);
    const full = await json<CallView>(await viewRoute(jsonRequest(`/api/call/${id}`, 'GET', undefined, cookieEmp()), ctx(id)));
    expect(full.access).toBe('full');
    expect(full.transcript).toHaveLength(5);
  });

  it('прогоны разошлись по теме → «нужен ещё вопрос»: дополнительный вопрос, потом решение', async () => {
    const { sessionId: id } = await consentAndStart();
    await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG }, cookieA()), ctx(id));
    const q = 'Составной индекс по status и created_at';
    const c = (score: 0 | 1 | 2) => ({ quote: q, rationale: 'r', score });
    const pass = { topic: 'Подбирает индексы под запросы', depth: c(2), why: c(2), boundary: c(1), completion: c(1) };
    const fail = { topic: 'Подбирает индексы под запросы', depth: c(1), why: c(0), boundary: c(1), completion: c(1) };
    // Промежуточная оценка: 3 прогона pass/fail/pass → ещё 2: fail/pass → 3 из 5 — «не определено».
    const seq = [pass, fail, pass, fail, pass, pass, pass, pass];
    let n = 0;
    registerStubResponse('call_evaluator', () => ({ json: { topics: [seq[n++]!] } }));
    const interim = await json<CallView>(await finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieA()), ctx(id)));
    expect(n).toBe(5);
    expect(interim.status).toBe('active');
    expect(interim.verdict).toBeNull(); // промежуточная оценка наружу не отдаётся
    expect(interim.progress).toMatchObject({ awaitingAnswer: true, maxQuestions: 8 });
    const probe = interim.transcript!.at(-1)!;
    expect(probe.meta).toMatchObject({ topic: 'Подбирает индексы под запросы', probe: 'inconclusive' });
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: 'cl-1' } })).level).toBe('self_reported');

    const t = await json<{ done: boolean; ai: { meta?: unknown } }>(await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG2 }, cookieA()), ctx(id)));
    expect(t.done).toBe(true);
    expect(t.ai.meta).toBeUndefined();
    const fin = await json<CallView>(await finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieA()), ctx(id)));
    expect(n).toBe(8); // досчитана только тема с дополнительным вопросом, 3 согласных прогона
    expect(fin.status).toBe('finished');
    const v = fin.verdict as CallVerdict;
    expect(v.interim).toBeUndefined();
    expect(v.depthMap[0]).toMatchObject({ status: 'confirmed', extraProbe: true, probed: 2 });
    expect(v.upgradedCatalogIds).toEqual(['be.sql-indexes']);
  });

  it('тема остаётся «не определено» и после дополнительного вопроса — уровень не поднимается', async () => {
    const { sessionId: id } = await consentAndStart();
    await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG }, cookieA()), ctx(id));
    const q = 'Составной индекс по status и created_at';
    const c = (score: 0 | 1 | 2) => ({ quote: q, rationale: 'r', score });
    const pass = { topic: 'Подбирает индексы под запросы', depth: c(2), why: c(2), boundary: c(1), completion: c(1) };
    const fail = { topic: 'Подбирает индексы под запросы', depth: c(1), why: c(0), boundary: c(1), completion: c(1) };
    let n = 0;
    registerStubResponse('call_evaluator', () => ({ json: { topics: [n++ % 2 ? fail : pass] } }));
    await finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieA()), ctx(id));
    await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG2 }, cookieA()), ctx(id));
    const fin = await json<CallView>(await finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieA()), ctx(id)));
    const v = fin.verdict as CallVerdict;
    expect(v.depthMap[0]).toMatchObject({ status: 'inconclusive', confirmed: false, extraProbe: true });
    expect(v.upgradedCatalogIds).toEqual([]);
    expect(v.summary).toMatch(/Не определено/);
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: 'cl-1' } })).level).toBe('self_reported');
  });

  it('SSE: первым кадром snapshot, затем реплики созвона', async () => {
    const { sessionId: id } = await consentAndStart();
    const ctrl = new AbortController();
    const req = new Request(`http://localhost/api/call/${id}/events`, { headers: { cookie: cookieA() }, signal: ctrl.signal });
    const res = await eventsRoute(req, ctx(id));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = dec.decode((await reader.read()).value);
    expect(buf).toMatch(/^event: snapshot\ndata: /);
    await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG }, cookieA()), ctx(id));
    while (!/event: utterance[\s\S]*"role":"ai"/.test(buf)) buf += dec.decode((await reader.read()).value);
    expect(buf).toContain('"role":"candidate"');
    expect(buf).toContain('event: ai_state');
    ctrl.abort();
    await reader.cancel();
  });

  it('чужой созвон — 404; finish без ответов отменяет созвон без вердикта', async () => {
    const { sessionId: id } = await consentAndStart();
    await prisma.candidate.create({ data: { id: 'cand-b', email: 'b@example.test', name: 'Б' } });
    await prisma.user.create({ data: { id: 'user-b', role: 'candidate', name: 'Б', candidateId: 'cand-b' } });
    const cookieB = `cid=${signUserSession({ userId: 'user-b', role: 'candidate', candidateId: 'cand-b' })}`;
    expect((await viewRoute(jsonRequest(`/api/call/${id}`, 'GET', undefined, cookieB), ctx(id))).status).toBe(404);
    const v = await json<CallView>(await finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieA()), ctx(id)));
    expect(v.status).toBe('cancelled');
    expect(v.verdict).toBeNull();
  });

  it('finish: повторы после 503 ограничены — третий сбой оценщика закрывает созвон без оценки', async () => {
    const { sessionId: id } = await consentAndStart();
    expect((await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG }, cookieA()), ctx(id))).status).toBe(200);
    let calls = 0;
    registerStubResponse('call_evaluator', () => {
      calls += 1;
      throw new Error('evaluator down');
    });
    const finish = () => finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieA()), ctx(id));
    expect((await finish()).status).toBe(503);
    expect((await finish()).status).toBe(503);
    const third = await finish();
    expect(third.status).toBe(503);
    expect((await json<{ error: { message: string } }>(third)).error.message).toMatch(/закрыт без оценки/);
    const callsAfterThree = calls;
    expect((await finish()).status).toBe(409);
    expect(calls).toBe(callsAfterThree); // четвёртый запуск LLM не зовёт
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'cancelled', finishAttempts: 3, verdictJson: null });
  });

  it('CALL_DAILY_LIMIT: 1 — второй созвон за сутки 429; 0 — без лимита', async () => {
    const prev = process.env.CALL_DAILY_LIMIT;
    try {
      process.env.CALL_DAILY_LIMIT = '1';
      resetEnvCache();
      const { sessionId: id } = await consentAndStart();
      await finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieA()), ctx(id)); // без ответов → cancelled
      const limited = await startRoute(jsonRequest('/api/call/start', 'POST', { kind: 'qualifying' }, cookieA()));
      expect(limited.status).toBe(429);
      expect((await json<{ error: { code: string } }>(limited)).error.code).toBe('call_limit');

      process.env.CALL_DAILY_LIMIT = '0';
      resetEnvCache();
      expect((await startRoute(jsonRequest('/api/call/start', 'POST', { kind: 'qualifying' }, cookieA()))).status).toBe(201);
    } finally {
      if (prev === undefined) delete process.env.CALL_DAILY_LIMIT;
      else process.env.CALL_DAILY_LIMIT = prev;
      resetEnvCache();
    }
  });

  it('turn без текста (только audioRef) — 400: /turn второй раз STT не зовёт', async () => {
    const { sessionId: id } = await consentAndStart();
    const pcm = new Uint8Array(3200);
    const a = await audioRoute(new Request(`http://localhost/api/call/${id}/audio`, { method: 'POST', headers: { cookie: cookieA(), 'content-type': 'audio/l16' }, body: pcm }), ctx(id));
    const { audioRef } = await json<{ audioRef: string }>(a);
    const res = await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { audioRef }, cookieA()), ctx(id));
    expect(res.status).toBe(400);
    const missing = await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG, audioRef: '007.wav' }, cookieA()), ctx(id));
    expect(missing.status).toBe(404);
  });
});
