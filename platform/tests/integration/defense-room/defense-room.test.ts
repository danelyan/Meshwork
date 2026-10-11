// Ступень 3 ADR 0003: защита проекта с подключением работодателя (БД, stub-LLM, маршруты напрямую).
import { POST as signalRoute } from '@/app/api/call/[id]/signal/route';
import { GET as eventsRoute } from '@/app/api/defense-room/[id]/events/route';
import { POST as finishRoute } from '@/app/api/defense-room/[id]/finish/route';
import { GET as snapshotRoute } from '@/app/api/defense-room/[id]/route';
import { POST as turnRoute } from '@/app/api/defense-room/[id]/turn/route';
import { GET as pendingRoute } from '@/app/api/defense-room/pending/route';
import { POST as startRoute } from '@/app/api/defense-room/start/route';
import { POST as joinRoute } from '@/app/api/employer/call/[id]/join/route';
import { POST as muteRoute } from '@/app/api/employer/call/[id]/mute-ai/route';
import { POST as sayRoute } from '@/app/api/employer/call/[id]/say/route';
import { GET as listQuestions, POST as askRoute } from '@/app/api/employer/questions/route';
import { CALL_RECORDING_CONSENT_VERSION } from '@/server/call/consent';
import { parseContextBlock } from '@/server/call/prompt-utils';
import { subscribe, resetBus } from '@/server/defense-room/bus';
import type { CallEvent, CallSnapshot, DefenseRoomVerdict, TranscriptEntry } from '@/server/defense-room/types';
import { clearStubResponses, registerStubResponse } from '@/server/llm/providers/stub';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const CAND = 'cand-dr';
const CAND_COOKIE = `cid=${signUserSession({ userId: 'u-cand', role: 'candidate', candidateId: CAND })}`;
const EMP_A = `cid=${signUserSession({ userId: 'u-emp-a', role: 'employer', employerProfileId: 'ep-a' })}`;
const EMP_B = `cid=${signUserSession({ userId: 'u-emp-b', role: 'employer', employerProfileId: 'ep-b' })}`;
const SUB = 'sub-1';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown, cookie: string) => jsonRequest(url, 'POST', body, cookie);

// Слабая защита: оценщик ставит низко на всех трёх прогонах.
const WEAK_ITEM = { depth: { score: 1, quote: 'экспоненциально', rationale: '' }, why: { score: 0, quote: '', rationale: '' }, boundary: { score: 1, quote: 'не знаю точно', rationale: '' }, completion: { score: 0, quote: '', rationale: '' } };
/** Оценщик по вопросам (defense-room/verdict.ts): одинаково слабо по каждому пункту из `<call_context>`. */
const WEAK = (req: { messages: { content: string }[] }) => ({ items: (parseContextBlock<{ items: { id: string }[] }>(req.messages[0]!.content)?.items ?? []).map((i) => ({ id: i.id, ...WEAK_ITEM })) });

async function seed(opts: { consent?: boolean } = {}) {
  await prisma.candidate.create({ data: { id: CAND, email: 'c@example.com', name: 'Кандидат Защиты' } });
  await prisma.user.create({ data: { id: 'u-cand', name: 'Кандидат', role: 'candidate', candidateId: CAND } });
  if (opts.consent !== false) await prisma.consent.create({ data: { userId: 'u-cand', version: CALL_RECORDING_CONSENT_VERSION } });
  for (const x of ['a', 'b']) {
    await prisma.company.create({ data: { id: `co-${x}`, name: x === 'a' ? 'Альфа' : 'Бета' } });
    await prisma.user.create({ data: { id: `u-emp-${x}`, name: `HR ${x}`, role: 'employer' } });
    await prisma.employerProfile.create({ data: { id: `ep-${x}`, userId: `u-emp-${x}`, companyId: `co-${x}` } });
  }
  // Приглашение принято только компанией A.
  await prisma.invitation.create({ data: { candidateId: CAND, companyId: 'co-a', status: 'accepted', salaryFrom: 200000, salaryTo: 250000 } });
  await prisma.invitation.create({ data: { candidateId: CAND, companyId: 'co-b', status: 'sent', salaryFrom: 200000, salaryTo: 250000 } });
  // ProjectSubmission ссылается на ProjectTask (lane project): минимальные шаблон, потребность и задание.
  await prisma.projectTemplate.create({ data: { id: 'tpl-1', subcategoryId: 'backend.integrations', specialization: 'backend', grade: 'middle', title: 'Платежи', contractMd: '#', dirRef: 'x', hiddenTestsRef: 'hidden', visibleTestsRef: 'visible', image: 'node20', timeBudgetMin: 240 } });
  await prisma.vacancy.create({ data: { id: 'vac-1', companyId: 'co-a', title: 'Backend', specialization: 'backend', grade: 'middle', salaryFrom: 200000, salaryTo: 250000, needs: [] } });
  await prisma.projectTask.create({ data: { id: 'task-1', vacancyId: 'vac-1', templateId: 'tpl-1', specialization: 'backend', grade: 'middle', specJson: {}, rubricJson: { criteria: [] } } });
  await prisma.projectSubmission.create({
    data: {
      id: SUB,
      projectTaskId: 'task-1',
      candidateId: CAND,
      repoUrl: 'https://github.com/fsp-demo/payments',
      commitSha: 'd3m0c0ffee0000000000000000000000000000aa',
      status: 'checked',
      aiLogText: 'Очередь Queue сгенерировал ИИ, retry писал сам.',
      resultJson: { tests: Array.from({ length: 10 }, (_, i) => ({ name: `t${i}`, passed: i < 9 })) },
    },
  });
}

