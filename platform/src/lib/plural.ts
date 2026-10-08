/** Русское согласование числительного: plural(1, ['строка','строки','строк']) → «строка». */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  const m100 = abs % 100;
  const m10 = abs % 10;
  if (m100 >= 11 && m100 <= 14) return forms[2];
  if (m10 === 1) return forms[0];
  if (m10 >= 2 && m10 <= 4) return forms[1];
  return forms[2];
}

/** «4 строки», «1 строка», «29 строк». */
export function countOf(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${plural(n, forms)}`;
}

export const FORMS = {
  line: ['строка', 'строки', 'строк'],
  claim: ['утверждение', 'утверждения', 'утверждений'],
  repeat: ['повтор', 'повтора', 'повторов'],
  card: ['карточка', 'карточки', 'карточек'],
} as const satisfies Record<string, readonly [string, string, string]>;

/** Поле каталога `limits` исторически начинается с «Не доказывает:» — UI добавляет свой префикс, поэтому свой убираем. */
export function stripLimitsPrefix(s: string): string {
  return s.replace(/^\s*Не доказывает\s*:\s*/i, '').trim();
}
