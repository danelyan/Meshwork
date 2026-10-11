import { DELETE as del, PATCH as patch } from '@/app/api/consultant/memory/[id]/route';
import { GET as list, POST as add } from '@/app/api/consultant/memory/route';
import { GET as asideGet } from '@/app/api/consultant/aside/route';
import { CONSENT_VERSION } from '@/server/auth/consent';
import { MEMORY_LIMIT, rememberFromTurn, scheduleMemoryExtraction } from '@/server/consultant/memory';
import type { CompleteResult, LlmProvider } from '@/server/llm/types';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const cand = (n: string) => `cid=${signUserSession({ userId: `u-${n}`, role: 'candidate', candidateId: `c-${n}` })}`;
const EMP = `cid=${signUserSession({ userId: 'u-emp', role: 'employer', employerProfileId: 'p-emp' })}`;
const A = cand('a');
const B = cand('b');

function fakeLlm(facts: string[]): LlmProvider & { calls: number } {
  const llm = {
    name: 'fake',
    model: 'fake',
    supportsTools: true,
    supportsJsonSchema: true,
    calls: 0,
    complete: async (): Promise<CompleteResult> => {
      llm.calls++;
      return { kind: 'json', json: { facts }, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, provider: 'fake', model: 'fake' };
    },
  };
  return llm;
}

