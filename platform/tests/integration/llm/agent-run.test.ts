import { getLlm, resetLlmClient } from '@/server/llm/client';

import { prisma, resetDb } from '../../helpers/db';

describe('getLlm (stub) пишет AgentRun в БД', () => {
  beforeEach(async () => {
    await resetDb();
    resetLlmClient();
  });
  afterAll(() => prisma.$disconnect());

  it('успешный вызов → строка AgentRun с кандидатом и токенами', async () => {
    const cand = await prisma.candidate.create({ data: { email: 'a@example.test', name: 'Тест' } });
    const llm = getLlm({ candidateId: cand.id, conversationId: 'conv-1' });
    const res = await llm.complete({ purpose: 'smoke', system: 's', messages: [{ role: 'user', content: 'привет' }] });
    expect(res.provider).toBe('stub');
    const runs = await prisma.agentRun.findMany();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      purpose: 'smoke',
      provider: 'stub',
      model: 'stub-1',
      ok: true,
      jsonValid: null,
      candidateId: cand.id,
      conversationId: 'conv-1',
      attempts: 1,
    });
    expect(runs[0]?.inputTokens).toBeGreaterThan(0);
  });

  it('ошибка провайдера → строка с ok=false и текстом ошибки', async () => {
    const llm = getLlm();
    await expect(
      llm.complete({ purpose: 'smoke', system: 's', messages: [{ role: 'user', content: '[[error 400 плохой запрос]]' }] }),
    ).rejects.toMatchObject({ status: 400 });
    const run = await prisma.agentRun.findFirstOrThrow();
    expect(run).toMatchObject({ ok: false, error: '[400] плохой запрос', candidateId: null });
  });
});
