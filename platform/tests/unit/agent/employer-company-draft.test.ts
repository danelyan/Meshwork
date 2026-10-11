import { dispatchToolCall } from '@/server/agent/dispatch';
import { loadLastEmployerChat } from '@/server/agent/employer/restore';
import { employerTools } from '@/server/agent/employer/tools';
import type { EmployerAgentEvent, EmployerToolContext } from '@/server/agent/employer/types';

const db = vi.hoisted(() => ({
  company: { findUnique: vi.fn() },
  employerConversation: { findFirst: vi.fn() },
  employerMessage: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

const CURRENT = { id: 'co1', name: 'Рога', description: 'Разрабатываем сервисы для логистики и склада', industry: 'Логистика', inn: null, contact: 'hr@roga.ru' };

function setup() {
  const events: EmployerAgentEvent[] = [];
  const ctx: EmployerToolContext = { employerProfileId: 'p1', companyId: 'co1', conversationId: 'c1', emit: (e) => events.push(e), llm: {} as EmployerToolContext['llm'] };
  return { events, ctx };
}
const call = (ctx: EmployerToolContext, args: Record<string, unknown>) => dispatchToolCall(employerTools, ctx, { id: 'x', name: 'draft_company_profile', arguments: { rationale: 'работодатель попросил', ...args } });

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findUnique.mockResolvedValue(CURRENT);
});

describe('draft_company_profile', () => {
  it('изменённые поля → событие company_draft и результат; не изменённые — null', async () => {
    const { events, ctx } = setup();
    const r = await call(ctx, { industry: 'Финтех', description: 'Строим платёжные сервисы для малого бизнеса', name: 'Рога' });
    expect(r.errorCode).toBeUndefined();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'company_draft',
      draft: {
        name: null,
        industry: 'Финтех',
        description: 'Строим платёжные сервисы для малого бизнеса',
        contact: null,
        current: { name: 'Рога', industry: 'Логистика', description: CURRENT.description, contact: 'hr@roga.ru' },
        rationale: 'работодатель попросил',
      },
    });
    expect(r.output).toMatchObject({ drafted: true, industry: 'Финтех' });
    expect(db.company.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'co1' } }));
  });

  it('значения совпадают с текущими → «Изменений нет», события нет', async () => {
    const { events, ctx } = setup();
    const r = await call(ctx, { name: 'Рога', industry: 'Логистика' });
    expect(r.errorCode).toBe('tool_failed');
    expect(r.content).toContain('Изменений нет');
    expect(events).toEqual([]);
  });

  it('ни одного поля → «Изменений нет»', async () => {
    const { events, ctx } = setup();
    const r = await call(ctx, {});
    expect(r.content).toContain('Изменений нет');
    expect(events).toEqual([]);
  });

  it('описание длиннее 600 (лимит PATCH) → ошибка валидации, события нет', async () => {
    const { events, ctx } = setup();
    const r = await call(ctx, { description: 'я'.repeat(601) });
    expect(r.errorCode).toBe('tool_failed');
    expect(r.content).toContain('600');
    expect(events).toEqual([]);
  });

  it('контакт неверного формата → ошибка, события нет', async () => {
    const { events, ctx } = setup();
    const r = await call(ctx, { contact: 'звоните мне' });
    expect(r.errorCode).toBe('tool_failed');
    expect(events).toEqual([]);
  });
});

describe('восстановление ленты: company_draft и project_task_draft', () => {
  it('черновики поднимаются из результатов инструментов без служебных флагов', async () => {
    const company = { drafted: true, name: null, industry: 'Финтех', description: null, contact: null, current: { name: 'Рога', industry: null, description: null, contact: null }, rationale: 'r' };
    const task = { vacancyId: 'v1', vacancyTitle: 'Backend', templateId: 't1', templateTitle: 'API', criteria: [], wishes: '', visibility: 'feed', replacesExisting: false, rationale: 'r', drafted: true };
    db.employerConversation.findFirst.mockResolvedValue({ id: 'c1' });
    db.employerMessage.findMany.mockResolvedValue([
      { id: 'm1', role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'draft_company_profile', arguments: {} }, { id: 'b', name: 'create_project_task_draft', arguments: {} }], toolCallId: null },
      { id: 'm2', role: 'tool', content: JSON.stringify(company), toolCalls: null, toolCallId: 'a' },
      { id: 'm3', role: 'tool', content: JSON.stringify(task), toolCalls: null, toolCallId: 'b' },
      { id: 'm4', role: 'tool', content: JSON.stringify({ error: 'x' }), toolCalls: null, toolCallId: 'a' },
    ]);
    const { items } = await loadLastEmployerChat('p1');
    expect(items).toHaveLength(2);
    const [a, b] = items;
    expect(a).toMatchObject({ role: 'agent', event: { type: 'company_draft', draft: { industry: 'Финтех', rationale: 'r' } } });
    expect(a && a.role === 'agent' && 'drafted' in (a.event as { draft: object }).draft).toBe(false);
    expect(b).toMatchObject({ role: 'agent', event: { type: 'project_task_draft', draft: { vacancyId: 'v1', visibility: 'feed' } } });
    expect(b && b.role === 'agent' && 'drafted' in (b.event as { draft: object }).draft).toBe(false);
  });
});
