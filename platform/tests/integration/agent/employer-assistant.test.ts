import { POST as assistantPost } from '@/app/api/employer/assistant/messages/route';
import { runEmployerTurn } from '@/server/agent/employer/loop';
import { loadLastEmployerChat } from '@/server/agent/employer/restore';
import { employerTools } from '@/server/agent/employer/tools';
import type { CandidatesBlock, EmployerAgentEvent, EmployerToolContext, InvitationDraft } from '@/server/agent/employer/types';
import { resetEnvCache } from '@/server/env';
import { resetLlmClient } from '@/server/llm/client';
import { clearStubResponses, registerStubResponse } from '@/server/llm/providers/stub';
import { signUserSession } from '@/server/session';

import { DEMO_EMPLOYER, seedAuth } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { DEMO_POOL, seedEmployer } from '../../../prisma/seed/employer';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const PROFILE = DEMO_EMPLOYER.profileId;
const COMPANY = DEMO_EMPLOYER.companyId;
const PAY_VAC = 'demo-vac-be-m-1';

async function conversation(profileId = PROFILE) {
  return (await prisma.employerConversation.create({ data: { employerProfileId: profileId } })).id;
}

async function turn(text: string, conversationId: string, opts = {}) {
  const events: EmployerAgentEvent[] = [];
  await runEmployerTurn({ employerProfileId: PROFILE, conversationId, text }, (e) => events.push(e), undefined, opts);
  const msg = events.filter((e) => e.type === 'message').at(-1) as { text: string } | undefined;
  return { events, text: msg?.text ?? '' };
}

function ctx(events: EmployerAgentEvent[] = []): EmployerToolContext {
  return { employerProfileId: PROFILE, companyId: COMPANY, conversationId: 'c', emit: (e) => events.push(e), llm: {} as EmployerToolContext['llm'] };
}
const tool = (name: string) => employerTools.find((t) => t.name === name)!;

/** Всё, что работодатель не должен узнать до принятия: имена, почты, цитаты кандидатов пула. */
async function secrets(): Promise<string[]> {
  const cands = await prisma.candidate.findMany({ select: { name: true, email: true, claims: { select: { quote: true } } } });
  const out = new Set<string>();
  for (const c of cands) {
    out.add(c.name);
    out.add(c.email);
    for (const q of c.claims) if (q.quote.length > 12) out.add(q.quote);
  }
  return [...out];
}

