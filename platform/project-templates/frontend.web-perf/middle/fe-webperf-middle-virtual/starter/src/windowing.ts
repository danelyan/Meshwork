// Расчёт окна виртуализации по контракту (contract.md).
export interface WindowInput {
  count: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan: number;
}
export interface WindowRange {
  start: number;
  end: number; // не включительно
  totalHeight: number;
}

export function computeWindow(input: WindowInput): WindowRange {
  // TODO: границы окна с overscan, приведение scrollTop, RangeError на неверных аргументах
  void input;
  return { start: 0, end: 0, totalHeight: 0 };
}
