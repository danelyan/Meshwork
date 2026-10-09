import { POST as consultant } from '@/app/api/consultant/messages/route';
import { POST as onboarding } from '@/app/api/onboarding/route';
import { buildSystem, runTurn } from '@/server/agent/loop';
import type { PipelineResult } from '@/server/agent/pipeline';
import { loadLastChat } from '@/server/agent/restore';
import { decodeSse } from '@/server/agent/events';
import type { AgentEvent } from '@/server/agent/types';
import { CONSENT_VERSION } from '@/server/auth/consent';
import { resetEnvCache } from '@/server/env';
import { getLlm, resetLlmClient } from '@/server/llm/client';
import { clearStubResponses, registerStubResponse } from '@/server/llm/providers/stub';
import { asideContext, pendingOnboarding } from '@/server/onboarding/service';
import { parseSession, signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

const pending = (userId: string) => `cid=${signUserSession({ userId, role: 'pending' })}`;

async function act(cookie: string, body: unknown) {
  const res = await onboarding(jsonRequest('/api/onboarding', 'POST', body, cookie));
  expect(res.status).toBe(200);
  return res;
}

/** Согласие + роль кандидата → кука кандидата и candidateId. */
async function asCandidate(userId: string) {
  const c = pending(userId);
  await act(c, { action: 'answer', stepId: 'consent', value: { version: CONSENT_VERSION } });
  const cookie = cookieFrom(await act(c, { action: 'answer', stepId: 'role', value: 'candidate' }))!;
  return { cookie, candidateId: parseSession(cookie.slice(4))!.candidateId! };
}

async function ask(cookie: string, body: Record<string, unknown>) {
  const res = await consultant(jsonRequest('/api/consultant/messages', 'POST', body, cookie));
  if (res.status !== 200) return { status: res.status, events: [] as AgentEvent[], conversationId: null };
  const { events } = decodeSse(await res.text());
  return { status: 200, events, conversationId: res.headers.get('x-conversation-id') };
}

const textOf = (events: AgentEvent[]) => (events.filter((e) => e.type === 'message').at(-1) as { text: string } | undefined)?.text ?? '';

describe('Свободный вопрос посреди онбординга', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    resetLlmClient();
    clearStubResponses();
    await prisma.user.create({ data: { id: 'u1', name: 'Иван Петров', email: 'ivan@example.test' } });
  });

  it('граница доверия: до роли «специалист» в консультанта не пускает (нет кандидата), без согласия — 409', async () => {
    const before = await ask(pending('u1'), { text: 'а что это за сайт?', onboardingStep: 'consent' });
    expect([401, 403]).toContain(before.status);
    // Кандидат без согласия (аккаунт создан в обход онбординга) — свободный текст в модель не уходит.
    await prisma.candidate.create({ data: { id: 'c-nc', email: 'nc@example.test', name: 'Без согласия' } });
    await prisma.user.create({ data: { id: 'u2', name: 'Без согласия', role: 'candidate', candidateId: 'c-nc' } });
    const noConsent = await ask(`cid=${signUserSession({ userId: 'u2', role: 'candidate', candidateId: 'c-nc' })}`, { text: 'вопрос', onboardingStep: 'goal' });
    expect(noConsent.status).toBe(409);
    expect(await prisma.message.count()).toBe(0);
  });

  it('заглушка LLM: честная заготовка с возвратом к шагу; вопрос сохранён в разговоре с маркером шага, ответ шага не записан', async () => {
    const { cookie, candidateId } = await asCandidate('u1');
    const r = await ask(cookie, { text: 'А зачем вам моя цель?', onboardingStep: 'goal' });
    expect(r.status).toBe(200);
    expect(textOf(r.events)).toMatch(/без языковой модели/);
    expect(textOf(r.events)).toContain('Зачем ты здесь?');
    const rows = await prisma.message.findMany({ where: { conversationId: r.conversationId! }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(rows[1]!.content).toBe('А зачем вам моя цель?\n[онбординг: шаг goal]');
    expect((await prisma.onboardingState.findUniqueOrThrow({ where: { userId: 'u1' } })).stepId).toBe('goal');
    expect(await prisma.candidateProfile.findUnique({ where: { candidateId } })).toBeNull();

    // Перезагрузка: реплики с шагом — под шагом онбординга, маркер не виден, дублей нет.
    const restored = await loadLastChat(candidateId);
    expect(restored.conversationId).toBe(r.conversationId);
    expect(restored.items.map((i) => [i.role, i.stepId])).toEqual([
      ['user', 'goal'],
      ['agent', 'goal'],
    ]);
    expect(restored.items[0]).toMatchObject({ text: 'А зачем вам моя цель?' });

    // Тот же разговор продолжается: второй вопрос — в нём же.
    const r2 = await ask(cookie, { text: 'ещё вопрос', onboardingStep: 'goal', conversationId: r.conversationId });
    expect(r2.conversationId).toBe(r.conversationId);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('шаг берёт сервер: клиент прислал устаревший шаг — контекст по текущему', async () => {
    const { cookie } = await asCandidate('u1');
    await act(cookie, { action: 'answer', stepId: 'goal', value: 'job_search' });
    const r = await ask(cookie, { text: 'что такое ФСП?', onboardingStep: 'goal' });
    const user = await prisma.message.findFirstOrThrow({ where: { conversationId: r.conversationId!, role: 'user' } });
    expect(user.content).toContain('[онбординг: шаг documents]');
    expect(textOf(r.events)).toContain('Пришли резюме или ссылки');
  });

  it('с моделью: в контексте хода — шаг онбординга и варианты, правило коротко вернуть к шагу', async () => {
    const { candidateId } = await asCandidate('u1');
    const conv = await prisma.conversation.create({ data: { candidateId } });
    const systems: string[] = [];
    registerStubResponse('consultant', (req) => {
      systems.push(req.system ?? '');
      return { text: 'Цель нужна, чтобы подстроить шаги. Так зачем ты здесь?' };
    });
    const step = (await asideContext('u1')).step!;
    const events: AgentEvent[] = [];
    await runTurn({ candidateId, conversationId: conv.id, text: 'зачем это?', onboarding: step }, (e) => events.push(e), undefined, {
      llm: getLlm({ candidateId, conversationId: conv.id }),
    });
    expect(textOf(events)).toMatch(/подстроить шаги/);
    expect(systems[0]).toContain('Идёт онбординг');
    expect(systems[0]).toContain('«Зачем ты здесь?»');
    expect(systems[0]).toContain('Ищу работу');
    expect(systems[0]).toContain('<onboarding>');
  });

  it('онбординг брошен («Настроить позже»): обычный ход консультанта получает напоминание со ссылкой', async () => {
    const { cookie, candidateId } = await asCandidate('u1');
    await act(cookie, { action: 'answer', stepId: 'goal', value: 'job_search' });
    expect(await pendingOnboarding(candidateId)).toMatchObject({ stepId: 'documents' });
    const systems: string[] = [];
    registerStubResponse('consultant', (req) => {
      systems.push(req.system ?? '');
      return { text: 'ok' };
    });
    await ask(cookie, { text: 'привет' });
    expect(systems[0]).toContain('Онбординг кандидата не закончен');
    expect(systems[0]).toContain('/onboarding');

    await prisma.user.update({ where: { id: 'u1' }, data: { onboardedAt: new Date() } });
    expect(await pendingOnboarding(candidateId)).toBeNull();
    await ask(cookie, { text: 'привет ещё раз' });
    expect(systems.at(-1)).not.toContain('Онбординг кандидата не закончен');
  });

  it('демо без модели: напоминание о брошенном онбординге — одной строкой и один раз за разговор', async () => {
    const { cookie } = await asCandidate('u1');
    process.env.LLM_STUB_DEMO = 'true';
    resetEnvCache();
    try {
      const first = await ask(cookie, { text: 'привет' });
      expect(textOf(first.events)).toContain('Знакомство ещё не закончено - продолжить можно здесь: /onboarding');
      const second = await ask(cookie, { text: 'а ещё?', conversationId: first.conversationId });
      expect(textOf(second.events)).not.toContain('/onboarding');
      const aside = await ask(cookie, { text: 'вопрос', onboardingStep: 'goal' });
      expect(textOf(aside.events)).toMatch(/без языковой модели.*Зачем ты здесь\?/s);
    } finally {
      process.env.LLM_STUB_DEMO = 'false';
      resetEnvCache();
    }
  });

  it('ход шага «Документы» помечен как онбординговый: напоминания «знакомство не закончено» нет', async () => {
    const { cookie, candidateId } = await asCandidate('u1');
    await act(cookie, { action: 'answer', stepId: 'goal', value: 'job_search' });
    const step = (await asideContext('u1')).step!;
    expect(step.stepId).toBe('documents');
    const conv = await prisma.conversation.create({ data: { candidateId } });
    const systems: string[] = [];
    registerStubResponse('consultant', (req) => {
      systems.push(req.system ?? '');
      return { text: 'Прочитал.' };
    });
    await runTurn({ candidateId, conversationId: conv.id, text: 'Вот мои материалы.', onboarding: step }, () => undefined, undefined, {
      llm: getLlm({ candidateId, conversationId: conv.id }),
    });
    expect(systems[0]).not.toContain('Онбординг кандидата не закончен');
    expect(systems[0]).toContain('Не предлагай продолжить знакомство по ссылке');
    // С конвейером (файлы/ссылки) правило «коротко и вернуть к шагу» не добавляется — у конвейера свои инструкции.
    const pipeline = { docs: [], failed: [], proposed: [], rejected: 0, rejectSummary: '', merged: 0, hiddenText: 0, injectionSuspect: false, alreadyKnown: 0 } as unknown as PipelineResult;
    const withPipeline = buildSystem({ now: new Date(), pipeline, toolsExhausted: false, onboarding: step, resume: null });
    expect(withPipeline).not.toContain('Идёт онбординг');
    expect(withPipeline).toContain('Ход пришёл из ленты онбординга');
    expect(withPipeline).not.toContain('Онбординг кандидата не закончен');
  });
});
