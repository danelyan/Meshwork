import { rmSync } from 'node:fs';

const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fsp-interview-test-${process.pid}`;
  process.env.CALL_DATA_DIR = dir;
  process.env.STT_PROVIDER = 'browser';
  return dir;
});

import { POST as finishRoute } from '@/app/api/call/[id]/finish/route';
import { GET as viewRoute } from '@/app/api/call/[id]/route';
import { POST as turnRoute } from '@/app/api/call/[id]/turn/route';
import { POST as consentRoute } from '@/app/api/call/consent/route';
import { GET as listRoute } from '@/app/api/call/route';
import { POST as startRoute } from '@/app/api/call/start/route';
import { CALL_RECORDING_CONSENT_VERSION, type CallVerdict, type CallView, type TranscriptEntry } from '@/server/call';
import { resetEnvCache } from '@/server/env';
import { INTERVIEW_LIMITS } from '@/server/interview/plan';
import { clearStubResponses } from '@/server/llm/providers/stub';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const A = 'cand-a';
const cookieA = () => `cid=${signUserSession({ userId: 'user-a', role: 'candidate', candidateId: A })}`;
const cookieEmp = () => `cid=${signUserSession({ userId: 'user-emp', role: 'employer', employerProfileId: 'ep-1' })}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Сильный ответ для stub-оценщика: длина, «потому что», граница, результат. */
const STRONG =
  'В последнем проекте я отвечал за сервис платежей и сам разбил его на слои: обработчики, бизнес-логика, доступ к данным, потому что иначе логика расползалась по контроллерам. Альтернативу с одним модулем рассматривал, но она дороже в поддержке. Не уверен, что границы выдержат рост в десять раз, проверил бы нагрузкой. В итоге время на новую фичу упало вдвое, измерили по трекеру.';