describe('помощник работодателя (БД)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
  });
  beforeEach(async () => {
    process.env.LLM_PROVIDER = 'stub';
    process.env.LLM_STUB_DEMO = 'false';
    resetEnvCache();
    resetLlmClient();
    clearStubResponses();
    await prisma.employerConversation.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.vacancy.deleteMany();
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
    await prisma.candidate.updateMany({ data: { hiddenFromEmployers: false } });
  });
  afterAll(async () => {
    process.env.LLM_STUB_DEMO = 'false';
    resetEnvCache();
    await prisma.$disconnect();
  });

  it('граница приватности: выдача и разбор без имён, почт и цитат — и до, и после принятия приглашения', async () => {
    const pay = DEMO_POOL[0]!;
    await prisma.invitation.create({
      data: { companyId: COMPANY, employerProfileId: PROFILE, candidateId: pay.id, vacancyId: PAY_VAC, message: 'Платёжная команда', salaryOffer: 230000, status: 'accepted' },
    });
    const events: EmployerAgentEvent[] = [];
    const match = (await tool('match_for_need').handler(ctx(events), { vacancyId: PAY_VAC, limit: 10 })) as CandidatesBlock;
    const search = await tool('search_candidates').handler(ctx(events), { limit: 10 });
    const explain = await tool('explain_candidate').handler(ctx(events), { candidateId: pay.id, vacancyId: PAY_VAC });
    expect(match.items.find((i) => i.candidateId === pay.id)?.invitation).toBe('accepted');
    const blob = JSON.stringify([match, search, explain, events]);
    const leaked = (await secrets()).filter((s) => blob.includes(s));
    expect(leaked).toEqual([]);
    expect(blob).not.toMatch(/"(quote|contacts|email|displayName)"/);
    expect(tool('match_for_need').output.safeParse(match).success).toBe(true);
  });

  it('скрытый настройкой приватности кандидат не виден ни в выдаче, ни в разборе, ни в черновике', async () => {
    const pay = DEMO_POOL[0]!;
    await prisma.candidate.update({ where: { id: pay.id }, data: { hiddenFromEmployers: true } });
    const match = (await tool('match_for_need').handler(ctx(), { vacancyId: PAY_VAC, limit: 10 })) as CandidatesBlock;
    expect(match.items.map((i) => i.candidateId)).not.toContain(pay.id);
    const ex = (await tool('explain_candidate').handler(ctx(), { candidateId: pay.id, vacancyId: PAY_VAC })) as { inSelection: boolean };
    expect(ex.inSelection).toBe(false);
    await expect(tool('draft_invitation').handler(ctx(), { candidateId: pay.id })).rejects.toMatchObject({ status: 404 });
  });

  it('черновик приглашения не отправляет; лимит 20/сутки — сообщает, не обходит', async () => {
    const pay = DEMO_POOL[0]!;
    const d = (await tool('draft_invitation').handler(ctx(), { candidateId: pay.id, vacancyId: PAY_VAC })) as InvitationDraft & { sent: false };
    expect(d).toMatchObject({ blocked: null, sent: false, vacancyId: PAY_VAC, limit: { sent: 0, limit: 20, left: 20 } });
    expect(d.salaryOffer).toBeGreaterThan(0);
    expect(await prisma.invitation.count()).toBe(0);
    const others = DEMO_POOL.slice(1);
    for (let i = 0; i < 20; i++) {
      await prisma.invitation.create({
        data: { companyId: COMPANY, employerProfileId: PROFILE, candidateId: others[i % others.length]!.id, message: 'm', salaryOffer: 1, status: 'declined' },
      });
    }
    const d2 = (await tool('draft_invitation').handler(ctx(), { candidateId: pay.id, vacancyId: PAY_VAC })) as InvitationDraft;
    expect(d2.blocked).toBe('daily_limit');
    expect(d2.limit.left).toBe(0);
  });

  it('чужая потребность — 404; несколько активных без id — ошибка со списком для уточнения', async () => {
    await expect(tool('match_for_need').handler({ ...ctx(), companyId: 'co-other' }, { vacancyId: PAY_VAC, limit: 5 })).rejects.toMatchObject({ status: 404 });
    await expect(tool('match_for_need').handler(ctx(), { limit: 5 })).rejects.toMatchObject({ status: 400, message: expect.stringContaining(PAY_VAC) });
  });

  it('черновик потребности: требования из каталога, ссылка на форму, ничего не сохраняется', async () => {
    const before = await prisma.vacancy.count();
    const d = (await tool('create_need_draft').handler(ctx(), { description: 'Нужен бэкенд мидл на Go и Kafka, 200–260 тыс' })) as { needs: unknown[]; formHref: string; specialization: string; grade: string; stack: string[] };
    expect(d).toMatchObject({ specialization: 'backend', grade: 'middle', stack: ['Go', 'Kafka'] });
    expect(d.needs.length).toBeGreaterThan(0);
    expect(d.formHref).toMatch(/^\/employer\/needs\/new\?/);
    expect(await prisma.vacancy.count()).toBe(before);
  });

  it('цикл с моделью (stub): инструменты помощника, purpose employer_assistant; кандидатский инструмент — unknown_tool', async () => {
    const purposes: string[] = [];
    registerStubResponse('employer_assistant', (req) => {
      purposes.push(req.purpose);
      const last = req.messages.at(-1);
      if (last?.role === 'user') return { kind: 'tool_calls', toolCalls: [{ id: 't1', name: 'get_profile', arguments: {} }, { id: 't2', name: 'match_for_need', arguments: { vacancyId: PAY_VAC, limit: 3 } }] };
      return { kind: 'text', text: 'Под потребность нашлись кандидаты — карточки ниже.' };
    });
    const conv = await conversation();
    const { events, text } = await turn('Подбери под Backend платежей', conv);
    expect(text).toContain('карточки ниже');
    expect(events.find((e) => e.type === 'candidates')).toBeDefined();
    const tools = await prisma.employerMessage.findMany({ where: { conversationId: conv, role: 'tool' }, orderBy: { createdAt: 'asc' } });
    expect(JSON.parse(tools[0]!.content).error.code).toBe('unknown_tool');
    expect(purposes.every((p) => p === 'employer_assistant')).toBe(true);
    // кандидатские таблицы не тронуты
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.conversation.count()).toBe(0);
  });

  it('модель недоступна → шаг и ответ по данным платформы (план В на тех же инструментах)', async () => {
    const conv = await conversation();
    const { events, text } = await turn('Подбери под мою потребность Backend Middle [[error 503]]', conv);
    expect(events.some((e) => e.type === 'step')).toBe(true);
    expect(events.find((e) => e.type === 'candidates')).toBeDefined();
    expect(text).toMatch(/нашлось \d+/);
  });

  it('чужой разговор → 404, ничего не пишется', async () => {
    await prisma.user.upsert({ where: { id: 'u-o' }, update: {}, create: { id: 'u-o', name: 'Чужой', role: 'employer' } });
    await prisma.company.upsert({ where: { id: 'co-o' }, update: {}, create: { id: 'co-o', name: 'Другая', isDemo: false } });
    await prisma.employerProfile.upsert({ where: { userId: 'u-o' }, update: {}, create: { id: 'p-o', userId: 'u-o', companyId: 'co-o' } });
    const foreign = await conversation('p-o');
    await expect(turn('привет', foreign)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.employerMessage.count()).toBe(0);
  });

  it('демо без модели: подборка → «пригласи первого» → «почему #…»; восстановление ленты', async () => {
    process.env.LLM_STUB_DEMO = 'true';
    resetEnvCache();
    const conv = await conversation();
    const a = await turn('Подбери под мою потребность Backend Middle', conv);
    const block = (a.events.find((e) => e.type === 'candidates') as { block: CandidatesBlock }).block;
    expect(block.vacancy?.id).toBe(PAY_VAC);
    expect(block.items.length).toBeGreaterThan(0);
    expect(a.text).toContain('Пригласить');

    const b = await turn('Пригласи первого', conv);
    const draft = (b.events.find((e) => e.type === 'invitation_draft') as { draft: InvitationDraft }).draft;
    expect(draft.candidateId).toBe(block.items[0]!.candidateId);
    expect(b.text).toContain('отправляешь ты');
    expect(await prisma.invitation.count()).toBe(0);

    const alias = block.items[0]!.alias.replace('Кандидат ', '');
    const c = await turn(`Почему ${alias} первый?`, conv);
    expect(c.text).toContain('Балл: покрытие');

    const restored = await loadLastEmployerChat(PROFILE);
    expect(restored.conversationId).toBe(conv);
    const kinds = restored.items.map((i) => (i.role === 'user' ? 'user' : i.event.type));
    expect(kinds).toEqual(['user', 'candidates', 'message', 'user', 'invitation_draft', 'message', 'user', 'message']);
  });

  it('API: только работодатель (401/403), SSE c conversation и done', async () => {
    expect((await assistantPost(jsonRequest('/x', 'POST', { text: 'привет' }))).status).toBe(401);
    const cand = `cid=${signUserSession({ userId: 'u-c', role: 'candidate', candidateId: DEMO_POOL[0]!.id })}`;
    expect((await assistantPost(jsonRequest('/x', 'POST', { text: 'привет' }, cand))).status).toBe(403);
    process.env.LLM_STUB_DEMO = 'true';
    resetEnvCache();
    const emp = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: PROFILE })}`;
    const res = await assistantPost(jsonRequest('/x', 'POST', { text: 'что у меня есть?' }, emp));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('"type":"conversation"');
    expect(body).toContain('"type":"done"');
    expect(body).toContain('Приглашений на сутки осталось');
  });
});
