// Калибровка балла подбора: балл формулы (ranking.ts) → вероятность «кандидат подойдёт вакансии».
// Таблица получена изотонической регрессией (eval/matching/calibration.ts, ключ calibration.relevant.knots в
// eval/matching/results.json) на СИНТЕТИЧЕСКОЙ разметке расширенного набора (247 профилей × 24 вакансии, скрытая
// истина генератора), цель — «релевантен ≥ 1». Это не исходы реальных приглашений: после их накопления
// (eval/matching/outcomes.ts) таблицу нужно пересчитать. Ранжирование не меняется: функция только переводит балл.

/** Узлы [балл, вероятность], балл по возрастанию, вероятность не убывает. Не править руками: копия из results.json (тест сверяет). */
export const CALIBRATION_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0.0115, 0.02],
  [0.0152, 0.0323],
  [0.053, 0.125],
  [0.0937, 0.1286],
  [0.1553, 0.2],
  [0.2022, 0.3377],
  [0.2171, 0.4],
  [0.2808, 0.4565],
  [0.3039, 0.6471],
  [0.3814, 0.7333],
  [0.3977, 0.7857],
  [0.4605, 0.9091],
  [0.5833, 0.98],
  [1.125, 0.98],
];

/** Подпись для интерфейса: откуда число и что оно не гарантирует. */
export const MATCH_PROBABILITY_NOTE = 'оценка по синтетическому набору, уточнится по исходам приглашений';

/** Балл подбора → вероятность 0..1 (кусочно-линейно по CALIBRATION_KNOTS; вне таблицы - крайнее значение; не убывает). */
export function scoreToProbability(score: number): number {
  const k = CALIBRATION_KNOTS;
  if (!Number.isFinite(score)) return k[0]![1];
  if (score <= k[0]![0]) return k[0]![1];
  const last = k[k.length - 1]!;
  if (score >= last[0]) return last[1];
  for (let i = 1; i < k.length; i++) {
    const [bx, bp] = k[i]!;
    if (score <= bx) {
      const [ax, ap] = k[i - 1]!;
      return bx === ax ? bp : ap + ((bp - ap) * (score - ax)) / (bx - ax);
    }
  }
  return last[1];
}
