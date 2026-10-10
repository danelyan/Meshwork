import { POST as assistantPost } from '@/app/api/employer/assistant/messages/route';
import { POST as onboarding } from '@/app/api/onboarding/route';
import { loadLastEmployerChat } from '@/server/agent/employer/restore';
import { CONSENT_VERSION } from '@/server/auth/consent';
import { resetEnvCache } from '@/server/env';
import { resetLlmClient } from '@/server/llm/client';
import { clearStubResponses, registerStubResponse } from '@/server/llm/providers/stub';
import { pausedOnboardingOf } from '@/server/onboarding/service';
import type { OnboardingView } from '@/server/onboarding/types';
import { parseSession, signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

// Пауза знакомства у работодателя (решение владельца 10.10): тот же механизм, что у кандидата
// (OnboardingState.meta.later), разговор идёт с помощником по подбору.
async function act(cookie: string, body: unknown) {
  const res = await onboarding(jsonRequest('/api/onboarding', 'POST', body, cookie));
  expect(res.status).toBe(200);
  return { res, json: (await res.json()) as OnboardingView & { next?: string } };
}

async function asEmployer(userId: string) {
  const c = `cid=${signUserSession({ userId, role: 'pending' })}`;
  await act(c, { action: 'answer', stepId: 'consent', value: { version: CONSENT_VERSION } });
  await act(c, { action: 'answer', stepId: 'role', value: 'employer' });
  const cookie = cookieFrom((await act(c, { action: 'answer', stepId: 'companyName', value: 'ООО Ромашка' })).res)!;
  // ADR 0005: помощник по подбору открыт после оферты и обязательства по данным
  await act(cookie, { action: 'answer', stepId: 'employerConsents', value: ['employer_offer', 'employer_data_obligation'] });
  return { cookie, employerProfileId: parseSession(cookie.slice(4))!.employerProfileId! };
}

async function ask(cookie: string, text: string, conversationId?: string) {
  const res = await assistantPost(jsonRequest('/api/employer/assistant/messages', 'POST', { text, ...(conversationId ? { conversationId } : {}) }, cookie));
  expect(res.status).toBe(200);
  await res.text();
  return res.headers.get('x-conversation-id')!;
}

describe('пауза знакомства работодателя', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    process.env.LLM_PROVIDER = 'stub';
    process.env.LLM_STUB_DEMO = 'false';
    resetEnvCache();
    resetLlmClient();
    clearStubResponses();
    await resetDb();
    await prisma.user.create({ data: { id: 'u1', name: 'Анна Смирнова', email: 'anna@example.test' } });
  });

  it('«настроить позже» — пауза на /consultant, ответ и возврат к шагу снимают её, до роли пауза не ставится', async () => {
    const { cookie } = await asEmployer('u1');
    const later = await act(cookie, { action: 'later' });
    expect(later.json.next).toBe('/consultant');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } })).onboardedAt).toBeNull();
    const view = await act(cookie, { action: 'goto', stepId: 'inn' }); // goto снимает паузу
    expect(view.json.later).toBe(false);
    await act(cookie, { action: 'later' });
    expect(await pausedOnboardingOf('u1')).toMatchObject({ stepId: 'inn' });
    const answered = await act(cookie, { action: 'answer', stepId: 'inn', value: '7707083893' });
    expect(answered.json.later).toBe(false);
    expect(await pausedOnboardingOf('u1')).toBeNull();
  });

  it('разговор на паузе: реплика помечена шагом, лента ставит её под шаг; после возврата метки нет', async () => {
    const { cookie, employerProfileId } = await asEmployer('u1');
    await act(cookie, { action: 'later' });
    const systems: string[] = [];
    registerStubResponse('employer_assistant', (req) => {
      systems.push(req.system ?? '');
      return { text: 'Подберу, как только опишешь потребность.' };
    });
    const conv = await ask(cookie, 'Как вы ищете кандидатов?');
    const user = await prisma.employerMessage.findFirstOrThrow({ where: { conversationId: conv, role: 'user' } });
    expect(user.content).toBe('Как вы ищете кандидатов?\n[знакомство на паузе: шаг inn]');
    expect(systems[0]).toContain('на паузе');
    expect(systems[0]).toContain('Вернуться к знакомству');

    const restored = await loadLastEmployerChat(employerProfileId);
    expect(restored.items).toEqual([
      expect.objectContaining({ role: 'user', text: 'Как вы ищете кандидатов?', stepId: 'inn', paused: true }),
      expect.objectContaining({ role: 'agent', stepId: 'inn', paused: true }),
    ]);

    // Возврат к знакомству: новые реплики без метки и без напоминания.
    await act(cookie, { action: 'goto', stepId: 'inn' });
    await ask(cookie, 'Что ещё умеешь?', conv);
    const last = await prisma.employerMessage.findMany({ where: { conversationId: conv, role: 'user' }, orderBy: { createdAt: 'asc' } });
    expect(last[1]!.content).toBe('Что ещё умеешь?');
    expect(systems[1]).not.toContain('на паузе');
    const again = await loadLastEmployerChat(employerProfileId);
    expect(again.items.filter((i) => i.stepId)).toHaveLength(2);
  });

  it('демо без модели: на паузе ответ напоминает про «Вернуться к знакомству» один раз за разговор', async () => {
    process.env.LLM_STUB_DEMO = 'true';
    resetEnvCache();
    resetLlmClient();
    const { cookie } = await asEmployer('u1');
    await act(cookie, { action: 'later' });
    const conv = await ask(cookie, 'Что ты умеешь?');
    await ask(cookie, 'А ещё что?', conv);
    const replies = await prisma.employerMessage.findMany({ where: { conversationId: conv, role: 'assistant' }, orderBy: { createdAt: 'asc' } });
    const marked = replies.filter((r) => r.content.includes('Знакомство ещё не закончено'));
    expect(marked).toHaveLength(1);
    expect(marked[0]!.content).toContain('Вернуться к знакомству');
  });
});