describe('память консультанта (БД)', () => {
  beforeAll(async () => {
    await resetDb();
    for (const n of ['a', 'b']) {
      await prisma.candidate.create({ data: { id: `c-${n}`, email: `${n}@x.ru`, name: n } });
      await prisma.user.create({ data: { id: `u-${n}`, name: n, role: 'candidate', candidateId: `c-${n}` } });
    }
    await prisma.consent.create({ data: { userId: 'u-a', version: CONSENT_VERSION } });
    await prisma.company.create({ data: { id: 'co-1', name: 'Компания' } });
    await prisma.user.create({ data: { id: 'u-emp', name: 'emp', role: 'employer' } });
    await prisma.employerProfile.create({ data: { id: 'p-emp', userId: 'u-emp', companyId: 'co-1' } });
    await prisma.consent.create({ data: { userId: 'u-emp', version: CONSENT_VERSION } });
  });
  beforeEach(() => prisma.consultantMemory.deleteMany());
  afterAll(() => prisma.$disconnect());

  it('CRUD своих пунктов; чужой – 404; без входа – 401', async () => {
    const created = await add(jsonRequest('/x', 'POST', { text: '  Живёт\nв Казани ' }, A));
    expect(created.status).toBe(201);
    const { item } = await created.json();
    expect(item).toMatchObject({ text: 'Живёт в Казани', source: 'user' });

    expect((await (await list(jsonRequest('/x', 'GET', undefined, B))).json()).items).toEqual([]);
    expect((await patch(jsonRequest('/x', 'PATCH', { text: 'взлом' }, B), params(item.id))).status).toBe(404);
    expect((await del(jsonRequest('/x', 'DELETE', undefined, B), params(item.id))).status).toBe(404);
    expect((await list(jsonRequest('/x', 'GET'))).status).toBe(401);

    const edited = await patch(jsonRequest('/x', 'PATCH', { text: 'Живёт в Москве' }, A), params(item.id));
    expect((await edited.json()).item.text).toBe('Живёт в Москве');
    const mine = await (await list(jsonRequest('/x', 'GET', undefined, A))).json();
    expect(mine).toMatchObject({ limit: MEMORY_LIMIT, items: [{ id: item.id, text: 'Живёт в Москве' }] });

    expect((await del(jsonRequest('/x', 'DELETE', undefined, A), params(item.id))).status).toBe(204);
    expect(await prisma.consultantMemory.count()).toBe(0);
  });

  it('валидация, дубль и лимит', async () => {
    expect((await add(jsonRequest('/x', 'POST', { text: '' }, A))).status).toBe(400);
    expect((await add(jsonRequest('/x', 'POST', { text: 'x'.repeat(201) }, A))).status).toBe(400);
    expect((await add(jsonRequest('/x', 'POST', { text: 'Пишет на Go' }, A))).status).toBe(201);
    expect((await add(jsonRequest('/x', 'POST', { text: 'пишет на go.' }, A))).status).toBe(409);
    await prisma.consultantMemory.createMany({ data: Array.from({ length: MEMORY_LIMIT - 1 }, (_, i) => ({ candidateId: 'c-a', text: `факт ${i} ${'я'.repeat(i)}`, source: 'chat' as const })) });
    expect((await add(jsonRequest('/x', 'POST', { text: 'Ещё один факт' }, A))).status).toBe(409);
  });

  it('работодатель – своя память, отдельно от кандидата', async () => {
    const r = await add(jsonRequest('/x', 'POST', { text: 'Ищет бэкендеров в платёжную команду' }, EMP));
    expect(r.status).toBe(201);
    expect((await (await list(jsonRequest('/x', 'GET', undefined, A))).json()).items).toEqual([]);
    const row = await prisma.consultantMemory.findFirstOrThrow();
    expect(row).toMatchObject({ employerProfileId: 'p-emp', candidateId: null });
  });

  it('извлечение после хода: факты из чата, без дублей, только с согласием', async () => {
    await prisma.consultantMemory.create({ data: { candidateId: 'c-a', text: 'Пишет на Go', source: 'user' } });
    const llm = fakeLlm(['пишет на Go', 'Хочет перейти в финтех', 'Ищет удалёнку', 'Лишний четвёртый факт']);
    const saved = await scheduleMemoryExtraction({ owner: { candidateId: 'c-a' }, text: 'Я пишу на Go и хочу в финтех, только удалённо', llm, dailyTokenBudget: 0 });
    expect(saved).toEqual(['Хочет перейти в финтех', 'Ищет удалёнку', 'Лишний четвёртый факт']);
    const rows = await prisma.consultantMemory.findMany({ where: { candidateId: 'c-a', source: 'chat' } });
    expect(rows.map((r) => r.text).sort()).toEqual(['Ищет удалёнку', 'Лишний четвёртый факт', 'Хочет перейти в финтех']);

    // нет согласия – модель не вызывается
    const noConsent = fakeLlm(['Что-то']);
    expect(await rememberFromTurn({ owner: { candidateId: 'c-b' }, text: 'Я пишу на Python уже три года', llm: noConsent, dailyTokenBudget: 0 })).toEqual([]);
    expect(noConsent.calls).toBe(0);
    // короткая реплика – тоже
    const short = fakeLlm(['Что-то']);
    expect(await rememberFromTurn({ owner: { candidateId: 'c-a' }, text: 'ок', llm: short, dailyTokenBudget: 0 })).toEqual([]);
    expect(short.calls).toBe(0);
  });

  it('сбой модели – молча, ничего не сохранено', async () => {
    const broken: LlmProvider = { name: 'x', model: 'x', supportsTools: true, supportsJsonSchema: true, complete: async () => Promise.reject(new Error('boom')) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await scheduleMemoryExtraction({ owner: { candidateId: 'c-a' }, text: 'Я пишу на Go и хочу в финтех', llm: broken, dailyTokenBudget: 0 })).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(await prisma.consultantMemory.count()).toBe(0);
  });

  it('колонка сцены: знакомство + память с источником и id', async () => {
    await prisma.consultantMemory.create({ data: { candidateId: 'c-a', text: 'Хочет в финтех', source: 'chat' } });
    const res = await asideGet(jsonRequest('/x', 'GET', undefined, A));
    const data = await res.json();
    expect(data.memoryLimit).toBe(MEMORY_LIMIT);
    expect(data.memoryPending).toBe(false);
    expect(data.known.filter((k: { source: string }) => k.source !== 'onboarding')).toMatchObject([{ source: 'chat', value: 'Хочет в финтех', editable: true }]);
  });
});