async function seed() {
  await prisma.candidate.create({ data: { id: A, email: 'a@example.test', name: 'А', specialization: 'backend', subcategoryId: 'backend.web-api' } });
  await prisma.user.create({ data: { id: 'user-a', role: 'candidate', name: 'А', candidateId: A } });
  await prisma.candidateProfile.create({ data: { candidateId: A, claimedGrade: 'middle' } });
  await prisma.claimCatalog.createMany({
    data: [
      { id: 'be.layering', specialization: 'backend', statement: 'Разделял код сервиса на слои', grades: ['junior', 'middle'], weight: 3, proof: [], markers: [], limits: '' },
      { id: 'be.sql-indexes', specialization: 'backend', statement: 'Подбирал индексы', grades: ['middle'], weight: 3, proof: [], markers: [], limits: '' },
    ],
  });
  await prisma.claim.createMany({
    data: [
      { id: 'cl-1', candidateId: A, catalogId: 'be.layering', statement: 'Делил сервис на слои', level: 'self_reported', quote: 'разделил монолит на слои', sourceRef: 'cv#1', sourceKind: 'resume', limits: '', suggestedProof: [], status: 'confirmed' },
      { id: 'cl-2', candidateId: A, catalogId: 'be.sql-indexes', statement: 'Ускорял запросы индексами', level: 'artifact', quote: 'оптимизировал отчёты индексами', sourceRef: 'cv#2', sourceKind: 'resume', limits: '', suggestedProof: [], status: 'confirmed' },
    ],
  });
  await prisma.company.create({ data: { id: 'co-1', name: 'Компания' } });
  await prisma.user.create({ data: { id: 'user-emp', role: 'employer', name: 'Р' } });
  await prisma.employerProfile.create({ data: { id: 'ep-1', userId: 'user-emp', companyId: 'co-1' } });
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

describe('ИИнтервью: start → блоки → finish → оси, соответствие грейду, platform (stub)', () => {
  it('полный сценарий на stub-провайдере', async () => {
    await consentRoute(jsonRequest('/api/call/consent', 'POST', { version: CALL_RECORDING_CONSENT_VERSION }, cookieA()));
    const s = await startRoute(jsonRequest('/api/call/start', 'POST', { kind: 'interview' }, cookieA()));
    expect(s.status).toBe(201);
    const started = await json<{ sessionId: string; call: CallView }>(s);
    const id = started.sessionId;
    expect(started.call.kind).toBe('interview');
    expect(started.call.progress).toMatchObject({ minQuestions: INTERVIEW_LIMITS.minQuestions, maxQuestions: INTERVIEW_LIMITS.maxQuestions, awaitingAnswer: true });
    const first = started.call.transcript![0]!;
    expect(first.meta).toMatchObject({ competencyId: 'common.context', block: 'intro', level: 2, topic: 'Контекст и роль' });
    expect(first.text).toMatch(/[а-яё]/i);

    // Список по виду: интервью отдельно от созвонов.
    const list = await json<{ calls: CallView[] }>(await listRoute(jsonRequest('/api/call?kind=interview', 'GET', undefined, cookieA())));
    expect(list.calls.map((c) => c.id)).toEqual([id]);
    const q = await json<{ calls: CallView[] }>(await listRoute(jsonRequest('/api/call?kind=qualifying', 'GET', undefined, cookieA())));
    expect(q.calls).toHaveLength(0);

    // Сильные ответы: знакомство → ядро подкатегории (backend.code) → глубже → другая компетенция → дизайн → команда → закрытие.
    const metas: NonNullable<TranscriptEntry['meta']>[] = [first.meta!];
    let done = false;
    for (let i = 0; i < INTERVIEW_LIMITS.maxQuestions + 1 && !done; i++) {
      const t = await json<{ ai: TranscriptEntry | null; done: boolean }>(await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG }, cookieA()), ctx(id)));
      done = t.done;
      if (t.ai?.meta) metas.push(t.ai.meta);
    }
    expect(done).toBe(true);
    expect(metas.length).toBeLessThanOrEqual(INTERVIEW_LIMITS.maxQuestions);
    expect(metas.length).toBeGreaterThanOrEqual(INTERVIEW_LIMITS.minQuestions);
    expect(metas[1]).toMatchObject({ competencyId: 'backend.code', block: 'test', level: 2, routedBy: 'strong' });
    expect(metas[2]).toMatchObject({ competencyId: 'backend.code', block: 'test', level: 3 });
    expect([...new Set(metas.map((m) => m.block))]).toEqual(['intro', 'test', 'systems', 'team']);

    const fin = await finishRoute(jsonRequest(`/api/call/${id}/finish`, 'POST', {}, cookieA()), ctx(id));
    expect(fin.status).toBe(200);
    const view = await json<CallView>(fin);
    expect(view.status).toBe('finished');
    const verdict = view.verdict as CallVerdict;
    expect(verdict.kind).toBe('interview');
    expect(verdict.validRuns).toBeGreaterThanOrEqual(2);
    expect(verdict.interview).toBeDefined();
    const iv = verdict.interview!;
    expect(iv.claimedGrade).toBe('middle');
    expect(iv.blocks).toEqual(['intro', 'test', 'systems', 'team']);
    const code = iv.competencies.find((c) => c.id === 'backend.code')!;
    expect(code).toMatchObject({ status: 'confirmed', maxLevel: 3, demonstrated: 'senior', axis: 'technical' });
    const axes = Object.fromEntries(iv.axes.map((a) => [a.axis, a.score]));
    expect(axes.technical).toBeGreaterThan(50);
    expect(axes.systems).not.toBeNull();
    expect(axes.communication).not.toBeNull();
    expect(iv.gradeFit.label).toBe('match');
    expect(iv.overall).toBeGreaterThan(50);
    // Непройденные технические компетенции — «не проверено», в оси не входят.
    expect(verdict.depthMap.some((d) => d.status === 'not_probed')).toBe(true);
    expect(iv.strengths).toContain('Код и язык');
    // Подтверждённая компетенция backend.code покрывает be.layering → platform; be.sql-indexes (backend.data) не спрашивали.
    expect(verdict.upgradedCatalogIds).toEqual(['be.layering']);
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: 'cl-1' } })).level).toBe('platform');
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: 'cl-2' } })).level).toBe('artifact');
    expect(verdict.disclaimer).toMatch(/не меняет категорию/);

    // Работодатель без принятого приглашения: оси и компетенции есть, транскрипта и цитат нет.
    const emp = await viewRoute(jsonRequest(`/api/call/${id}`, 'GET', undefined, cookieEmp()), ctx(id));
    expect(emp.status).toBe(200);
    const ev = await json<CallView>(emp);
    expect(ev.access).toBe('summary');
    expect(ev.transcript).toBeNull();
    expect(ev.verdict && 'interview' in ev.verdict && ev.verdict.interview?.gradeFit.label).toBe('match');
    expect(JSON.stringify(ev.verdict)).not.toContain('"quote"');
  });

  it('пропуск и уточнение — обычные реплики: интервью идёт дальше, пустой ответ — 400', async () => {
    await consentRoute(jsonRequest('/api/call/consent', 'POST', { version: CALL_RECORDING_CONSENT_VERSION }, cookieA()));
    const started = await json<{ sessionId: string }>(await startRoute(jsonRequest('/api/call/start', 'POST', { kind: 'interview' }, cookieA())));
    const id = started.sessionId;
    const skip = await json<{ ai: TranscriptEntry | null }>(await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: 'Пропускаю этот вопрос.' }, cookieA()), ctx(id)));
    // Слабый сигнал: следующий блок стартует на уровне грейда (новый блок не понижается).
    expect(skip.ai?.meta).toMatchObject({ block: 'test', level: 2, routedBy: 'weak' });
    const empty = await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: '   ' }, cookieA()), ctx(id));
    expect(empty.status).toBe(400);
  });
});

