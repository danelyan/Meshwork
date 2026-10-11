import { getEnv } from '@/server/env';

/** Демо без ключей: LLM_PROVIDER=stub + LLM_STUB_DEMO=true – языковой модели нет, ответы по шаблонам. */
export function llmIsDemoStub(env = getEnv()): boolean {
  return env.LLM_PROVIDER === 'stub' && env.LLM_STUB_DEMO;
}
