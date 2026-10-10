import { deleteMemory, MemoryBody, memoryOwnerOf, updateMemory } from '@/server/consultant/memory';
import { errors, withErrors } from '@/server/errors';
import { getSession } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Поправить свою заметку; после правки она «добавлена вручную». Чужая или нет такой — 404. */
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = getSession(req); if (!s) throw errors.unauthorized();
  const { id } = await params;
  const body = MemoryBody.parse(await req.json().catch(() => ({})));
  const item = await updateMemory(memoryOwnerOf(s), id, body.text);
  return Response.json({ item });
});

/** Удалить свою заметку. Чужая или нет такой — 404. */
export const DELETE = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = getSession(req); if (!s) throw errors.unauthorized();
  const { id } = await params;
  await deleteMemory(memoryOwnerOf(s), id);
  return new Response(null, { status: 204 });
});
