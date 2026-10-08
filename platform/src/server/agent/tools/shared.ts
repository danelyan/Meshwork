import { z } from 'zod';

import type { ExtractedDoc } from '@/server/collector/types';
import { truncateExternal } from '../external';

/** Текст документа в модель — не больше этого (остальное режется с пометкой). */
export const DOC_MAX_CHARS = 16_000;

export const SourceKindSchema = z.enum(['resume', 'document', 'url', 'github', 'codeforces', 'stackoverflow', 'fsp', 'chat']);

/** Что инструменты чтения отдают модели: текст с координатами и флаги. Текст скрытых строк не отдаём. */
export const DocResultSchema = z.object({
  sourceKind: SourceKindSchema,
  title: z.string(),
  origin: z.string(),
  /** Строки `ref\tтекст` — цитаты берутся отсюда, sourceRef = ref. */
  text: z.string(),
  lineCount: z.number().int(),
  truncated: z.boolean(),
  /** Скрытый текст найден (белый, мелкий, display:none …) — проигнорирован, в text его нет. */
  hiddenText: z.number().int(),
  injectionSuspect: z.boolean(),
  sourceId: z.string().optional(),
});
export type DocResult = z.infer<typeof DocResultSchema>;

export function docToResult(doc: ExtractedDoc, sourceId?: string): DocResult {
  const hidden = new Set(doc.flags.hiddenText?.sample ?? []);
  const body = doc.lines.length
    ? doc.lines
        .filter((l) => !hidden.has(l.text))
        .map((l) => `${l.ref}\t${l.text}`)
        .join('\n')
    : doc.text;
  const t = truncateExternal(body, DOC_MAX_CHARS);
  return {
    sourceKind: doc.sourceKind,
    title: doc.title,
    origin: doc.origin,
    text: t.text,
    lineCount: doc.lines.length,
    truncated: t.truncated || Boolean(doc.flags.truncated),
    hiddenText: doc.flags.hiddenText?.count ?? 0,
    injectionSuspect: Boolean(doc.flags.injectionSuspect),
    ...(sourceId ? { sourceId } : {}),
  };
}

export const EmptyInput = z.object({});