describe('защита проекта с работодателем', () => {
  beforeEach(async () => {
    await resetDb();
    resetBus();
    clearStubResponses();
    await seed();
  });
  afterAll(() => prisma.$disconnect());

  it('start → QLC → 2 хода → работодатель join → say → mute → finish → вердикт с флагом', async () => {
    // Вопрос работодателя, оставленный заранее (асинхронная очередь).
    const asked = await askRoute(post('/api/employer/questions', { candidateId: CAND, text: 'Почему очередь в памяти, а не брокер?' }, EMP_A));
    expect(asked.status).toBe(201);
    const qid = (await asked.json()).id as string;

    const started = await startRoute(post('/api/defense-room/start', { mode: 'project', projectSubmissionId: SUB }, CAND_COOKIE));
    expect(started.status).toBe(201);
    const { sessionId, webrtc, snapshot } = (await started.json()) as { sessionId: string; webrtc: { iceServers: { urls: string }[] }; snapshot: CallSnapshot };
    expect(webrtc.iceServers[0]!.urls).toBe('stun:stun.l.google.com:19302');
    expect(snapshot.transcript[0]).toMatchObject({ index: 0, role: 'ai', defense: { kind: 'greeting' } });
    expect(snapshot.transcript[0]!.text).toMatch(/fsp-demo\/payments/);
    const plan = await prisma.defenseRoomPlan.findUniqueOrThrow({ where: { callSessionId: sessionId } });
    const items = plan.itemsJson as { source: string; type?: string; ref?: string | null }[];
    // QLC: первый вопрос по коду, затем вопрос работодателя, затем остальные и ровно один «смени ограничение».
    expect(items[0]!.source).toBe('qlc');
    expect(items[1]!.source).toBe('employer');
    expect(items.filter((i) => i.type === 'constraint')).toHaveLength(1);
    expect(items.filter((i) => i.source === 'qlc' && i.type !== 'constraint').length).toBeGreaterThanOrEqual(3);
    expect(items[0]!.ref).toMatch(/^src\/.+:L\d+-L\d+$/);

    // Повторный старт — та же сессия.
    const again = await startRoute(post('/api/defense-room/start', { mode: 'project', projectSubmissionId: SUB }, CAND_COOKIE));
    expect((await again.json()).sessionId).toBe(sessionId);

    // Ход 1: ответ на вопрос по коду → ИИ задаёт вопрос работодателя из очереди.
    const t1 = await (await turnRoute(post('/x', { text: 'Задержка растёт экспоненциально, чтобы не добивать шлюз при сбое.' }, CAND_COOKIE), params(sessionId))).json();
    expect(t1).toMatchObject({ muted: false, done: false });
    expect(t1.text).toMatch(/Вопрос от компании «Альфа»: Почему очередь в памяти/);
    expect((await prisma.employerQuestion.findUniqueOrThrow({ where: { id: qid } })).status).toBe('asked');

    // Ход 2: ответ на вопрос работодателя → answered.
    const t2 = await (await turnRoute(post('/x', { text: 'Брокер избыточен для одного процесса, но при масштабировании не знаю точно, взял бы Kafka.' }, CAND_COOKIE), params(sessionId))).json();
    expect(t2.done).toBe(false);
    const q = await prisma.employerQuestion.findUniqueOrThrow({ where: { id: qid } });
    expect(q).toMatchObject({ status: 'answered', answeredInCallSessionId: sessionId });

    // Компания B без принятого приглашения: ни снимка, ни подключения.
    expect((await snapshotRoute(jsonRequest('/x', 'GET', undefined, EMP_B), params(sessionId))).status).toBe(404);
    expect((await joinRoute(post('/x', {}, EMP_B), params(sessionId))).status).toBe(404);

    // Работодатель A подключается, слушает SSE.
    const events: CallEvent[] = [];
    const unsub = subscribe(sessionId, 'employer:u-emp-a', (e) => events.push(e));
    const joined = await joinRoute(post('/x', {}, EMP_A), params(sessionId));
    expect(joined.status).toBe(200);
    const j = await joined.json();
    expect(j.snapshot.participants).toEqual([{ userId: 'u-emp-a', companyId: 'co-a', companyName: 'Альфа', aiMuted: false }]);

    // Реплика работодателя → транскрипт с ролью employer.
    const said = await sayRoute(post('/x', { text: 'А что будет, если шлюз ответит таймаутом на последней попытке?' }, EMP_A), params(sessionId));
    expect(said.status).toBe(201);
    expect((await said.json()).entry).toMatchObject({ role: 'employer', userId: 'u-emp-a', defense: { speaker: 'Альфа', companyId: 'co-a' } });

    // Mute: ИИ не вступает после ответа кандидата.
    expect((await (await muteRoute(post('/x', { muted: true }, EMP_A), params(sessionId))).json()).muted).toBe(true);
    const t3 = await (await turnRoute(post('/x', { text: 'Тогда исключение пробросится наверх, обработчик вернёт 500.' }, CAND_COOKIE), params(sessionId))).json();
    expect(t3).toEqual({ text: null, muted: true, done: false });

    // Unmute: ИИ возвращается к открытому вопросу плана.
    const un = await (await muteRoute(post('/x', { muted: false }, EMP_A), params(sessionId))).json();
    expect(un.aiText).toMatch(/Вернёмся к вопросу/);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['participant', 'utterance', 'mute']));
    unsub();

    // Работодатель видит транскрипт; кандидат — тоже; порядок ролей.
    const snapA = (await (await snapshotRoute(jsonRequest('/x', 'GET', undefined, EMP_A), params(sessionId))).json()) as CallSnapshot;
    expect(snapA.transcript.map((e: TranscriptEntry) => e.role)).toEqual(['ai', 'candidate', 'ai', 'candidate', 'ai', 'employer', 'candidate', 'ai']);

    // Завершение: три прогона слепого оценщика, слабая защита при 90 % тестов → флаг, не понижение.
    let evalCalls = 0;
    registerStubResponse('call_evaluator', (req) => {
      evalCalls++;
      return { json: WEAK(req) };
    });
    const fin = await finishRoute(post('/x', {}, CAND_COOKIE), params(sessionId));
    expect(fin.status).toBe(200);
    const { verdict } = (await fin.json()) as { verdict: DefenseRoomVerdict };
    expect(evalCalls).toBe(3);
    expect(verdict.passed).toBe(false);
    expect(verdict.projectScore).toBe(0.9);
    expect(verdict.flags).toContain('strong_project_weak_defense');
    expect(verdict.employerQuestions).toEqual({ asked: 1, answered: 1 });
    expect(verdict.summary).not.toMatch(/фейк/i);

    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row).toMatchObject({ status: 'finished', kind: 'defense', projectSubmissionId: SUB });
    expect(await prisma.callParticipant.count({ where: { callSessionId: sessionId, leftAt: null } })).toBe(0);
    // Повторное завершение — тот же вердикт.
    expect((await (await finishRoute(post('/x', {}, CAND_COOKIE), params(sessionId))).json()).verdict.evaluatedAt).toBe(verdict.evaluatedAt);

    // Ответ кандидата виден работодателю в списке вопросов.
    const list = await (await listQuestions(jsonRequest(`/api/employer/questions?candidateId=${CAND}`, 'GET', undefined, EMP_A))).json();
    expect(list.questions[0]).toMatchObject({ id: qid, status: 'answered' });
    expect(list.questions[0].answer).toMatch(/Брокер избыточен/);
  });

  it('асинхронная дозащита: вопрос после защиты копится, кандидат видит «N вопросов» и отвечает в мини-сессии без QLC', async () => {
    expect((await askRoute(post('/api/employer/questions', { candidateId: CAND, text: 'Как бы ты добавил метрики?' }, EMP_B))).status).toBe(404);
    await askRoute(post('/api/employer/questions', { candidateId: CAND, text: 'Как бы ты добавил метрики в retry?' }, EMP_A));
    await askRoute(post('/api/employer/questions', { candidateId: CAND, text: 'Что поменять для идемпотентности между узлами?' }, EMP_A));
    const pending = await (await pendingRoute(jsonRequest('/x', 'GET', undefined, CAND_COOKIE))).json();
    expect(pending.questions).toMatchObject({ total: 2, byCompany: [{ companyName: 'Альфа', count: 2 }], activeSessionId: null });
    expect(pending.submissions[0]).toMatchObject({ id: SUB, lastDefense: null });

    const st = await (await startRoute(post('/x', { mode: 'questions' }, CAND_COOKIE))).json();
    expect(st.snapshot.mode).toBe('questions');
    expect(st.snapshot.progress.total).toBe(2);
    expect(await prisma.defenseRoomPlan.count()).toBe(1);
    const t1 = await (await turnRoute(post('/x', { text: 'Счётчик попыток и гистограмма задержек в Prometheus.' }, CAND_COOKIE), params(st.sessionId))).json();
    expect(t1.text).toMatch(/идемпотентности между узлами/);
    // Кандидат ушёл, не ответив на второй: после finish вопрос снова в очереди.
    registerStubResponse('call_evaluator', (req) => ({ json: WEAK(req) }));
    const v = (await (await finishRoute(post('/x', {}, CAND_COOKIE), params(st.sessionId))).json()).verdict as DefenseRoomVerdict;
    expect(v.flags).toContain('employer_questions_unanswered');
    expect(v.flags).not.toContain('no_project_result');
    const statuses = (await prisma.employerQuestion.findMany({ orderBy: { askedAt: 'asc' } })).map((q) => q.status);
    expect(statuses).toEqual(['answered', 'queued']);
  });

  it('сигналинг: только участникам, адресату по SSE; собеседника нет — 409 peer_offline', async () => {
    const { sessionId } = await (await startRoute(post('/x', { mode: 'project', projectSubmissionId: SUB }, CAND_COOKIE))).json();
    const offer = { sdp: { type: 'offer', sdp: 'v=0\r\n' } };
    // Не подключился — нельзя.
    expect((await signalRoute(post('/x', offer, EMP_A), params(sessionId))).status).toBe(409);
    await joinRoute(post('/x', {}, EMP_A), params(sessionId));
    // Кандидат не слушает SSE — peer_offline.
    const off = await signalRoute(post('/x', offer, EMP_A), params(sessionId));
    expect(off.status).toBe(409);
    expect((await off.json()).error.code).toBe('peer_offline');

    const toCandidate: CallEvent[] = [];
    const toEmployer: CallEvent[] = [];
    const u1 = subscribe(sessionId, 'candidate', (e) => e.type === 'signal' && toCandidate.push(e));
    const u2 = subscribe(sessionId, 'employer:u-emp-a', (e) => e.type === 'signal' && toEmployer.push(e));
    expect((await signalRoute(post('/x', offer, EMP_A), params(sessionId))).status).toBe(200);
    expect(toCandidate).toEqual([{ type: 'signal', from: 'employer:u-emp-a', to: 'candidate', payload: { description: { type: 'offer', sdp: 'v=0\r\n' } } }]);
    expect(toEmployer).toEqual([]);
    // Кандидат отвечает конкретному работодателю; ICE-кандидат.
    expect((await signalRoute(post('/x', { to: 'employer:u-emp-a', ice: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } }, CAND_COOKIE), params(sessionId))).status).toBe(200);
    expect(toEmployer[0]).toMatchObject({ from: 'candidate', payload: { candidate: { sdpMid: '0' } } });
    // Адресат — не участник.
    expect((await signalRoute(post('/x', { to: 'employer:u-emp-b', ice: null }, CAND_COOKIE), params(sessionId))).status).toBe(404);
    u1();
    u2();
  });

  it('SSE: первым кадром snapshot; работодателю без приглашения — 404', async () => {
    const { sessionId } = await (await startRoute(post('/x', { mode: 'project', projectSubmissionId: SUB }, CAND_COOKIE))).json();
    expect((await eventsRoute(jsonRequest('/x', 'GET', undefined, EMP_B), params(sessionId))).status).toBe(404);
    const ctrl = new AbortController();
    const req = new Request('http://localhost/x', { headers: { cookie: CAND_COOKIE }, signal: ctrl.signal });
    const res = await eventsRoute(req, params(sessionId));
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('event: snapshot')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toMatch(/^retry: 3000\n\nevent: snapshot\ndata: \{"type":"snapshot","call":\{/);
    ctrl.abort();
    await reader.cancel();
  });
});

