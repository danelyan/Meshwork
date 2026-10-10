import { prisma } from '@/server/db';
import { errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';
import { contentDisposition, readOriginal } from '@/server/uploads/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Отдаём только то, что принимает загрузка; остальное — как бинарник, без шанса на inline HTML/SVG. */
const SAFE_TYPES = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

/**
 * Скачать оригинал загруженного файла. Только владелец; чужое, несуществующее и загруженное
 * до хранения оригиналов → 404. Всегда вложение (attachment), с nosniff.
 */
export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const candidateId = requireCandidate(req);
  const { id } = await ctx.params;
  const u = id && id.length <= 64
    ? await prisma.upload.findFirst({ where: { id, candidateId }, select: { filename: true, mime: true, storageKey: true } })
    : null;
  if (!u?.storageKey) throw errors.notFound('Файл не найден');
  const buf = await readOriginal(u.storageKey);
  if (!buf) throw errors.notFound('Файл не найден');
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': SAFE_TYPES.has(u.mime) ? u.mime : 'application/octet-stream',
      'Content-Length': String(buf.length),
      'Content-Disposition': contentDisposition(u.filename),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
});
