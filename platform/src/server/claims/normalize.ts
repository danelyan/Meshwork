// Нормализация текста для сверки цитаты с источником (verifier, extractByMarkers).
// Сравнение – по нормализованной форме, но каждый символ помнит позицию в оригинале,
// чтобы вернуть дословный фрагмент источника и строки, из которых он взят.

const DROP = new Set([
  '­', // мягкий перенос
  '​', '‌', '‍', '⁠', '﻿', // нулевой ширины
  '*', '`', // разметка Markdown: **жирный**, `код` – модель её часто опускает
]);
const QUOTES = new Set(['«', '»', '„', '“', '”', '‟', '"', '‹', '›', "'", '‘', '’', '‚', '‛', '´', '＂']);
const DASHES = new Set(['-', '‐', '‑', '‒', '–', '–', '―', '−', '﹣', '－']);
const isSpace = (ch: string) => /\s/u.test(ch); // \s в JS включает NBSP, U+202F, U+2028 и т. п.
const isLetter = (ch: string | undefined) => ch !== undefined && /\p{L}/u.test(ch);
const isLower = (ch: string | undefined) => ch !== undefined && /\p{Ll}/u.test(ch);

export interface Normalized {
  text: string;
  /** map[i] – индекс в оригинале символа text[i] */
  map: number[];
}

/**
 * Регистр, ё→е, кавычки → ", дефисы и тире → -, любые пробелы и переносы строк → один пробел,
 * мягкие переносы и символы нулевой ширины убираются.
 * `dehyphenate`: «разра-\nботка» → «разработка» (перенос слова по слогам в PDF):
 * дефис между буквой и строчной буквой, за которым идёт перевод строки.
 */
export function normalizeWithMap(src: string, opts?: { dehyphenate?: boolean }): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = -1;
  const chars = Array.from(src);
  // индексы в UTF-16 для каждого code point
  const offsets: number[] = [];
  {
    let o = 0;
    for (const ch of chars) {
      offsets.push(o);
      o += ch.length;
    }
  }
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string;
    const at = offsets[i] as number;
    if (DROP.has(ch)) continue;
    if (opts?.dehyphenate && DASHES.has(ch) && isLetter(chars[i - 1])) {
      let j = i + 1;
      let sawNewline = false;
      while (j < chars.length && (isSpace(chars[j] as string) || DROP.has(chars[j] as string))) {
        if (chars[j] === '\n' || chars[j] === '\r') sawNewline = true;
        j++;
      }
      if (sawNewline && isLower(chars[j])) {
        i = j - 1;
        continue;
      }
    }
    if (isSpace(ch)) {
      if (out.length > 0 && pendingSpace === -1) pendingSpace = at;
      continue;
    }
    if (pendingSpace !== -1) {
      out.push(' ');
      map.push(pendingSpace);
      pendingSpace = -1;
    }
    let c: string;
    if (QUOTES.has(ch)) c = '"';
    else if (DASHES.has(ch)) c = '-';
    else c = ch.toLowerCase().replace(/ё/g, 'е');
    // по кодовым единицам UTF-16: text[i] и map[i] должны совпадать по индексам (эмодзи – 2 единицы)
    for (let k = 0; k < c.length; k++) {
      out.push(c[k] as string);
      map.push(at + Math.min(k, ch.length - 1));
    }
  }
  return { text: out.join(''), map };
}

export function normalize(src: string, opts?: { dehyphenate?: boolean }): string {
  return normalizeWithMap(src, opts).text;
}

/** Цитата для поиска: нормализованная, без маркера списка в начале и знаков препинания по краям. */
export function normalizeQuote(quote: string): string {
  return normalize(quote)
    .replace(/^[\s\-•·––>#+]+/u, '')
    .replace(/[\s.,;:!?…]+$/u, '')
    .trim();
}

/** Число «слов» (букв/цифр) в строке. */
export function wordCount(s: string): number {
  return (s.match(/[\p{L}\p{N}][\p{L}\p{N}+#.\-]*/gu) ?? []).length;
}