describe('перебивание ИИ в режиме звонка (POST /api/call/{id}/interrupt)', () => {
  it('реплика обрезается до услышанного, хвост — интервьюеру; чужой индекс и повтор — без изменений', async () => {
    const { POST: interruptRoute } = await import('@/app/api/call/[id]/interrupt/route');
    await consentRoute(jsonRequest('/api/call/consent', 'POST', { version: CALL_RECORDING_CONSENT_VERSION }, cookieA()));
    const started = await json<{ sessionId: string; call: CallView }>(await startRoute(jsonRequest('/api/call/start', 'POST', { kind: 'interview' }, cookieA())));
    const id = started.sessionId;
    const first = started.call.transcript![0]!;
    const total = first.text.split(/(?<=[.!?…])\s+/).length;
    expect(total).toBeGreaterThan(1);

    const bad = await interruptRoute(jsonRequest(`/api/call/${id}/interrupt`, 'POST', { index: 5, heardSentences: 1 }, cookieA()), ctx(id));
    expect(bad.status).toBe(404);

    const res = await interruptRoute(jsonRequest(`/api/call/${id}/interrupt`, 'POST', { index: first.index, heardSentences: 1 }, cookieA()), ctx(id));
    expect(res.status).toBe(200);
    const cut = await json<TranscriptEntry>(res);
    expect(cut.text).toMatch(/…\(перебит\)$/);
    expect(cut.text.length).toBeLessThan(first.text.length);
    expect(cut.meta?.interrupted).toMatchObject({ heardSentences: 1 });
    expect(cut.meta?.interrupted?.tail.length).toBeGreaterThan(5);
    expect(`${cut.text.replace(/ …\(перебит\)$/, '')} ${cut.meta!.interrupted!.tail}`).toBe(first.text);

    // Повтор идемпотентен.
    const again = await json<TranscriptEntry>(await interruptRoute(jsonRequest(`/api/call/${id}/interrupt`, 'POST', { index: first.index, heardSentences: 0 }, cookieA()), ctx(id)));
    expect(again.text).toBe(cut.text);

    // Ответ принимается, следующий вопрос — по плану; перебитый вопрос в транскрипте остаётся обрезанным.
    const t = await json<{ ai: TranscriptEntry | null }>(await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: STRONG }, cookieA()), ctx(id)));
    expect(t.ai?.meta).toMatchObject({ block: 'test' });
    const view = await json<CallView>(await viewRoute(jsonRequest(`/api/call/${id}`, 'GET', undefined, cookieA()), ctx(id)));
    expect(view.transcript![0]!.text).toBe(cut.text);
    // Перебить можно только текущий вопрос.
    const old = await interruptRoute(jsonRequest(`/api/call/${id}/interrupt`, 'POST', { index: t.ai!.index - 2, heardSentences: 0 }, cookieA()), ctx(id));
    expect(old.status).toBe(409);
    // Ничего не услышал — пометка «не прозвучало».
    const none = await json<TranscriptEntry>(await interruptRoute(jsonRequest(`/api/call/${id}/interrupt`, 'POST', { index: t.ai!.index, heardSentences: 0 }, cookieA()), ctx(id)));
    expect(none.text).toMatch(/не прозвучало/);
    expect(none.meta?.interrupted?.heardSentences).toBe(0);
  });
});
