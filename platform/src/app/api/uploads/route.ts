import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { extractFile } from '@/server/collector/files';
import { LIMITS } from '@/server/collector/limits';
import type { ExtractedDoc } from '@/server/collector/types';
import { prisma } from '@/server/db';
import { AppError, errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Запас на границы и заголовки multipart (Next.js docs: serverActions.bodySizeLimit — 10–20 КБ). */
const MULTIPART_OVERHEAD = 64 * 1024;
const MAX_BODY = LIMITS.fileMaxBytes + MULTIPART_OVERHEAD;

/**
 * У Route Handler нет своего лимита тела, а `request.formData()` буферизует всё —
 * читаем поток сами и обрываем на лимите, затем разбираем multipart из буфера.
 */
async function readFormData(req: Request): Promise<FormData> {
  const ct = req.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data/i.test(ct)) {
    throw new AppError('unsupported_media_type', 'Нужен multipart/form-data с полем file', 415);
  }
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) throw errors.payloadTooLarge('Файл больше 5 МБ');
  if (!req.body) throw errors.badRequest('Пустой запрос');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      throw errors.payloadTooLarge('Файл больше 5 МБ');
    }
    chunks.push(value);
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { 'content-type': ct } }).formData();
  } catch {
    throw errors.badRequest('Не удалось разобрать multipart');
  }
}

function brief(doc: ExtractedDoc) {
  return {
    title: doc.title,
    sourceKind: doc.sourceKind,
    lines: doc.lines.filter((l) => !l.hidden).length,
    pages: (doc.meta?.pages as number | undefined) ?? null,
    flags: doc.flags,
    preview: doc.text.slice(0, 300),
  };
}

/**
 * Загрузка резюме/документа: PDF или DOCX ≤ 5 МБ (≤ 20 стр.). Сам файл не хранится —
 * только извлечённый текст с координатами (152-ФЗ: сырые данные не дольше разбора).
 * Повтор того же файла (sha256) у того же кандидата — вернуть прежнюю запись.
 */
export const POST = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const exists = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } });
  if (!exists) throw errors.unauthorized();

  const form = await readFormData(req);
  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('Нет файла в поле file');
  if (file.size === 0) throw errors.badRequest('Пустой файл');
  if (file.size > LIMITS.fileMaxBytes) throw errors.payloadTooLarge('Файл больше 5 МБ');
  const kindField = form.get('kind');
  const sourceKind = kindField === 'document' ? 'document' : 'resume';

  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(buf).digest('hex');

  const prev = await prisma.upload.findUnique({
    where: { candidateId_sha256: { candidateId, sha256 } },
    select: { id: true, extracted: true },
  });
  if (prev?.extracted) {
    return Response.json({ uploadId: prev.id, deduplicated: true, doc: brief(prev.extracted as unknown as ExtractedDoc) });
  }

  const doc = await extractFile(buf, file.name || 'file', file.type, { sourceKind });
  const data = {
    filename: doc.title,
    mime: doc.meta?.fileKind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf',
    size: buf.length,
    extracted: doc as unknown as Prisma.InputJsonValue,
    flags: doc.flags as unknown as Prisma.InputJsonValue,
  };
  const row = await prisma.upload.upsert({
    where: { candidateId_sha256: { candidateId, sha256 } },
    create: { candidateId, sha256, ...data },
    update: data,
    select: { id: true },
  });
  return Response.json({ uploadId: row.id, deduplicated: false, doc: brief(doc) }, { status: 201 });
});
