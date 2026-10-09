import { POST as answerRoute } from '@/app/api/test/attempt/[id]/answer/route';
import { POST as confirmJuniorRoute } from '@/app/api/test/attempt/[id]/confirm-junior/route';
import { POST as finishRoute } from '@/app/api/test/attempt/[id]/finish/route';
import { GET as getRoute } from '@/app/api/test/attempt/[id]/route';
import { GET as historyRoute } from '@/app/api/test/attempts/route';
import { GET as eligibilityRoute, POST as startRoute } from '@/app/api/test/start/route';
import { signSession } from '@/server/session';
import { answerAttempt, checkEligibility, finishAttempt, getAttempt, startAttempt } from '@/server/test';
import { MAX_ITEMS, MIN_ITEMS } from '@/server/test/policy';
import type { AttemptView } from '@/server/test/types';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const A = 'cand-a';
const B = 'cand-b';
const cookie = (id: string) => `cid=${signSession(id)}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Ключ текущего задания — из БД (клиенту он не отдаётся). */
async function currentKey(attemptId: string): Promise<{ key: string; grade: string }> {
  const it = await prisma.testItem.findFirstOrThrow({ where: { attemptId, correct: null }, include: { template: true } });
  return { key: it.answerKey.split('|')[0]!, grade: it.template.grade };
}

/** Пройти попытку сервисом: answerFor решает, что отвечать по грейду шаблона. */
async function play(candidateId: string, attemptId: string, answerFor: (grade: string, key: string) => string): Promise<AttemptView> {
  let v = await getAttempt(candidateId, attemptId);
  let guard = 0;
  while (v.status === 'active' && guard++ < 20) {
    const { key, grade } = await currentKey(attemptId);
    v = await answerAttempt(candidateId, attemptId, answerFor(grade, key));
  }
  return v;
}

beforeEach(async () => {
  await resetDb();
  await prisma.candidate.createMany({
    data: [
      { id: A, email: 'a@example.test', name: 'А', specialization: 'backend' },
      { id: B, email: 'b@example.test', name: 'Б' },
    ],
  });
});

describe('API теста на грейд', () => {
  it('start → задание без ключа; верные ответы → Middle подтверждён, категория записана, история видна', async () => {
    const started = await startRoute(jsonRequest('/api/test/start', 'POST', { specialization: 'backend', grade: 'middle' }, cookie(A)));
    expect(started.status).toBe(201);
    const { attemptId } = (await started.json()) as { attemptId: string };

    const got = await getRoute(jsonRequest(`/api/test/attempt/${attemptId}`, 'GET', undefined, cookie(A)), ctx(attemptId));
    expect(got.status).toBe(200);
    const view = (await got.json()) as AttemptView;
    expect(view.status).toBe('active');
    expect(view.current?.prompt.length).toBeGreaterThan(10);
    expect(JSON.stringify(view)).not.toContain('answerKey');
    expect(view.result).toBeNull();

    // Повторный start той же категории — продолжение (200), другой категории — 409.
    const again = await startRoute(jsonRequest('/api/test/start', 'POST', { specialization: 'backend', grade: 'middle' }, cookie(A)));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { resumed: boolean }).resumed).toBe(true);
    const other = await startRoute(jsonRequest('/api/test/start', 'POST', { specialization: 'frontend', grade: 'junior' }, cookie(A)));
    expect(other.status).toBe(409);

    let last: AttemptView = view;
    let n = 0;
    while (last.status === 'active' && n++ < 20) {
      const { key } = await currentKey(attemptId);
      const res = await answerRoute(jsonRequest(`/api/test/attempt/${attemptId}/answer`, 'POST', { answer: key }, cookie(A)), ctx(attemptId));
      expect(res.status).toBe(200);
      last = (await res.json()) as AttemptView;
    }
    expect(last.status).toBe('passed');
    expect(last.result?.confirmed).toBe(true);
    expect(last.result?.answered).toBeGreaterThanOrEqual(MIN_ITEMS);
    expect(last.result?.answered).toBeLessThanOrEqual(MAX_ITEMS);
    expect(last.result?.items.every((i) => i.correct)).toBe(true);
    expect(last.result?.confirmedCatalogIds.length).toBeGreaterThan(0);
    const cat = await prisma.candidateCategory.findFirst({ where: { candidateId: A } });
    expect(cat).toMatchObject({ specialization: 'backend', grade: 'middle', source: 'test' });

    // Ответ на завершённую — 409; история — одна запись passed.
    const late = await answerRoute(jsonRequest(`/api/test/attempt/${attemptId}/answer`, 'POST', { answer: '1' }, cookie(A)), ctx(attemptId));
    expect(late.status).toBe(409);
    const hist = (await (await historyRoute(jsonRequest('/api/test/attempts', 'GET', undefined, cookie(A)))).json()) as { attempts: { status: string }[] };
    expect(hist.attempts.map((a) => a.status)).toEqual(['passed']);
  });

  it('решённое задание поднимает до platform и утверждение уровня third_party (решение 09.10)', async () => {
    const { attemptId } = await startAttempt(A, 'backend', 'middle');
    const tpls = await prisma.taskTemplate.findMany({ where: { specialization: 'backend' } });
    const ids = [...new Set(tpls.flatMap((t) => t.catalogIds))];
    await prisma.claimCatalog.createMany({
      data: ids.map((id) => ({ id, specialization: 'backend' as const, statement: id, grades: ['middle' as const], weight: 2, proof: [], markers: [], limits: '-' })),
    });
    await prisma.claim.createMany({
      data: ids.map((catalogId, i) => ({
        id: `cl-${i}`, candidateId: A, catalogId, statement: 'Утверждение', level: 'third_party' as const, quote: 'цитата',
        sourceRef: 'fsp#1', sourceKind: 'fsp' as const, limits: '-', suggestedProof: [], status: 'confirmed' as const,
      })),
    });
    await play(A, attemptId, (_g, key) => key);
    const solved = new Set((await prisma.testItem.findMany({ where: { attemptId, correct: true }, include: { template: true } })).flatMap((i) => i.template.catalogIds));
    expect(solved.size).toBeGreaterThan(0);
    const after = await prisma.claim.findMany({ where: { candidateId: A } });
    for (const c of after) expect(c.level).toBe(solved.has(c.catalogId) ? 'platform' : 'third_party');
  });

  it('чужая попытка — 404; без сессии — 401', async () => {
    const { attemptId } = await startAttempt(A, 'backend', 'junior');
    const res = await getRoute(jsonRequest(`/api/test/attempt/${attemptId}`, 'GET', undefined, cookie(B)), ctx(attemptId));
    expect(res.status).toBe(404);
    const ans = await answerRoute(jsonRequest(`/api/test/attempt/${attemptId}/answer`, 'POST', { answer: '1' }, cookie(B)), ctx(attemptId));
    expect(ans.status).toBe(404);
    const anon = await getRoute(jsonRequest(`/api/test/attempt/${attemptId}`, 'GET'), ctx(attemptId));
    expect(anon.status).toBe(401);
  });

  it('повторяемость: тот же seed и те же ответы → те же задания и тот же грейд', async () => {
    const first = await startAttempt(A, 'frontend', 'junior', new Date(), { seed: 12345 });
    const v1 = await play(A, first.attemptId, (_g, key) => key);
    const items1 = await prisma.testItem.findMany({ where: { attemptId: first.attemptId }, orderBy: { index: 'asc' } });
    // Второй кандидат с тем же seed (интервалы на другого кандидата не действуют).
    const second = await startAttempt(B, 'frontend', 'junior', new Date(), { seed: 12345 });
    const v2 = await play(B, second.attemptId, (_g, key) => key);
    const items2 = await prisma.testItem.findMany({ where: { attemptId: second.attemptId }, orderBy: { index: 'asc' } });
    expect(items2.map((i) => [i.templateId, i.prompt, i.answerKey])).toEqual(items1.map((i) => [i.templateId, i.prompt, i.answerKey]));
    expect(v2.status).toBe(v1.status);
    expect(v2.result?.theta).toBe(v1.result?.theta);
    // Разные seed → другой вариант заданий (параметры), хотя грейд тот же.
    const third = await startAttempt(B, 'frontend', 'junior', new Date(Date.now() + 100 * 24 * 3600e3), { seed: 777 });
    const items3 = await prisma.testItem.findMany({ where: { attemptId: third.attemptId } });
    const same = items1.find((i) => i.templateId === items3[0]!.templateId);
    expect(`${items3[0]!.prompt}\n${items3[0]!.code}`).not.toBe(`${same?.prompt}\n${same?.code}`);
  });

  it('интервалы R-C-09: пересдача того же грейда и смена грейда — не раньше срока; abandoned не считается', async () => {
    const t0 = new Date('2026-10-10T10:00:00Z');
    const a1 = await startAttempt(A, 'backend', 'junior', t0, { seed: 1 });
    const v = await play(A, a1.attemptId, (_g, key) => key);
    expect(v.status).toBe('passed');
    // Пересдача того же грейда сразу — нельзя.
    const retake = await startRoute(jsonRequest('/api/test/start', 'POST', { specialization: 'backend', grade: 'junior' }, cookie(A)));
    expect(retake.status).toBe(409);
    expect(((await retake.json()) as { error: { code: string } }).error.code).toBe('retake_too_soon');
    // Смена грейда сразу после подтверждения — нельзя (30 дней), через 31 день — можно.
    expect((await checkEligibility(A, 'backend', 'middle', new Date(t0.getTime() + 24 * 3600e3))).code).toBe('grade_change_too_soon');
    expect((await checkEligibility(A, 'backend', 'middle', new Date(t0.getTime() + 31 * 24 * 3600e3))).allowed).toBe(true);
    expect((await checkEligibility(A, 'backend', 'junior', new Date(t0.getTime() + 15 * 24 * 3600e3))).allowed).toBe(true);
    const elig = await eligibilityRoute(jsonRequest('/api/test/start?specialization=backend&grade=junior', 'GET', undefined, cookie(A)));
    expect(((await elig.json()) as { allowed: boolean; rules: string }).rules.length).toBeGreaterThan(10);

    // Попытка без ответов, завершённая досрочно, — abandoned и интервалы не трогает.
    const t1 = new Date(t0.getTime() + 40 * 24 * 3600e3);
    const a2 = await startAttempt(A, 'backend', 'middle', t1, { seed: 2 });
    const fin = await finishRoute(jsonRequest(`/api/test/attempt/${a2.attemptId}/finish`, 'POST', {}, cookie(A)), ctx(a2.attemptId));
    expect(((await fin.json()) as AttemptView).status).toBe('abandoned');
    expect((await checkEligibility(A, 'backend', 'middle', t1)).allowed).toBe(true);
    // Категория не понижается провалом: Junior остаётся единственной категорией.
    expect(await prisma.candidateCategory.count({ where: { candidateId: A } })).toBe(1);
  });

  it('Middle не сдан, Junior решён → предложение и подтверждение Junior в один клик (R-C-08); повторно — 409', async () => {
    const { attemptId } = await startAttempt(A, 'backend', 'middle', new Date(), { seed: 4242 });
    const v = await play(A, attemptId, (grade, key) => (grade === 'junior' ? key : 'нет'));
    expect(v.status).toBe('not_confirmed');
    expect(v.result?.confirmed).toBe(false);
    expect(v.result?.juniorOffered).toBe(true);
    expect(await prisma.candidateCategory.count({ where: { candidateId: A } })).toBe(0);
    // Решённые Junior-задания поднимают подтверждённые утверждения до «платформа».
    const res = await confirmJuniorRoute(jsonRequest(`/api/test/attempt/${attemptId}/confirm-junior`, 'POST', {}, cookie(A)), ctx(attemptId));
    expect(res.status).toBe(200);
    const after = (await res.json()) as AttemptView;
    expect(after.result?.juniorConfirmedAt).not.toBeNull();
    expect(after.result?.juniorOffered).toBe(false);
    const cat = await prisma.candidateCategory.findFirst({ where: { candidateId: A } });
    expect(cat).toMatchObject({ grade: 'junior', source: 'test' });
    const twice = await confirmJuniorRoute(jsonRequest(`/api/test/attempt/${attemptId}/confirm-junior`, 'POST', {}, cookie(A)), ctx(attemptId));
    expect(twice.status).toBe(409);
  });

  it('все ответы неверные → не подтверждён, Junior не предлагается; досрочное завершение считает по данным ответам', async () => {
    const { attemptId } = await startAttempt(A, 'frontend', 'middle', new Date(), { seed: 99 });
    const v = await play(A, attemptId, () => 'мимо');
    expect(v.status).toBe('not_confirmed');
    expect(v.result?.juniorOffered).toBe(false);
    expect(v.result?.correct).toBe(0);

    const b = await startAttempt(B, 'frontend', 'middle', new Date(), { seed: 5 });
    const { key } = await currentKey(b.attemptId);
    await answerAttempt(B, b.attemptId, key);
    const fin = await finishAttempt(B, b.attemptId);
    expect(fin.status).toBe('not_confirmed');
    expect(fin.result?.answered).toBe(1);
    expect(fin.result?.correct).toBe(1);
  });
});
