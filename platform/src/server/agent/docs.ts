import { z } from 'zod';

import type { ExtractedDoc } from '@/server/collector/types';
import { Prisma } from '@prisma/client';

import { prisma } from '@/server/db';

/** ExtractedDoc из Json-колонок (Upload.extracted, Source.snapshot) — проверяем форму, а не доверяем. */
export const ExtractedDocSchema = z.object({
  sourceKind: z.enum(['resume', 'document', 'url', 'github', 'codeforces', 'stackoverflow', 'fsp', 'chat']),
  title: z.string(),
  origin: z.string(),
  lines: z.array(z.object({ ref: z.string(), text: z.string() })),
  text: z.string(),
  flags: z
    .object({
      hiddenText: z.object({ count: z.number(), sample: z.array(z.string()) }).optional(),
      truncated: z.boolean().optional(),
      injectionSuspect: z.boolean().optional(),
    })
    .default({}),
  fetchedAt: z.string(),
});

export function parseExtractedDoc(json: unknown): ExtractedDoc | null {
  const r = ExtractedDocSchema.safeParse(json);
  return r.success ? (r.data as ExtractedDoc) : null;
}

/** Все документы кандидата (загрузки с разбором + снимки источников) — для проверяющего. */
export async function loadCandidateDocs(candidateId: string): Promise<ExtractedDoc[]> {
  const [uploads, sources] = await Promise.all([
    prisma.upload.findMany({ where: { candidateId, extracted: { not: Prisma.DbNull } }, select: { extracted: true } }),
    prisma.source.findMany({ where: { candidateId }, select: { snapshot: true }, orderBy: { fetchedAt: 'desc' } }),
  ]);
  const docs: ExtractedDoc[] = [];
  for (const u of uploads) {
    const d = parseExtractedDoc(u.extracted);
    if (d) docs.push(d);
  }
  const seen = new Set<string>();
  for (const s of sources) {
    const d = parseExtractedDoc(s.snapshot);
    if (d && !seen.has(d.origin)) {
      seen.add(d.origin);
      docs.push(d);
    }
  }
  return docs;
}

/**
 * Снимок прочитанного источника (он же кэш): Source.snapshot. Одна строка на
 * (кандидат, kind, origin) — как в collector: fetchProfile с candidateId уже
 * записал Source, здесь он только обновится, без дубля.
 */
export async function saveSource(candidateId: string, doc: ExtractedDoc): Promise<string> {
  const snapshot = doc as unknown as Prisma.InputJsonValue;
  const existing = await prisma.source.findFirst({
    where: { candidateId, kind: doc.sourceKind, origin: doc.origin },
    select: { id: true },
  });
  if (existing) {
    await prisma.source.update({ where: { id: existing.id }, data: { snapshot } });
    return existing.id;
  }
  const row = await prisma.source.create({
    data: { candidateId, kind: doc.sourceKind, origin: doc.origin, snapshot },
    select: { id: true },
  });
  return row.id;
}

/** Загрузка кандидата с разбором; чужая или не разобранная → null. */
export async function loadUpload(candidateId: string, uploadId: string) {
  const u = await prisma.upload.findFirst({
    where: { id: uploadId, candidateId },
    select: { id: true, filename: true, extracted: true, flags: true },
  });
  if (!u) return null;
  return { id: u.id, filename: u.filename, doc: parseExtractedDoc(u.extracted) };
}
