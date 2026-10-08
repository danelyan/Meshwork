import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';

// GET route handler в Next.js 15 по умолчанию не кэшируется; явно — для ясности.
export const dynamic = 'force-dynamic';

/** 200 — приложение и БД живы; 503 — БД недоступна. Секретов и конфигурации не раскрывает. */
export async function GET() {
  let db: 'up' | 'down' = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'up';
  } catch {
    db = 'down';
  }
  let llm = 'unknown';
  try {
    llm = getEnv().LLM_PROVIDER;
  } catch {
    llm = 'misconfigured';
  }
  const ok = db === 'up' && llm !== 'misconfigured';
  return Response.json({ ok, db, llm, time: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
