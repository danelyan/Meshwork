vi.mock('@/server/claims', async () => (await import('./mocks')).claimsMock);
vi.mock('@/server/collector', async () => (await import('./mocks')).collectorMock);
vi.mock('@/server/recommend', async () => (await import('./mocks')).recommendMock);

import { runTurn } from '@/server/agent/loop';
import type { AgentEvent } from '@/server/agent/types';
import { resetEnvCache } from '@/server/env';
import { resetLlmClient } from '@/server/llm/client';
import { clearStubResponses } from '@/server/llm/providers/stub';

import { prisma, resetDb } from '../../helpers/db';
import { claimsMock, makeDoc, recommendMock, resetMocks, seedCandidate, seedCatalog, seedUpload, TASKS } from './mocks';

const CAND = 'cand-demo';

async function turn(text: string, uploadIds?: string[]) {
  const conv = await prisma.conversation.create({ data: { candidateId: CAND } });
  const events: AgentEvent[] = [];
  await runTurn({ candidateId: CAND, conversationId: conv.id, text, ...(uploadIds ? { uploadIds } : {}) }, (e) => events.push(e));
  const msg = events.filter((e) => e.type === 'message').at(-1) as { text: string } | undefined;
  return { events, text: msg?.text ?? '', steps: events.filter((e) => e.type === 'step').map((e) => (e as { text: string }).text) };
}

async function confirmClaim() {
  await prisma.claim.create({
    data: { candidateId: CAND, catalogId: 'be.framework', statement: 'Писал HTTP-эндпоинты', level: 'self_reported', status: 'confirmed', quote: 'q', sourceRef: 'r', sourceKind: 'resume', limits: '', suggestedProof: [] },
  });
}

describe('демо-режим без модели (LLM_PROVIDER=stub, LLM_STUB_DEMO=true)', () => {
  beforeEach(async () => {
    process.env.LLM_PROVIDER = 'stub';
    process.env.LLM_STUB_DEMO = 'true';
    resetEnvCache();
    await resetDb();
    resetLlmClient();
    clearStubResponses();
    resetMocks();
    await seedCatalog();
    await seedCandidate(CAND);
  });
  afterEach(() => {
    process.env.LLM_STUB_DEMO = 'false';
    resetEnvCache();
  });
  afterAll(() => prisma.$disconnect());

  it('после конвейера: что найдено и отброшено, скрытый текст, тест, «подтверди карточки»; не эхо заглушки и не «упрощённый режим»', async () => {
    const doc = makeDoc({ lines: ['Писал эндпоинты на Flask', 'скрыто'], hidden: ['скрыто'] });
    const up = await seedUpload(CAND, doc, 'resume.pdf');
    claimsMock.extractClaims.mockImplementation(async () => [
      { catalogId: 'be.framework', statement: 'Писал HTTP-эндпоинты', quote: 'Писал эндпоинты на Flask', sourceRef: 'cv.pdf#p1:l1', confidence: 'high' },
      { catalogId: 'be.idempotency', statement: 'выдумано', quote: 'нет такого текста', sourceRef: 'cv.pdf#p1:l7', confidence: 'low' },
    ]);
    const { text, steps } = await turn('Вот моё резюме', [up.id]);
    expect(text).toContain('Прочитал: резюме');
    expect(text).toContain('Нашёл 1 утверждений, 1 отбросил');
    expect(text).toContain('скрытый текст');
    expect(text).toContain('Backend, Middle');
    expect(text).toContain('Подтверди карточки — покажу подходящие вакансии');
    expect(text).not.toContain('Заглушка LLM');
    expect(text).not.toContain('вложения');
    expect(text).not.toMatch(/упрощённом режиме/);
    expect(steps.join(' ')).not.toMatch(/упрощённом режиме/);
    expect(await prisma.agentRun.count({ where: { purpose: 'consultant' } })).toBe(0);
  });

  it('вакансии без подтверждённых утверждений → «подтверди карточки», recommendTargets не зовётся', async () => {
    const { text } = await turn('Какие есть вакансии?');
    expect(text).toContain('Подтверди карточки — покажу вакансии');
    expect(recommendMock.recommendTargets).not.toHaveBeenCalled();
  });

  it('после подтверждения вакансии приходят из recommendTargets', async () => {
    await confirmClaim();
    const { text } = await turn('Покажи вакансии');
    expect(recommendMock.recommendTargets).toHaveBeenCalledWith(CAND, 3);
    expect(text).toContain('Альфа-Финтех');
    expect(text).toContain('закрываешь 4 из 6');
    expect(text).not.toContain('Заглушка LLM');
  });

  it('«что дальше» → план из пробелов и заданий', async () => {
    await confirmClaim();
    recommendMock.recommendTasks.mockResolvedValueOnce([TASKS[0]!]);
    const { text } = await turn('Что дальше?');
    expect(recommendMock.gapMap).toHaveBeenCalled();
    expect(text).toContain('Обеспечивал согласованность между сервисами');
    expect(text).toContain('Задания');
    expect(text).toContain('Повтор платежа без дубля');
  });

  it('вопрос про тест → recommendTest', async () => {
    const { text } = await turn('Какой мне тест пройти?');
    expect(recommendMock.recommendTest).toHaveBeenCalled();
    expect(text).toContain('Категорию даёт только тест');
  });

  it('непонятный вопрос → подсказка без «упрощённого режима»', async () => {
    const { text } = await turn('Привет');
    expect(text).toContain('Пришли резюме');
    expect(text).not.toMatch(/упрощённом режиме/);
  });
});
