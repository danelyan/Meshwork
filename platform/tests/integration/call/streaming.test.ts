// Созвон в потоковом режиме (лейн call-speed, 11.10): вопрос интервьюера уходит по SSE предложениями
// (utterance_delta) до ответа /turn; транскрипт и ответ /turn — реплика целиком и начинается с них.
// LLM — stub, обёрнутый в «потоковый» провайдер: отдаёт JSON stub-а кусками через onJsonDelta.
import { rmSync } from 'node:fs';

const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fsp-call-stream-test-${process.pid}`;
  process.env.CALL_DATA_DIR = dir;
  process.env.STT_PROVIDER = 'browser';
  return dir;
});

vi.mock('@/server/llm', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/server/llm')>();
  const { createLlmClient } = await import('@/server/llm/client');
  const { createStubProvider } = await import('@/server/llm/providers/stub');
  const stub = createStubProvider();
  /** Stub + поток: к вопросу интервьюера спереди добавлено предложение, JSON отдаётся по 6 символов. */
  const streaming: import('@/server/llm/types').LlmProvider = {
    ...stub,
    name: 'stream-stub',
    async complete(req, signal) {
      const res = await stub.complete(req, signal);
      if (!req.onJsonDelta || res.kind !== 'json') return res;
      const json = { ...(res.json as Record<string, unknown>) };
      json.question = `Хорошо, ответ принят. ${String(json.question)}`;
      const raw = JSON.stringify(json);
      for (let i = 0; i < raw.length; i += 6) req.onJsonDelta(raw.slice(i, i + 6));
      return { ...res, json };
    },
  };
  const client = createLlmClient({ provider: streaming, maxConcurrency: 2, timeoutMs: 5000, maxRetries: 0 });
  return { ...orig, getLlm: () => client.forContext() };
});

import { GET as eventsRoute } from '@/app/api/call/[id]/events/route';
import { POST as turnRoute } from '@/app/api/call/[id]/turn/route';
import { POST as consentRoute } from '@/app/api/call/consent/route';
import { POST as startRoute } from '@/app/api/call/start/route';
import { CALL_RECORDING_CONSENT_VERSION, type CallView, type TranscriptEntry, type TurnResult } from '@/server/call';
import { resetEnvCache } from '@/server/env';
import { splitSentences } from '@/lib/sentences';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';
import { grantConsents } from '../../helpers/consents';

const A = 'cand-s';
const cookieA = () => `cid=${signUserSession({ userId: 'user-s', role: 'candidate', candidateId: A })}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ANSWER = 'Составной индекс по status и created_at, потому что фильтр сначала по статусу, а сортировка по дате. В итоге запрос ускорился с 2 секунд до 40 мс.';

async function seed() {
  await prisma.candidate.create({ data: { id: A, email: 's@example.test', name: 'С', specialization: 'backend' } });
  await prisma.user.create({ data: { id: 'user-s', role: 'candidate', name: 'С', candidateId: A } });
  await prisma.candidateProfile.create({ data: { candidateId: A, claimedGrade: 'junior' } });
  await grantConsents('user-s', ['ai_assessment']);
  await prisma.claimCatalog.createMany({
    data: [
      { id: 'be.sql-indexes', specialization: 'backend', statement: 'Подбирает индексы под запросы', grades: ['junior', 'middle'], weight: 3, proof: [], markers: [], limits: '' },
      { id: 'be.idempotency', specialization: 'backend', statement: 'Проектирует идемпотентные операции', grades: ['middle'], weight: 2, proof: [], markers: [], limits: '' },
    ],
  });
  await prisma.claim.createMany({
    data: [
      { id: 'cl-s1', candidateId: A, catalogId: 'be.sql-indexes', statement: 'Ускорял запросы индексами', level: 'self_reported', quote: 'оптимизировал медленные отчёты индексами', sourceRef: 'cv#1', sourceKind: 'resume', limits: '', suggestedProof: [], status: 'confirmed' },
      { id: 'cl-s2', candidateId: A, catalogId: 'be.idempotency', statement: 'Делал идемпотентные платежи', level: 'artifact', quote: 'повтор платежа без дублей', sourceRef: 'cv#2', sourceKind: 'resume', limits: '', suggestedProof: [], status: 'confirmed' },
    ],
  });
}

