// PLATFORM-OWNED: управляемый фейковый API для тестов
import type { Task, TasksApi } from '../../src/api';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** API, каждый вызов которого возвращает Deferred из очереди – тест сам решает, когда и чем ответить. */
export function controlledApi() {
  const calls: { method: keyof TasksApi; args: unknown[]; d: Deferred<unknown> }[] = [];
  const make = (method: keyof TasksApi) => (...args: unknown[]) => {
    const d = deferred<unknown>();
    calls.push({ method, args, d });
    return d.promise;
  };
  const api = { list: make('list'), create: make('create'), setDone: make('setDone') } as unknown as TasksApi;
  const last = (method: keyof TasksApi) => [...calls].reverse().find((c) => c.method === method)!;
  return { api, calls, last };
}

export const TASKS: Task[] = [
  { id: 't1', title: 'Купить молоко', done: false },
  { id: 't2', title: 'Позвонить маме', done: true },
  { id: 't3', title: 'Сделать ревью', done: false },
];
