/** Число с запятой: 0.675 → «0,675». */
export function dec(x: number, digits = 3): string {
  return x.toFixed(digits).replace('.', ',');
}

/** Доля в проценты с одним знаком: 0.707 → «70,7 %». */
export function pct(x: number): string {
  return `${(x * 100).toFixed(1).replace('.', ',')} %`;
}