describe('защита: уточнение, затем вмешательство работодателя', () => {
  beforeEach(async () => {
    await resetDb();
    resetBus();
    clearStubResponses();
    await seed();
  });

  it('после уточнения ИИ и реплики работодателя ИИ не повторяет тот же вопрос, а идёт дальше; переход с точкой', async () => {
    const { sessionId } = await (await startRoute(post('/x', { mode: 'project', projectSubmissionId: SUB }, CAND_COOKIE))).json();
    let n = 0;
    registerStubResponse('call_interviewer', () => ({ json: n++ === 0 ? { ack: 'Ясно', followUp: 'А что будет при пустом входе в эту функцию?' } : { ack: 'Понял, спасибо', followUp: '' } }));
    const t1 = await (await turnRoute(post('/x', { text: 'Общие слова.' }, CAND_COOKIE), params(sessionId))).json();
    expect(t1.text).toMatch(/пустом входе/);
    await joinRoute(post('/x', {}, EMP_A), params(sessionId));
    await sayRoute(post('/x', { text: 'Уточню сам: а если вход null?' }, EMP_A), params(sessionId));
    await muteRoute(post('/x', { muted: true }, EMP_A), params(sessionId));
    await turnRoute(post('/x', { text: 'Упадёт на разборе, надо проверять.' }, CAND_COOKIE), params(sessionId));
    const un = await (await muteRoute(post('/x', { muted: false }, EMP_A), params(sessionId))).json();
    expect(un.aiText).not.toMatch(/Вернёмся/);
    expect(un.aiText).toMatch(/^Поняла, спасибо\. /);
  });
});

