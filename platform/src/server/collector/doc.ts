import { detectInjection } from './injection';
import { LIMITS } from './limits';
import { maskContacts } from './mask';
import type { DocLine, ExtractedDoc, SourceKind } from './types';

export interface RawLine {
  ref: string;
  text: string;
  hidden?: boolean;
}

export interface BuildDocInput {
  sourceKind: SourceKind;
  title: string;
  origin: string;
  lines: RawLine[];
  /** Текст, который не попадает в строки, но проверяется на инъекцию (meta, alt, title-атрибуты). */
  extraSuspectText?: string[];
  /** Число скрытых фрагментов, которых нет среди строк (HTML-комментарии и т. п.). */
  extraHidden?: { count: number; sample: string[] };
  meta?: Record<string, unknown>;
  now?: Date;
}

/**
 * lane resume-fields: строки с контактами ДО маскирования — только в памяти процесса (WeakMap, в JSON и БД
 * не попадают). Нужны, чтобы при загрузке резюме предложить кандидату его же контакт (server/resume-fields).
 */
const RAW_CONTACT_LINES = new WeakMap<ExtractedDoc, RawLine[]>();
export function rawContactLines(doc: ExtractedDoc): RawLine[] {
  return RAW_CONTACT_LINES.get(doc) ?? [];
}

const collapse = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Общая сборка ExtractedDoc: чистка строк, маскирование контактов, флаг скрытого
 * текста, подозрение на инъекцию, усечение. Скрытые строки остаются в `lines` с
 * `hidden: true`, но не входят в `text`.
 */
export function buildDoc(input: BuildDocInput): ExtractedDoc {
  const lines: DocLine[] = [];
  const hiddenSample: string[] = [];
  let hiddenCount = 0;
  let masked = 0;
  let chars = 0;
  let truncated = false;
  const suspectParts: string[] = [];
  const rawContacts: RawLine[] = [];

  for (const raw of input.lines) {
    const clean = collapse(raw.text);
    if (!clean) continue;
    suspectParts.push(clean);
    if (raw.hidden) {
      hiddenCount += 1;
      if (hiddenSample.length < LIMITS.hiddenSamples) hiddenSample.push(clean.slice(0, LIMITS.hiddenSampleChars));
    }
    if (truncated) continue;
    if (lines.length >= LIMITS.docMaxLines || chars + clean.length > LIMITS.docMaxChars) {
      truncated = true;
      continue;
    }
    const m = maskContacts(clean);
    masked += m.masked;
    if (m.masked > 0 && !raw.hidden && rawContacts.length < 5) rawContacts.push({ ref: raw.ref, text: clean });
    chars += m.text.length + 1;
    lines.push(raw.hidden ? { ref: raw.ref, text: m.text, hidden: true } : { ref: raw.ref, text: m.text });
  }

  if (input.extraHidden) {
    hiddenCount += input.extraHidden.count;
    for (const s of input.extraHidden.sample) {
      if (hiddenSample.length < LIMITS.hiddenSamples) hiddenSample.push(collapse(s).slice(0, LIMITS.hiddenSampleChars));
    }
  }

  const suspectText = [...suspectParts, ...(input.extraSuspectText ?? []), ...(input.extraHidden?.sample ?? [])].join('\n');
  const flags: ExtractedDoc['flags'] = {};
  if (hiddenCount > 0) {
    flags.hiddenText = { count: hiddenCount, sample: hiddenSample.map((s) => maskContacts(s).text) };
  }
  if (truncated) flags.truncated = true;
  if (detectInjection(suspectText)) flags.injectionSuspect = true;
  if (masked > 0) flags.maskedContacts = masked;

  const doc: ExtractedDoc = {
    sourceKind: input.sourceKind,
    title: collapse(input.title).slice(0, 200) || input.origin,
    origin: input.origin,
    lines,
    text: lines
      .filter((l) => !l.hidden)
      .map((l) => l.text)
      .join('\n'),
    flags,
    fetchedAt: (input.now ?? new Date()).toISOString(),
  };
  if (input.meta) doc.meta = input.meta;
  if (rawContacts.length > 0) RAW_CONTACT_LINES.set(doc, rawContacts);
  return doc;
}
