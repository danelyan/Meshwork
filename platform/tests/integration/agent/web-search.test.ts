import { beforeEach, describe, expect, it } from 'vitest';

import { dispatchToolCall } from '@/server/agent/dispatch';
import type { ToolContext } from '@/server/agent/types';
import { candidateTerms, candidateWebSearch } from '@/server/agent/web-search/tool';
import type { LlmProvider } from '@/server/llm/types';

import { prisma, resetDb } from '../../helpers/db';

const CAND = 'cand-ws';

async function seed() {
  await prisma.candidate.create({ data: { id: CAND, email: 'ivan.petrov@example.test', name: 'Иван Петров' } });
  await prisma.source.create({ data: { candidateId: CAND, kind: 'github', origin: 'https://github.com/ivan-petrov', snapshot: {} } });
  await prisma.upload.create({
    data: {
      candidateId: CAND,
      filename: 'cv.pdf',
      mime: 'application/pdf',
      sha256: 'ws-1',
      size: 10,
      extracted: { text: 'Backend-разработчик в ООО «Ромашка-Софт», 2023–2025' },
    },
  });
}

const ctx = (conversationId: string): ToolContext => ({ candidateId: CAND, conversationId, emit: () => undefined, llm: {} as LlmProvider });

describe('web_search кандидата: данные профиля и лимит разговора из БД', () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
  });

  it('термины профиля: имя, фамилия, почта, ник из ссылки, компания из резюме', async () => {
    const terms = await candidateTerms(CAND);
    expect(terms).toEqual(expect.arrayContaining(['Иван Петров', 'Петров', 'ivan.petrov@example.test', 'ivan.petrov', 'ivan-petrov', 'Ромашка-Софт']));
  });

  it('запрос с фамилией или компанией из профиля отклоняется до сети', async () => {
    const conv = await prisma.conversation.create({ data: { candidateId: CAND } });
    for (const query of ['отзывы о Петров backend', 'Ромашка-Софт зарплаты']) {
      const r = await dispatchToolCall([candidateWebSearch], ctx(conv.id), { id: 'w', name: 'web_search', arguments: { query } });
      expect(JSON.parse(r.content).error.code, query).toBe('pii_in_query');
    }
  });

  it('вызовы web_search, записанные в разговоре, считаются в лимит 10', async () => {
    const conv = await prisma.conversation.create({ data: { candidateId: CAND } });
    const calls = Array.from({ length: 11 }, (_, i) => ({ id: `w${i}`, name: 'web_search', arguments: { query: 'вопросы PostgreSQL' } }));
    await prisma.message.create({ data: { conversationId: conv.id, role: 'assistant', content: '', toolCalls: calls } });
    const r = await dispatchToolCall([candidateWebSearch], ctx(conv.id), { id: 'w11', name: 'web_search', arguments: { query: 'вопросы PostgreSQL' } });
    expect(JSON.parse(r.content).error.code).toBe('web_search_limit');
  });
});
