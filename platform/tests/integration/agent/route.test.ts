vi.mock('@/server/claims', async () => (await import('./mocks')).claimsMock);
vi.mock('@/server/collector', async () => (await import('./mocks')).collectorMock);
vi.mock('@/server/recommend', async () => (await import('./mocks')).recommendMock);

import { GET as getConversation } from '@/app/api/consultant/conversations/[id]/route';
import { GET as listConversations } from '@/app/api/consultant/conversations/route';
import { POST } from '@/app/api/consultant/messages/route';
import { decodeSse } from '@/server/agent/events';
import type { AgentEvent } from '@/server/agent/types';
import { resetLlmClient } from '@/server/llm/client';
import { clearStubResponses } from '@/server/llm/providers/stub';
import { signSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';
import { resetMocks, seedCandidate, seedCatalog } from './mocks';

const CAND = 'cand-a';
const OTHER = 'cand-b';
const cookie = (id: string) => `cid=${signSession(id)}`;

async function readAll(res: Response): Promise<AgentEvent[]> {
  const text = await res.text();
  const { events, rest } = decodeSse(text);
  expect(rest).toBe('');
  return events;
}

describe('POST /api/consultant/messages (SSE)', () => {
  beforeEach(async () => {
    await resetDb();
    resetLlmClient();
    clearStubResponses();
    resetMocks();
    await seedCatalog();
    await seedCandidate(CAND);
    await seedCandidate(OTHER, 'Б');
  });
  afterAll(() => prisma.$disconnect());

  it('без куки → 401; пустое тело → 400 validation_failed; плохой URL → 400', async () => {
    expect((await POST(jsonRequest('/api/consultant/messages', 'POST', { text: 'x' }))).status).toBe(401);
    const empty = await POST(jsonRequest('/api/consultant/messages', 'POST', { text: '   ' }, cookie(CAND)));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.code).toBe('validation_failed');
    const badUrl = await POST(jsonRequest('/api/consultant/messages', 'POST', { text: 'x', urls: ['not a url'] }, cookie(CAND)));
    expect(badUrl.status).toBe(400);
  });

  it('новый разговор: заголовки SSE, первый кадр conversation, последний — done, Message сохранены', async () => {
    const res = await POST(jsonRequest('/api/consultant/messages', 'POST', { text: 'Привет [[reply Привет! Пришли резюме.]]' }, cookie(CAND)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const convId = res.headers.get('x-conversation-id');
    expect(convId).toBeTruthy();
    const events = await readAll(res);
    expect(events[0]).toEqual({ type: 'conversation', id: convId });
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(events.find((e) => e.type === 'message')).toEqual({ type: 'message', text: 'Привет! Пришли резюме.' });
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: convId! } });
    expect(conv.candidateId).toBe(CAND);
    expect(conv.title).toContain('Привет');
    expect(await prisma.message.count({ where: { conversationId: convId!, role: { in: ['user', 'assistant'] } } })).toBe(2);
  });

  it('продолжение разговора — тем же id; чужой id → 404', async () => {
    const first = await POST(jsonRequest('/api/consultant/messages', 'POST', { text: '[[reply раз]]' }, cookie(CAND)));
    const convId = first.headers.get('x-conversation-id')!;
    await readAll(first);
    const second = await POST(jsonRequest('/api/consultant/messages', 'POST', { conversationId: convId, text: '[[reply два]]' }, cookie(CAND)));
    expect(second.headers.get('x-conversation-id')).toBe(convId);
    await readAll(second);
    expect(await prisma.conversation.count()).toBe(1);
    const foreign = await POST(jsonRequest('/api/consultant/messages', 'POST', { conversationId: convId, text: 'x' }, cookie(OTHER)));
    expect(foreign.status).toBe(404);
  });

  it('два одновременных хода в одном разговоре → второй 409 busy; после окончания — снова можно', async () => {
    const conv = await prisma.conversation.create({ data: { candidateId: CAND } });
    const slow = await POST(jsonRequest('/api/consultant/messages', 'POST', { conversationId: conv.id, text: '[[delay 400]] [[reply медленно]]' }, cookie(CAND)));
    expect(slow.status).toBe(200);
    const busy = await POST(jsonRequest('/api/consultant/messages', 'POST', { conversationId: conv.id, text: 'ещё' }, cookie(CAND)));
    expect(busy.status).toBe(409);
    expect((await busy.json()).error.code).toBe('busy');
    const events = await readAll(slow);
    expect(events.find((e) => e.type === 'message')).toEqual({ type: 'message', text: 'медленно' });
    const after = await POST(jsonRequest('/api/consultant/messages', 'POST', { conversationId: conv.id, text: '[[reply ок]]' }, cookie(CAND)));
    expect(after.status).toBe(200);
    await readAll(after);
    expect(await prisma.message.count({ where: { role: 'user' } })).toBe(2);
  });

  it('разрыв соединения: AbortSignal останавливает ход, lock освобождается', async () => {
    const conv = await prisma.conversation.create({ data: { candidateId: CAND } });
    const ctrl = new AbortController();
    const req = new Request('http://localhost/api/consultant/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie(CAND) },
      body: JSON.stringify({ conversationId: conv.id, text: '[[delay 3000]] [[reply поздно]]' }),
      signal: ctrl.signal,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"conversation"');
    ctrl.abort();
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    const { events } = decodeSse(text);
    expect(events.find((e) => e.type === 'message')).toBeUndefined();
    expect(events.at(-1)).toEqual({ type: 'done' });
    const again = await POST(jsonRequest('/api/consultant/messages', 'POST', { conversationId: conv.id, text: '[[reply ок]]' }, cookie(CAND)));
    expect(again.status).toBe(200);
    await readAll(again);
  });

  it('ошибка модели → step про упрощённый режим и message, поток завершается done', async () => {
    const res = await POST(jsonRequest('/api/consultant/messages', 'POST', { text: 'какой тест? [[error 503 упал]]' }, cookie(CAND)));
    const events = await readAll(res);
    expect(events.some((e) => e.type === 'step' && e.text.includes('упрощённом режиме'))).toBe(true);
    expect((events.find((e) => e.type === 'message') as { text: string }).text).toContain('Категорию даёт только тест');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});

describe('GET /api/consultant/conversations[/id]', () => {
  beforeEach(async () => {
    await resetDb();
    await seedCandidate(CAND);
    await seedCandidate(OTHER, 'Б');
  });
  afterAll(() => prisma.$disconnect());

  it('история только владельцу, без system/tool и пустых assistant; чужой → 404; без куки → 401', async () => {
    const conv = await prisma.conversation.create({ data: { candidateId: CAND, title: 'тест' } });
    await prisma.message.createMany({
      data: [
        { conversationId: conv.id, role: 'system', content: 'prompt:consultant-v1' },
        { conversationId: conv.id, role: 'user', content: 'привет' },
        { conversationId: conv.id, role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_profile', arguments: {} }] },
        { conversationId: conv.id, role: 'tool', content: '{}', toolCallId: 'c1' },
        { conversationId: conv.id, role: 'assistant', content: 'ответ' },
      ],
    });
    const ctx = { params: Promise.resolve({ id: conv.id }) };
    const res = await getConversation(jsonRequest(`/api/consultant/conversations/${conv.id}`, 'GET', undefined, cookie(CAND)), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversation.title).toBe('тест');
    expect(body.messages.map((m: { role: string; content: string }) => [m.role, m.content])).toEqual([
      ['user', 'привет'],
      ['assistant', 'ответ'],
    ]);
    expect((await getConversation(jsonRequest('/x', 'GET', undefined, cookie(OTHER)), ctx)).status).toBe(404);
    expect((await getConversation(jsonRequest('/x', 'GET'), ctx)).status).toBe(401);
    const list = await listConversations(jsonRequest('/api/consultant/conversations', 'GET', undefined, cookie(CAND)));
    expect((await list.json()).conversations.map((c: { id: string }) => c.id)).toEqual([conv.id]);
    const other = await listConversations(jsonRequest('/api/consultant/conversations', 'GET', undefined, cookie(OTHER)));
    expect((await other.json()).conversations).toEqual([]);
  });
});
