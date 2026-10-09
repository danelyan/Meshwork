/**
 * Проверка ИНН по контрольной сумме (алгоритм ФНС: веса из приказа о порядке
 * присвоения ИНН). 10 цифр — организация, 12 — физлицо/ИП. Проверка в реестре
 * ЕГРЮЛ/ЕГРИП не делается: «найдено в реестре» в интерфейсе помечено «демо».
 */
const W10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const W11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const W12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

function control(digits: number[], weights: number[]): number {
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i]!, 0);
  return (sum % 11) % 10;
}

export type InnCheck = { ok: true; kind: 'legal' | 'individual' } | { ok: false; reason: string };

export function checkInn(raw: string): InnCheck {
  const inn = raw.replace(/\s+/g, '');
  if (!/^\d+$/.test(inn)) return { ok: false, reason: 'ИНН состоит только из цифр' };
  if (inn.length !== 10 && inn.length !== 12) return { ok: false, reason: 'В ИНН 10 цифр (организация) или 12 (ИП)' };
  const d = [...inn].map(Number);
  if (inn.length === 10) {
    return control(d, W10) === d[9] ? { ok: true, kind: 'legal' } : { ok: false, reason: 'Не сходится контрольная цифра ИНН — проверьте опечатку' };
  }
  const ok = control(d, W11) === d[10] && control(d, W12) === d[11];
  return ok ? { ok: true, kind: 'individual' } : { ok: false, reason: 'Не сходится контрольная цифра ИНН — проверьте опечатку' };
}
