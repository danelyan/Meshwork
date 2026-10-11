import type { DocLine, ExtractedDoc } from '../collector/types';
import { normalizeWithMap, type Normalized } from './normalize';

/** Строка документа; `hidden` проставляет сборщик (белый текст, кегль 1 пт, display:none). */
export type SourceLine = DocLine;

const WORD = /[\p{L}\p{N}]/u;

export interface IndexedDoc {
  doc: ExtractedDoc;
  lines: SourceLine[];
  /** Оригинальный текст: строки через \n */
  raw: string;
  /** Начало каждой строки в raw */
  starts: number[];
  plain: Normalized;
  dehyph: Normalized;
}

export interface QuoteMatch {
  /** Дословный фрагмент источника (пробелы схлопнуты) */
  quote: string;
  sourceRef: string;
  hidden: boolean;
  lineIdx: [number, number];
}

export function docLines(doc: ExtractedDoc): SourceLine[] {
  if (doc.lines && doc.lines.length > 0) return doc.lines as SourceLine[];
  return (doc.text ?? '').split('\n').map((text, i) => ({ ref: `${doc.origin}#l${i + 1}`, text }));
}

export function indexDoc(doc: ExtractedDoc): IndexedDoc {
  const lines = docLines(doc);
  const starts: number[] = [];
  let pos = 0;
  for (const l of lines) {
    starts.push(pos);
    pos += l.text.length + 1;
  }
  const raw = lines.map((l) => l.text).join('\n');
  return { doc, lines, raw, starts, plain: normalizeWithMap(raw), dehyph: normalizeWithMap(raw, { dehyphenate: true }) };
}

function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function rangeRef(lines: SourceLine[], a: number, b: number): string {
  const ra = lines[a]?.ref ?? '';
  if (a === b) return ra;
  return `${ra}..${lines[b]?.ref ?? ''}`;
}

/**
 * Все вхождения нормализованной цитаты в документ по границам слов; видимые – первыми.
 * Сначала обычная нормализация, затем вариант со склейкой переносов слов.
 */
export function findQuote(idx: IndexedDoc, normQuote: string): QuoteMatch[] {
  if (!normQuote) return [];
  const found: QuoteMatch[] = [];
  const seen = new Set<string>();
  for (const n of [idx.plain, idx.dehyph]) {
    let from = 0;
    for (;;) {
      const s = n.text.indexOf(normQuote, from);
      if (s === -1) break;
      from = s + 1;
      const e = s + normQuote.length - 1;
      // границы слов: «Писал на Java» не совпадает с «Писал на JavaScript»
      if (WORD.test(n.text[s - 1] ?? '') && WORD.test(normQuote[0] ?? '')) continue;
      if (WORD.test(n.text[e + 1] ?? '') && WORD.test(normQuote[normQuote.length - 1] ?? '')) continue;
      const os = n.map[s] as number;
      const oe = (n.map[e] as number) + 1;
      const key = `${os}:${oe}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = lineAt(idx.starts, os);
      const b = lineAt(idx.starts, oe - 1);
      let hidden = false;
      for (let i = a; i <= b; i++) if (idx.lines[i]?.hidden) hidden = true;
      found.push({
        quote: idx.raw.slice(os, oe).replace(/\s+/g, ' ').trim(),
        sourceRef: rangeRef(idx.lines, a, b),
        hidden,
        lineIdx: [a, b],
      });
    }
  }
  return found.sort((x, y) => Number(x.hidden) - Number(y.hidden));
}

/** Ссылка ProposedClaim.sourceRef указывает на строку этого документа? */
export function docHasRef(idx: IndexedDoc, ref: string): boolean {
  const first = ref.split('..')[0] ?? ref;
  return idx.lines.some((l) => l.ref === first);
}
