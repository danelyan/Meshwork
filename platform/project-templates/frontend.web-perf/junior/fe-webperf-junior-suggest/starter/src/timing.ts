// Таймеры по контракту (contract.md): debounce и throttle.
export interface Cancelable {
  cancel(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & Cancelable {
  // TODO: вызов через ms после последнего обращения, с его аргументами; cancel()
  void fn;
  void ms;
  return Object.assign((..._args: A) => {}, { cancel() {} });
}

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & Cancelable {
  // TODO: первый вызов сразу, в окне ms запоминать последний, в конце окна выполнить его; cancel()
  void fn;
  void ms;
  return Object.assign((..._args: A) => {}, { cancel() {} });
}
