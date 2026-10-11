import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { getSetting } from '@/server/admin/settings';
import { assertSameOrigin } from '@/server/auth/csrf';
import { extractFile, type FileKind, fileMime } from '@/server/collector/files';
import { LIMITS } from '@/server/collector/limits';
import type { ExtractedDoc } from '@/server/collector/types';
import { prisma } from '@/server/db';
import { AppError, errors, withErrors } from '@/server/errors';
import { applyFromUpload, type ApplySummary } from '@/server/resume-fields';
import { requireCandidate } from '@/server/session';
import { saveOriginal } from '@/server/uploads/storage';

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

/**
 * Антиспам: не больше `uploads.dailyLimit` новых файлов за 24 ч (0 — без лимита; демо-кандидаты общие для жюри — без лимита).
 * Каждая новая картинка/скан — платный вызов OCR; повтор того же файла (sha256) сюда не доходит.
 */
async function assertUploadQuota(candidateId: string, isDemo: boolean): Promise<void> {
  const limit = await getSetting('uploads.dailyLimit');
  if (limit <= 0 || isDemo) return;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.upload.count({ where: { candidateId, createdAt: { gte: dayAgo } } });
  if (recent >= limit) throw errors.rateLimited(`Не больше ${limit} новых файлов в сутки — попробуй завтра или вставь текст в чат`);
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
 * Загрузка резюме/документа: PDF, DOCX, MD, TXT, CSV, JPG или PNG ≤ 5 МБ (PDF ≤ 20 стр.; картинки и сканы — через OCR). Хранится извлечённый текст
 * с координатами и оригинал файла (<UPLOAD_DIR>/<candidateId>/<sha256>; скачать и удалить —
 * GET /api/uploads/:id/file, DELETE /api/uploads/:id). Оригинал пишется только после
 * успешного разбора. Повтор того же файла (sha256) у того же кандидата — прежняя запись, без копии.
 */
export const POST = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const candidateId = requireCandidate(req);
  const exists = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true, isDemo: true } });
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
    select: { id: true, extracted: true, storageKey: true },
  });
  if (prev?.extracted) {
    // Запись из времени до хранения оригиналов — дописать файл к ней.
    if (!prev.storageKey) {
      const storageKey = await saveOriginal(candidateId, sha256, buf);
      await prisma.upload.update({ where: { id: prev.id }, data: { storageKey } });
    }
    return Response.json({ uploadId: prev.id, deduplicated: true, doc: brief(prev.extracted as unknown as ExtractedDoc) });
  }

  await assertUploadQuota(candidateId, exists.isDemo);
  const doc = await extractFile(buf, file.name || 'file', file.type, { sourceKind });
  const storageKey = await saveOriginal(candidateId, sha256, buf);
  const data = {
    storageKey,
    filename: doc.title,
    mime: fileMime(doc.meta?.fileKind as FileKind, doc.title, buf),
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
  // R-C-01/02: ФИО, контакт, стаж, роли, софт-скиллы — в пустые поля профиля, иначе предложение. Сбой разбора не валит загрузку.
  let profileFields: ApplySummary | null = null;
  if (sourceKind === 'resume') {
    profileFields = await applyFromUpload(candidateId, row.id, doc).catch((err: unknown) => {
      console.error('resume-fields: не удалось применить поля резюме', err instanceof Error ? err.message : err);
      return null;
    });
  }
  return Response.json({ uploadId: row.id, deduplicated: false, doc: brief(doc), profileFields }, { status: 201 });
});
