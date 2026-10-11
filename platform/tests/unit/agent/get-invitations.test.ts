import { getInvitations } from '@/server/agent/tools/get_invitations';
import type { ToolContext } from '@/server/agent/types';

const db = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: { invitation: { findMany: db.findMany, count: db.count } } }));

type Where = { candidateId: string; status?: string | { in: string[] } };

const ROWS = [
  { id: 'i-sent', status: 'sent' },
  { id: 'i-viewed', status: 'viewed' },
  { id: 'i-accepted', status: 'accepted' },
  { id: 'i-declined', status: 'declined' },
].map((r) => ({
  ...r,
  salaryFrom: 200_000,
  salaryTo: 260_000,
  message: null,
  createdAt: new Date('2026-10-11T10:00:00.000Z'),
  company: { name: 'Тест-Банк', contact: 'hr@example.test' },
  vacancy: null,
}));

const matches = (w: Where) => (r: { status: string }) => w.status === undefined || (typeof w.status === 'string' ? r.status === w.status : w.status.in.includes(r.status));

const ctx = { candidateId: 'c1', conversationId: 'conv', emit: () => undefined } as unknown as ToolContext;
const run = (args: unknown = {}) => getInvitations.handler(ctx, getInvitations.input.parse(args));

beforeEach(() => {
  vi.resetAllMocks();
  db.findMany.mockImplementation(async ({ where }: { where: Where }) => ROWS.filter(matches(where)));
  db.count.mockImplementation(async ({ where }: { where: Where }) => ROWS.filter(matches(where)).length);
});

describe('get_invitations: «ждут ответа» - отправленные и уже открытые', () => {
  it('по умолчанию отдаёт и sent, и viewed; счётчик pending совпадает с путём кандидата', async () => {
    const r = await run();
    expect(r.invitations.map((i) => i.invitationId)).toEqual(['i-sent', 'i-viewed']);
    expect(r.pending).toBe(2);
    expect(db.findMany.mock.calls[0]?.[0].where).toEqual({ candidateId: 'c1', status: { in: ['sent', 'viewed'] } });
    expect(db.count.mock.calls[0]?.[0].where).toEqual({ candidateId: 'c1', status: { in: ['sent', 'viewed'] } });
  });

  it('открытое приглашение не пропадает из выдачи: осталось только viewed', async () => {
    db.findMany.mockImplementation(async ({ where }: { where: Where }) => ROWS.filter((r) => r.id === 'i-viewed').filter(matches(where)));
    db.count.mockImplementation(async ({ where }: { where: Where }) => ROWS.filter((r) => r.id === 'i-viewed').filter(matches(where)).length);
    const r = await run();
    expect(r.invitations.map((i) => i.status)).toEqual(['viewed']);
    expect(r.pending).toBe(1);
  });

  it('явный статус фильтрует точно, all - без фильтра; pending в счётчике от фильтра не зависит', async () => {
    expect((await run({ status: 'sent' })).invitations.map((i) => i.invitationId)).toEqual(['i-sent']);
    const accepted = await run({ status: 'accepted' });
    expect(accepted.invitations.map((i) => i.invitationId)).toEqual(['i-accepted']);
    expect(accepted.pending).toBe(2);
    expect((await run({ status: 'all' })).invitations).toHaveLength(4);
    expect(db.findMany.mock.calls.at(-1)?.[0].where).toEqual({ candidateId: 'c1' });
  });

  it('способ связи компании в выдаче есть (виден до принятия)', async () => {
    expect((await run()).invitations[0]?.companyContact).toBe('hr@example.test');
  });
});