async function start(): Promise<string> {
  const c = await consentRoute(jsonRequest('/api/call/consent', 'POST', { version: CALL_RECORDING_CONSENT_VERSION }, cookieA()));
  expect(c.status).toBe(201);
  const s = await startRoute(jsonRequest('/api/call/start', 'POST', { kind: 'qualifying' }, cookieA()));
  expect(s.status).toBe(201);
  return ((await s.json()) as { sessionId: string; call: CallView }).sessionId;
}

/** Ход с открытым SSE: кадры до реплики ИИ, ответ /turn. */
async function turnWithEvents(id: string) {
  const ctrl = new AbortController();
  const res = await eventsRoute(new Request(`http://localhost/api/call/${id}/events`, { headers: { cookie: cookieA() }, signal: ctrl.signal }), ctx(id));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = dec.decode((await reader.read()).value);
  const turn = await turnRoute(jsonRequest(`/api/call/${id}/turn`, 'POST', { text: ANSWER }, cookieA()), ctx(id));
  while (!/event: utterance\ndata: [^\n]*"role":"ai"/.test(buf)) buf += dec.decode((await reader.read()).value);
  ctrl.abort();
  await reader.cancel();
  const frames = buf.split('\n\n').filter(Boolean).map((f) => ({ type: /^event: (\S+)/.exec(f)?.[1], data: JSON.parse(f.slice(f.indexOf('data: ') + 6)) as Record<string, unknown> }));
  return { turn, body: (await turn.json()) as TurnResult, frames };
}

beforeEach(async () => {
  await resetDb();
  rmSync(dataDir, { recursive: true, force: true });
  await seed();
});
afterEach(() => {
  delete process.env.CALL_STREAMING;
  resetEnvCache();
});
afterAll(async () => {
  rmSync(dataDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe('созвон: потоковый вопрос интервьюера (CALL_STREAMING)', () => {
  it('предложения приходят utterance_delta раньше реплики; реплика и транскрипт начинаются с них', async () => {
    process.env.CALL_STREAMING = 'true';
    resetEnvCache();
    const id = await start();
    const { turn, body, frames } = await turnWithEvents(id);
    expect(turn.status).toBe(200);
    expect(turn.headers.get('server-timing')).toMatch(/llm;dur=\d+, first;dur=\d+/);
    const deltas = frames.filter((f) => f.type === 'utterance_delta').map((f) => f.data as { afterIndex: number; n: number; text: string });
    expect(deltas.length).toBeGreaterThanOrEqual(1);
    expect(deltas[0]).toMatchObject({ n: 0, text: 'Хорошо, ответ принят.', afterIndex: body.candidate.index });
    expect(deltas.map((d) => d.n)).toEqual(deltas.map((_, i) => i));
    const aiAt = frames.findIndex((f) => f.type === 'utterance' && (f.data.entry as TranscriptEntry).role === 'ai');
    expect(frames.findIndex((f) => f.type === 'utterance_delta')).toBeLessThan(aiAt);
    // Итог — целиком и начинается с отданных предложений; в БД то же самое.
    expect(splitSentences(body.text!).slice(0, deltas.length)).toEqual(deltas.map((d) => d.text));
    const row = await prisma.callSession.findUniqueOrThrow({ where: { id }, select: { transcriptJson: true } });
    const ai = (row.transcriptJson as unknown as TranscriptEntry[]).at(-1)!;
    expect(ai.text).toBe(body.text);
    expect(ai.meta?.streamCut).toBeUndefined();
  });

  it('CALL_STREAMING=false — без utterance_delta, ответ как раньше', async () => {
    process.env.CALL_STREAMING = 'false';
    resetEnvCache();
    const id = await start();
    const { turn, body, frames } = await turnWithEvents(id);
    expect(turn.status).toBe(200);
    expect(turn.headers.get('server-timing')).toMatch(/^llm;dur=\d+$/);
    expect(frames.some((f) => f.type === 'utterance_delta')).toBe(false);
    expect(body.text).not.toContain('Хорошо, ответ принят.');
  });
});
