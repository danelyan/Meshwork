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
import { discloseAccepted } from '../../helpers/consents';

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
  // Формулировки каталога публичны: демо-резюме дословно повторяют их (строка резюме = statement + точка),
  // поэтому такая «цитата» не секрет кандидата, а общий текст каталога (он законно есть в выдаче).
  const catalog = new Set((await prisma.claimCatalog.findMany({ select: { statement: true } })).map((e) => e.statement.replace(/\.$/, '')));
  const out = new Set<string>();
  for (const c of cands) {
    out.add(c.name);
    out.add(c.email);
    for (const q of c.claims) if (q.quote.length > 12 && !catalog.has(q.quote.replace(/\.$/, ''))) out.add(q.quote);
  }
  return [...out];
}

describe('помощник работодателя (БД)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    // Роль аккаунта совпадает с ролью куки (ADR 0004: иначе кука протухшая).
    await prisma.user.createMany({ data: [{ id: 'u-c', name: 'Кандидат', role: 'candidate' }], skipDuplicates: true });
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
    // Демо-цитаты иногда совпадают с публичной формулировкой каталога. Отделяем
    // приватный текст источника, чтобы проверка ловила утечку, а не название навыка.
    const claims = await prisma.claim.findMany({ select: { id: true, quote: true } });
    for (const claim of claims) {
      await prisma.claim.update({ where: { id: claim.id }, data: { quote: `Private fixture quote ${claim.id}: ${claim.quote}` } });
    }
    await prisma.candidate.updateMany({ data: { hiddenFromEmployers: false } });
  });
  afterAll(async () => {
    process.env.LLM_STUB_DEMO = 'false';
    resetEnvCache();
    await prisma.$disconnect();
  });

  it('граница приватности: выдача и разбор без имён, почт и цитат – и до, и после принятия приглашения', async () => {
    const pay = DEMO_POOL[0]!;
    await prisma.invitation.create({
      data: { companyId: COMPANY, employerProfileId: PROFILE, candidateId: pay.id, vacancyId: PAY_VAC, message: 'Платёжная команда', salaryFrom: 230000, salaryTo: 230000, status: 'accepted' },
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

  it('черновик приглашения не отправляет; лимит 20/сутки – сообщает, не обходит', async () => {
    const pay = DEMO_POOL[0]!;
    const d = (await tool('draft_invitation').handler(ctx(), { candidateId: pay.id, vacancyId: PAY_VAC })) as InvitationDraft & { sent: false };
    expect(d).toMatchObject({ blocked: null, sent: false, vacancyId: PAY_VAC, limit: { sent: 0, limit: 20, left: 20 } });
    expect(d.salaryFrom).toBeGreaterThan(0);
    expect(d.salaryTo).toBeGreaterThanOrEqual(d.salaryFrom!);
    expect(await prisma.invitation.count()).toBe(0);
    const others = DEMO_POOL.slice(1);
    for (let i = 0; i < 20; i++) {
      await prisma.invitation.create({
        data: { companyId: COMPANY, employerProfileId: PROFILE, candidateId: others[i % others.length]!.id, message: 'm', salaryFrom: 1, salaryTo: 1, status: 'declined' },
      });
    }
    const d2 = (await tool('draft_invitation').handler(ctx(), { candidateId: pay.id, vacancyId: PAY_VAC })) as InvitationDraft;
    expect(d2.blocked).toBe('daily_limit');
    expect(d2.limit.left).toBe(0);
  });

  it('чужая потребность – 404; несколько активных без id – ошибка со списком для уточнения', async () => {
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

  it('цикл с моделью (stub): инструменты помощника, purpose employer_assistant; кандидатский инструмент – unknown_tool', async () => {
    const purposes: string[] = [];
    registerStubResponse('employer_assistant', (req) => {
      purposes.push(req.purpose);
      const last = req.messages.at(-1);
      if (last?.role === 'user') return { kind: 'tool_calls', toolCalls: [{ id: 't1', name: 'get_profile', arguments: {} }, { id: 't2', name: 'match_for_need', arguments: { vacancyId: PAY_VAC, limit: 3 } }] };
      return { kind: 'text', text: 'Под потребность нашлись кандидаты – карточки ниже.' };
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

  it('демо: несколько потребностей и нет подсказки – вопрос с вариантами, а не первая попавшаяся; ответ вариантом – подборка', async () => {
    process.env.LLM_STUB_DEMO = 'true';
    resetEnvCache();
    const conv = await conversation();
    const a = await turn('Подбери под мою потребность', conv);
    const ask = a.events.find((e) => e.type === 'ask') as { options: string[] } | undefined;
    expect(ask?.options).toHaveLength(3);
    expect(a.events.some((e) => e.type === 'candidates')).toBe(false);
    const pay = ask!.options.find((o) => /платеж/i.test(o))!;
    const b = await turn(pay, conv);
    expect((b.events.find((e) => e.type === 'candidates') as { block: CandidatesBlock }).block.vacancy?.id).toBe(PAY_VAC);
  });

  it('имя принявшего: в ленте (SSE и восстановление) только у принявшего, в модель и её историю не уходит никогда', async () => {
    const pay = DEMO_POOL[0]!;
    const other = DEMO_POOL.find((p) => p.id !== pay.id && p.specialization === 'backend')!;
    const modelSaw: string[] = [];
    registerStubResponse('employer_assistant', (req) => {
      modelSaw.push(JSON.stringify(req.messages));
      const last = req.messages.at(-1);
      if (last?.role === 'user') return { kind: 'tool_calls', toolCalls: [{ id: 't2', name: 'match_for_need', arguments: { vacancyId: PAY_VAC, limit: 10 } }] };
      return { kind: 'text', text: 'Карточки ниже.' };
    });
    const emp = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: PROFILE })}`;
    const run = async () => {
      const res = await assistantPost(jsonRequest('/x', 'POST', { text: 'Подбери под Backend платежей' }, emp));
      return res.text();
    };
    const sseNames = (body: string) =>
      body
        .split('\n\n')
        .filter((f) => f.includes('"type":"candidates"'))
        .flatMap((f) => (JSON.parse(f.replace(/^data: /, '')).block.items as { candidateId: string; name?: string }[]).map((i) => [i.candidateId, i.name] as const));

    // до принятия: имени нет ни у кого
    const before = await run();
    expect(sseNames(before).length).toBeGreaterThan(0);
    expect(sseNames(before).every(([, n]) => n === undefined)).toBe(true);
    expect(before).not.toContain(pay.name);

    // приглашение отправлено, но не принято – по-прежнему псевдоним
    const inv = await prisma.invitation.create({
      data: { companyId: COMPANY, employerProfileId: PROFILE, candidateId: pay.id, vacancyId: PAY_VAC, message: 'Платёжная команда', salaryFrom: 230000, salaryTo: 230000, status: 'sent' },
    });
    expect(await run()).not.toContain(pay.name);

    // принято: имя только у принявшего
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: 'accepted' } });
    await discloseAccepted(); // Г5 (ADR 0005)
    const after = await run();
    const names = new Map(sseNames(after));
    expect(names.get(pay.id)).toBe(pay.name);
    expect(names.has(other.id) ? names.get(other.id) : undefined).toBeUndefined();
    expect(after).not.toContain(other.name);
    expect(after).not.toContain(`${pay.id}@example.test`);

    // восстановление ленты – то же правило
    const restored = await loadLastEmployerChat(PROFILE);
    const cards = restored.items.flatMap((i) => (i.role === 'agent' && i.event.type === 'candidates' ? i.event.block.items : []));
    expect(cards.find((c) => c.candidateId === pay.id)?.name).toBe(pay.name);
    expect(cards.filter((c) => c.candidateId !== pay.id).every((c) => c.name === undefined)).toBe(true);

    // граница: ни запросы к модели, ни её история в БД имени не содержат
    const history = JSON.stringify((await prisma.employerMessage.findMany({ select: { content: true, toolCalls: true } })));
    for (const secret of await secrets()) {
      expect(history, secret).not.toContain(secret);
      expect(modelSaw.join('\n'), secret).not.toContain(secret);
    }
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
