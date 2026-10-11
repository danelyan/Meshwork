import { cookies } from 'next/headers';

import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';
import { SESSION_COOKIE, verifySession } from '@/server/session';

import { llmIsDemoStub } from './mode';
import { demoResumeFor } from './resumes';

/** Что чат показывает в демо: пометка «без модели» и кнопка «Загрузить демо-резюме». */
export interface ChatDemoContext {
  /** LLM_PROVIDER=stub + LLM_STUB_DEMO=true: ответы по шаблонам, языковой модели нет. */
  noLlm: boolean;
  /** Резюме демо-кандидата; null – кандидат не демо или демо-вход выключен. */
  resume: { fileName: string; link: string } | null;
}

export async function resolveChatDemoContext(candidateId: string | null, env = getEnv()): Promise<ChatDemoContext> {
  const noLlm = llmIsDemoStub(env);
  if (!candidateId || !env.DEMO_LOGIN) return { noLlm, resume: null };
  const c = await prisma.candidate.findFirst({ where: { id: candidateId, isDemo: true }, select: { id: true } });
  const r = c ? demoResumeFor(c.id) : null;
  return { noLlm, resume: r ? { fileName: r.fileName, link: r.link } : null };
}

/** Для server components: кандидат из куки сессии. Любая ошибка → без демо-подсказок. */
export async function chatDemoContextFromCookies(): Promise<ChatDemoContext> {
  try {
    const jar = await cookies();
    return await resolveChatDemoContext(verifySession(jar.get(SESSION_COOKIE)?.value));
  } catch {
    return { noLlm: false, resume: null };
  }
}
