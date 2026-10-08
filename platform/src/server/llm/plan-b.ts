import type { CompleteRequest, CompleteResult } from './types';

/**
 * «План В» для провайдеров без tools (`supportsTools === false`):
 * tools описываются в system, модель обязана вернуть JSON
 * `{ action: 'tool' | 'reply', name?, arguments?, text? }` по схеме;
 * результат превращается в tool_calls. Реализует лейн llm; client уже
 * вызывает эти функции, когда `req.tools?.length && !provider.supportsTools`.
 */
export function toPlanBRequest(req: CompleteRequest): CompleteRequest {
  void req;
  throw new Error('not implemented: llm (plan B)');
}

export function fromPlanBResult(res: CompleteResult, req: CompleteRequest): CompleteResult {
  void res;
  void req;
  throw new Error('not implemented: llm (plan B)');
}
