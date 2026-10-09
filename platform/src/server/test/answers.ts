// Проверка ответа кодом (R-T-02): нормализация и сравнение с ключом по формату.
import type { AnswerFormat } from './types';

export const MAX_ANSWER_CHARS = 500;

/** Общая нормализация: обрезка, регистр, кавычки, повторные пробелы, типографика. */
export function normalizeText(s: string): string {
  return s
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;:])\s*/g, '$1')
    .trim()
    .toLowerCase();
}

/** Число: «3», «3.0», «3,0», «три»? — нет, только цифры; запятая как десятичный разделитель допустима. */
export function normalizeNumber(s: string): string | null {
  const t = s.trim().replace(/\s+/g, '').replace(',', '.').replace(/^\+/, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return String(Number(n.toFixed(6)));
}

/** Список: разделители запятая/пробел/точка с запятой/перевод строки, порядок не важен. */
export function normalizeList(s: string): string {
  const parts = s
    .split(/[\s,;]+/)
    .map((p) => normalizeText(p))
    .filter(Boolean);
  return [...new Set(parts)].sort().join(',');
}

/** Порядок (output через запятую): разделители запятая/пробел/перевод строки, порядок важен. */
export function normalizeSequence(s: string): string {
  return s
    .split(/[\s,;]+/)
    .map((p) => normalizeText(p))
    .filter(Boolean)
    .join(',');
}

/** Нормализация по формату; null — ответ не разбирается (считается неверным). */
export function normalizeAnswer(format: AnswerFormat, raw: string): string | null {
  const s = raw.slice(0, MAX_ANSWER_CHARS);
  switch (format) {
    case 'number':
    case 'line':
      return normalizeNumber(s);
    case 'list':
      return normalizeList(s);
    case 'text':
      return normalizeSequence(s);
  }
}

/** Ключ может содержать варианты через `|` (например, «n^2|n²|o(n^2)»). */
export function checkAnswer(format: AnswerFormat, raw: string, answerKey: string): boolean {
  const got = normalizeAnswer(format, raw);
  if (got === null) return false;
  return answerKey.split('|').some((k) => normalizeAnswer(format, k) === got);
}