describe('защита: доступ, лимиты, гонки', () => {
  beforeEach(async () => {
    await resetDb();
    resetBus();
    clearStubResponses();
  });

  const start = async () => startRoute(post('/x', { mode: 'project', projectSubmissionId: SUB }, CAND_COOKIE));
  const acceptB = () => prisma.invitation.updateMany({ where: { companyId: 'co-b' }, data: { status: 'accepted' } });

  it('без согласия на запись — 403 call_consent_required с версией; сессия не создаётся', async () => {
    await seed({ consent: false });
    const res = await start();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('call_consent_required');
    expect(await prisma.callSession.count()).toBe(0);
  });

  it('policyVersion — версия согласия (как у call), версия правил защиты — в плане', async () => {
    await seed();
    const { sessionId } = await (await start()).json();
    expect((await prisma.callSession.findUniqueOrThrow({ where: { id: sessionId } })).policyVersion).toBe(CALL_RECORDING_CONSENT_VERSION);
    const plan = await prisma.defenseRoomPlan.findUniqueOrThrow({ where: { callSessionId: sessionId } });
    expect((plan.sourceJson as { policyVersion?: string }).policyVersion).toMatch(/^defense-room-/);
  });

  it('say и mute-ai: не подключившийся — 409, чужая компания без приглашения — 404', async () => {
    await seed();
    const { sessionId } = await (await start()).json();
    expect((await sayRoute(post('/x', { text: 'Привет, это Альфа' }, EMP_A), params(sessionId))).status).toBe(409);
    expect((await muteRoute(post('/x', { muted: true }, EMP_A), params(sessionId))).status).toBe(409);
    expect((await sayRoute(post('/x', { text: 'Привет, это Бета' }, EMP_B), params(sessionId))).status).toBe(404);
    expect((await muteRoute(post('/x', { muted: true }, EMP_B), params(sessionId))).status).toBe(404);
    const t = (await prisma.callSession.findUniqueOrThrow({ where: { id: sessionId } })).transcriptJson as unknown as TranscriptEntry[];
    expect(t.some((e) => e.role === 'employer')).toBe(false);
  });

  it('одна компания в эфире: вторая получает room_busy, в том числе при одновременном join', async () => {
    await seed();
    await acceptB();
    const { sessionId } = await (await start()).json();
    const [a, b] = await Promise.all([joinRoute(post('/x', {}, EMP_A), params(sessionId)), joinRoute(post('/x', {}, EMP_B), params(sessionId))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const busy = a.status === 409 ? a : b;
    expect((await busy.json()).error.code).toBe('room_busy');
    expect(await prisma.callParticipant.count({ where: { callSessionId: sessionId, leftAt: null } })).toBe(1);
  });

  it('не больше 3 защит на сабмит и общий суточный лимит с созвонами', async () => {
    await seed();
    for (let i = 0; i < 3; i++) {
      await prisma.callSession.create({ data: { candidateId: CAND, kind: 'defense', projectSubmissionId: SUB, status: 'finished', policyVersion: 'x', startedAt: new Date(Date.now() - 3 * 86_400_000) } });
    }
    const res = await start();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('defense_attempts_exhausted');

    await prisma.callSession.deleteMany();
    // 5 квалифицирующих созвонов за сутки (CALL_DAILY_LIMIT по умолчанию 5) — защита тоже упирается в лимит.
    for (let i = 0; i < 5; i++) await prisma.callSession.create({ data: { candidateId: CAND, kind: 'qualifying', status: 'finished', policyVersion: 'x' } });
    const limited = await start();
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('call_limit');
  });

  it('два параллельных finish: оценщик запускается один раз, второй — 409 busy или тот же вердикт', async () => {
    await seed();
    const { sessionId } = await (await start()).json();
    await turnRoute(post('/x', { text: 'Задержка растёт экспоненциально.' }, CAND_COOKIE), params(sessionId));
    let evalCalls = 0;
    registerStubResponse('call_evaluator', async (req) => {
      evalCalls++;
      await new Promise((r) => setTimeout(r, 50));
      return { json: WEAK(req) };
    });
    const [r1, r2] = await Promise.all([finishRoute(post('/x', {}, CAND_COOKIE), params(sessionId)), finishRoute(post('/x', {}, CAND_COOKIE), params(sessionId))]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);
    expect(evalCalls).toBe(3);
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row).toMatchObject({ status: 'finished', finishAttempts: 1 });
  });

  it('оценщик недоступен 3 раза — защита закрыта без оценки; больше попыток нет', async () => {
    await seed();
    const { sessionId } = await (await start()).json();
    await turnRoute(post('/x', { text: 'Задержка растёт экспоненциально.' }, CAND_COOKIE), params(sessionId));
    registerStubResponse('call_evaluator', () => {
      throw new Error('down');
    });
    for (let i = 0; i < 3; i++) expect((await finishRoute(post('/x', {}, CAND_COOKIE), params(sessionId))).status).toBe(503);
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row).toMatchObject({ status: 'cancelled', finishAttempts: 3, verdictJson: null });
    expect((await finishRoute(post('/x', {}, CAND_COOKIE), params(sessionId))).status).toBe(409);
  });

  it('изоляция компаний: вопрос A и ответ на него не видны B; список вопросов — только свои', async () => {
    await seed();
    await acceptB();
    const qa = (await (await askRoute(post('/x', { candidateId: CAND, text: 'Какая у тебя зарплатная вилка в Альфе?' }, EMP_A))).json()).id as string;
    await askRoute(post('/x', { candidateId: CAND, text: 'Что поменять в retry для Беты?' }, EMP_B));
    const listB = await (await listQuestions(jsonRequest(`/api/employer/questions?candidateId=${CAND}`, 'GET', undefined, EMP_B))).json();
    expect(listB.questions.map((q: { id: string }) => q.id)).not.toContain(qa);
    expect(JSON.stringify(listB)).not.toMatch(/Альфе/);

    const { sessionId } = await (await start()).json();
    // Ход 1 — ответ на QLC; ИИ задаёт первый вопрос работодателя (порядок очереди — по времени: сначала A).
    const t1 = await (await turnRoute(post('/x', { text: 'Задержка растёт экспоненциально.' }, CAND_COOKIE), params(sessionId))).json();
    expect(t1.text).toMatch(/Альфа/);
    await turnRoute(post('/x', { text: 'Секретный ответ для Альфы: от 300 тысяч.' }, CAND_COOKIE), params(sessionId));

    const snapB = (await (await snapshotRoute(jsonRequest('/x', 'GET', undefined, EMP_B), params(sessionId))).json()) as CallSnapshot;
    const textB = JSON.stringify(snapB);
    expect(textB).not.toMatch(/Альф|300 тысяч|co-a/);
    const snapA = JSON.stringify(await (await snapshotRoute(jsonRequest('/x', 'GET', undefined, EMP_A), params(sessionId))).json());
    expect(snapA).toMatch(/300 тысяч/);
    expect(snapA).not.toMatch(/для Беты/);
  });
});
