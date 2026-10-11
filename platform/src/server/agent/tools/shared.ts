import { z } from 'zod';

import type { ExtractedDoc } from '@/server/collector/types';
import { truncateExternal } from '../external';

/** Текст документа в модель – не больше этого (остальное режется с пометкой). */
export const DOC_MAX_CHARS = 16_000;

export const SourceKindSchema = z.enum(['resume', 'document', 'url', 'github', 'codeforces', 'stackoverflow', 'fsp', 'chat']);

/** Что инструменты чтения отдают модели: текст с координатами и флаги. Текст скрытых строк не отдаём. */
export const DocResultSchema = z.object({
  sourceKind: SourceKindSchema,
  title: z.string(),
  origin: z.string(),
  /** Строки `ref\tтекст` – цитаты берутся отсюда, sourceRef = ref. */
  text: z.string(),
  lineCount: z.number().int(),
  truncated: z.boolean(),
  /** Скрытый текст найден (белый, мелкий, display:none …) – проигнорирован, в text его нет. */
  hiddenText: z.number().int(),
  injectionSuspect: z.boolean(),
  /** Текст распознан OCR со скана или фото – возможны ошибки распознавания (буквы, цифры, порядок строк). */
  ocr: z.boolean().optional(),
  /** Скан без текстового слоя, распознать не удалось – текста нет, попроси PDF с текстом/DOCX или вставить текст. */
  ocrFailed: z.boolean().optional(),
  sourceId: z.string().optional(),
});
export type DocResult = z.infer<typeof DocResultSchema>;

export function docToResult(doc: ExtractedDoc, sourceId?: string): DocResult {
  // Признак строки – основной. Образцы (не больше трёх, обрезаны) – запасной путь для старых
  // записей, сохранённых без признака `hidden`.
  const samples = new Set(doc.flags.hiddenText?.sample ?? []);
  const body = doc.lines.length
    ? doc.lines
        .filter((l) => !l.hidden && !samples.has(l.text))
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
    ...(doc.meta?.ocr ? { ocr: true } : {}),
    ...(doc.meta?.ocrFailed ? { ocrFailed: true } : {}),
    ...(sourceId ? { sourceId } : {}),
  };
}

export const EmptyInput = z.object({});
