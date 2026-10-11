export interface Cancelable {
  cancel(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & Cancelable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };
  return Object.assign(wrapped, {
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  });
}

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & Cancelable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | null = null;
  const release = () => {
    if (pending) {
      const args = pending;
      pending = null;
      fn(...args);
      timer = setTimeout(release, ms);
    } else {
      timer = undefined;
    }
  };
  const wrapped = (...args: A) => {
    if (timer === undefined) {
      fn(...args);
      timer = setTimeout(release, ms);
    } else {
      pending = args;
    }
  };
  return Object.assign(wrapped, {
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  });
}
