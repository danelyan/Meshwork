import { addMemory, listMemory, MEMORY_LIMIT, MemoryBody, memoryOwnerOf } from '@/server/consultant/memory';
import { errors, withErrors } from '@/server/errors';
import { getSession } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Память консультанта: свои заметки (из чата и добавленные вручную), не больше 20. Ответы знакомства сюда не входят. */
export const GET = withErrors(async (req: Request) => {
  const s = getSession(req); if (!s) throw errors.unauthorized();
  const items = await listMemory(memoryOwnerOf(s));
  return Response.json({ items, limit: MEMORY_LIMIT });
});

/** Добавить заметку вручную (source user). Лимит или дубль — 409. */
export const POST = withErrors(async (req: Request) => {
  const s = getSession(req); if (!s) throw errors.unauthorized();
  const body = MemoryBody.parse(await req.json().catch(() => ({})));
  const item = await addMemory(memoryOwnerOf(s), body.text, 'user');
  return Response.json({ item }, { status: 201 });
});
