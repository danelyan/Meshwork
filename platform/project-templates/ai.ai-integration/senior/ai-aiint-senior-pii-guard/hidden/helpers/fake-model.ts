// PLATFORM-OWNED: управляемые модели и часы для скрытых тестов
import { ModelError, type Model, type ModelRequest, type ModelResponse } from '../../src/model';

export type Reply = string | ModelError | Error | ModelResponse | ((req: ModelRequest) => Promise<ModelResponse>);

/** Модель по сценарию: ответы по очереди; строка – текст с 100 токенами. Пишет все запросы. */
export function fake(name: string, replies: Reply[] = []) {
  const requests: ModelRequest[] = [];
  const model: Model = {
    name,
    async complete(req) {
      requests.push(req);
      const r = replies.shift();
      if (r === undefined) throw new Error(`${name}: ответов больше нет`);
      if (r instanceof Error) throw r;
      if (typeof r === 'function') return r(req);
      if (typeof r === 'string') return { text: r, tokens: 100 };
      return r;
    },
  };
  return { model, requests };
}

/** Модель, ответ которой выдаётся вручную. */
export function gated(name: string) {
  const requests: ModelRequest[] = [];
  let release!: (r: ModelResponse | Error) => void;
  const gate = new Promise<ModelResponse>((resolve, reject) => {
    release = (r) => (r instanceof Error ? reject(r) : resolve(r));
  });
  const model: Model = {
    name,
    complete(req) {
      requests.push(req);
      return gate;
    },
  };
  return { model, requests, release };
}

export function clock(start = 1_000_000) {
  let t = start;
  let calls = 0;
  return {
    now: () => {
      calls++;
      return t;
    },
    set: (v: number) => (t = v),
    advance: (ms: number) => (t += ms),
    calls: () => calls,
  };
}

export { ModelError };
