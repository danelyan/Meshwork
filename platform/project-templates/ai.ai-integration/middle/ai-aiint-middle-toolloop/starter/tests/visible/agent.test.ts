// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { AgentError, createRegistry, runAgent } from '../../src/agent';
import type { Model, ModelStep } from '../../src/model';

const add = {
  name: 'add',
  description: 'Сумма двух чисел',
  parameters: { a: { type: 'number' as const, required: true }, b: { type: 'number' as const, required: true } },
  run: (args: Record<string, unknown>) => (args.a as number) + (args.b as number),
};

function script(steps: ModelStep[]): Model {
  return { async next() { return steps.shift() ?? { type: 'final', text: 'конец' }; } };
}

describe('цикл инструментов (visible)', () => {
  it('исполняет вызов и возвращает итог', async () => {
    const model = script([{ type: 'tool_call', id: 'c1', name: 'add', args: { a: 2, b: 3 } }, { type: 'final', text: '5' }]);
    const r = await runAgent({ model, registry: createRegistry([add]), prompt: '2+3?' });
    expect(r.answer).toBe('5');
    expect(r.modelCalls).toBe(2);
    expect(r.steps).toEqual([{ step: 1, tool: 'add', args: { a: 2, b: 3 }, ok: true, result: 5 }]);
  });

  it('неверные аргументы — ошибка инструмента, а не исключение', async () => {
    const out = await createRegistry([add]).call('add', { a: '2', b: 3 });
    expect(out).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
  });

  it('лимит шагов', async () => {
    const loop: Model = { async next() { return { type: 'tool_call', id: 'x', name: 'add', args: { a: 1, b: 1 } }; } };
    await expect(runAgent({ model: loop, registry: createRegistry([add]), prompt: 'go', maxSteps: 3 })).rejects.toBeInstanceOf(AgentError);
  });
});
