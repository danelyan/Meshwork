import { loadLastChat } from '@/server/agent/restore';

import { prisma, resetDb } from '../../helpers/db';

async function mk(id: string) {
  await prisma.candidate.create({ data: { id, email: `${id}@example.test`, name: id } });
}

describe('loadLastChat', () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.claimCatalog.create({ data: { id: 'be.cache', specialization: 'backend', statement: 'Кэш', grades: ['junior'], weight: 1, proof: [], markers: [], limits: '' } });
    await mk('a');
    await mk('b');
  });
  afterAll(() => prisma.$disconnect());

  const claim = (candidateId: string, status: 'proposed' | 'confirmed') =>
    prisma.claim.create({
      data: { candidateId, catalogId: 'be.cache', statement: 'Кэш', level: 'self_reported', quote: 'q', sourceRef: 'cv#1', sourceKind: 'resume', limits: '', suggestedProof: [], status },
    });

  it('последний разговор: реплики по порядку, служебные строки скрыты, ждущие карточки в конце', async () => {
    const old = await prisma.conversation.create({ data: { candidateId: 'a', updatedAt: new Date('2026-01-01') } });
    await prisma.message.create({ data: { conversationId: old.id, role: 'user', content: 'старое' } });
    const conv = await prisma.conversation.create({ data: { candidateId: 'a' } });
    await prisma.message.createMany({
      data: [
        { conversationId: conv.id, role: 'user', content: 'привет', createdAt: new Date('2026-02-01T10:00:00Z') },
        { conversationId: conv.id, role: 'assistant', content: '', createdAt: new Date('2026-02-01T10:00:01Z') },
        { conversationId: conv.id, role: 'tool', content: 'сырой tool', createdAt: new Date('2026-02-01T10:00:02Z') },
        { conversationId: conv.id, role: 'assistant', content: 'здравствуйте', createdAt: new Date('2026-02-01T10:00:03Z') },
      ],
    });
    const pending = await claim('a', 'proposed');
    const r = await loadLastChat('a');
    expect(r.conversationId).toBe(conv.id);
    expect(r.items.map((i) => (i.role === 'user' ? i.text : i.event.type))).toEqual(['привет', 'message', 'claims']);
    const ev = r.items.at(-1);
    expect(ev && ev.role === 'agent' && ev.event.type === 'claims' && (ev.event.proposed[0] as { id: string; status: string })).toMatchObject({ id: pending.id, status: 'proposed' });
  });

  it('подтверждённые не возвращаются карточкой; чужие разговоры и карточки не видны', async () => {
    await claim('a', 'confirmed');
    const other = await prisma.conversation.create({ data: { candidateId: 'b' } });
    await prisma.message.create({ data: { conversationId: other.id, role: 'user', content: 'секрет b' } });
    await claim('b', 'proposed');
    const r = await loadLastChat('a');
    expect(r).toEqual({ conversationId: null, items: [] });
  });
});
