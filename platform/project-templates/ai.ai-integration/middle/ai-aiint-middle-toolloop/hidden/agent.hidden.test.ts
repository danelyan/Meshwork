// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { describe, expect, it } from 'vitest';

import { AgentError, createRegistry, runAgent, type ToolSpec } from '../src/agent';
import type { Message, Model, ModelStep, ToolInfo } from '../src/model';

const add: ToolSpec = {
  name: 'add',
  description: 'Сумма',
  parameters: { a: { type: 'number', required: true }, b: { type: 'number', required: true } },
  run: (args) => (args.a as number) + (args.b as number),
};
const greet: ToolSpec = {
  name: 'greet',
  description: 'Приветствие',
  parameters: { name: { type: 'string', required: true }, loud: { type: 'boolean', required: false } },
  run: async (args) => (args.loud ? String(args.name).toUpperCase() : `привет, ${args.name}`),
};

/** Модель по сценарию; снимает копию истории и список инструментов при каждом обращении. */
function scripted(steps: Array<ModelStep | Error | ((history: Message[]) => ModelStep)>) {
  const seen: Message[][] = [];
  const toolLists: ToolInfo[][] = [];
  const model: Model = {
    async next(messages, tools) {
      seen.push(structuredClone(messages));
      toolLists.push(structuredClone(tools));
      const s = steps.shift();
      if (s === undefined) throw new Error('сценарий закончился');
      if (s instanceof Error) throw s;
      return typeof s === 'function' ? s(messages) : s;
    },
  };
  return { model, seen, toolLists };
}
const call = (id: string, name: string, args: unknown): ModelStep => ({ type: 'tool_call', id, name, args });
const final = (text: string): ModelStep => ({ type: 'final', text });

async function agentErr(p: Promise<unknown>): Promise<AgentError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AgentError);
    return e as AgentError;
  }
  throw new Error('ожидалась AgentError');
}

describe('реестр', () => {
  it('list: порядок регистрации, без run', () => {
    const list = createRegistry([greet, add]).list();
    expect(list.map((t) => t.name)).toEqual(['greet', 'add']);
    expect(list[0]).not.toHaveProperty('run');
    expect(list[1].parameters.a).toEqual({ type: 'number', required: true });
  });

  it('повтор и недопустимое имя – Error при создании', () => {
    expect(() => createRegistry([add, greet])).not.toThrow();
    expect(() => createRegistry([add, add])).toThrow();
    for (const name of ['Add', '1add', 'a-b', '', 'a b']) expect(() => createRegistry([{ ...add, name }])).toThrow();
  });

  it('успех: синхронный и асинхронный инструмент', async () => {
    const reg = createRegistry([add, greet]);
    expect(await reg.call('add', { a: 1, b: 2 })).toEqual({ ok: true, result: 3 });
    expect(await reg.call('greet', { name: 'Аня' })).toEqual({ ok: true, result: 'привет, Аня' });
    expect(await reg.call('greet', { name: 'аня', loud: true })).toEqual({ ok: true, result: 'АНЯ' });
  });

  it('неизвестный инструмент', async () => {
    expect(await createRegistry([add]).call('sub', {})).toMatchObject({ ok: false, error: { code: 'unknown_tool' } });
  });

  it('проверка аргументов: run не вызывается, сообщение называет аргумент', async () => {
    let runs = 0;
    const reg = createRegistry([{ ...add, run: () => { runs++; return 0; } }]);
    const cases: Array<[unknown, string]> = [
      [{ a: 1 }, 'b'],
      [{ a: 1, b: '2' }, 'b'],
      [{ a: Number.NaN, b: 1 }, 'a'],
      [{ a: Infinity, b: 1 }, 'a'],
      [{ a: null, b: 1 }, 'a'],
      [{ a: 1, b: 2, c: 3 }, 'c'],
    ];
    for (const [args, arg] of cases) {
      const out = await reg.call('add', args);
      expect(out, JSON.stringify(args)).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
      if (!out.ok) expect(out.error.message).toContain(arg);
    }
    for (const args of [null, [1, 2], 'a', 5, undefined]) {
      expect(await reg.call('add', args)).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    }
    expect(runs).toBe(0);
  });

  it('необязательный аргумент можно опустить, но тип проверяется', async () => {
    const reg = createRegistry([greet]);
    expect(await reg.call('greet', { name: 'x' })).toMatchObject({ ok: true });
    expect(await reg.call('greet', { name: 'x', loud: 'yes' })).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
  });

  it('исключение и отклонённый промис – tool_error с исходным сообщением', async () => {
    const reg = createRegistry([
      { ...add, name: 'boom', run: () => { throw new Error('склад недоступен'); } },
      { ...add, name: 'later', run: async () => { throw new Error('таймаут'); } },
    ]);
    expect(await reg.call('boom', { a: 1, b: 1 })).toEqual({ ok: false, error: { code: 'tool_error', message: 'склад недоступен' } });
    expect(await reg.call('later', { a: 1, b: 1 })).toEqual({ ok: false, error: { code: 'tool_error', message: 'таймаут' } });
  });

  it('несериализуемый результат – tool_error', async () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    const reg = createRegistry([{ ...add, run: () => cyc }]);
    expect(await reg.call('add', { a: 1, b: 1 })).toMatchObject({ ok: false, error: { code: 'tool_error' } });
  });
});

describe('цикл', () => {
  it('сразу итоговый ответ: один вызов модели, пустой журнал', async () => {
    const { model, seen, toolLists } = scripted([final('готово')]);
    const r = await runAgent({ model, registry: createRegistry([add, greet]), prompt: 'привет' });
    expect(r).toEqual({ answer: 'готово', steps: [], modelCalls: 1 });
    expect(seen[0]).toEqual([{ role: 'user', content: 'привет' }]);
    expect(toolLists[0].map((t) => t.name)).toEqual(['add', 'greet']);
  });

  it('два вызова подряд: история и журнал', async () => {
    const { model, seen } = scripted([call('c1', 'add', { a: 1, b: 2 }), call('c2', 'greet', { name: 'Ира' }), final('ok')]);
    const r = await runAgent({ model, registry: createRegistry([add, greet]), prompt: 'сделай' });
    expect(r.modelCalls).toBe(3);
    expect(r.steps).toEqual([
      { step: 1, tool: 'add', args: { a: 1, b: 2 }, ok: true, result: 3 },
      { step: 2, tool: 'greet', args: { name: 'Ира' }, ok: true, result: 'привет, Ира' },
    ]);
    expect(seen[1]).toEqual([
      { role: 'user', content: 'сделай' },
      { role: 'assistant', toolCall: { id: 'c1', name: 'add', args: { a: 1, b: 2 } } },
      { role: 'tool', toolCallId: 'c1', name: 'add', content: '{"result":3}' },
    ]);
    expect(seen[2]).toHaveLength(5);
    expect(seen[2][4]).toEqual({ role: 'tool', toolCallId: 'c2', name: 'greet', content: '{"result":"привет, Ира"}' });
  });

  it('ошибка инструмента уходит модели, и модель исправляется', async () => {
    const { model, seen } = scripted([call('c1', 'add', { a: 1 }), call('c2', 'add', { a: 1, b: 1 }), final('2')]);
    const r = await runAgent({ model, registry: createRegistry([add]), prompt: 'сумма' });
    expect(r.answer).toBe('2');
    const toolMsg = seen[1][2] as Extract<Message, { role: 'tool' }>;
    expect(JSON.parse(toolMsg.content)).toMatchObject({ error: { code: 'invalid_arguments' } });
    expect(toolMsg.content).toContain('b');
    expect(r.steps[0]).toMatchObject({ step: 1, ok: false, error: { code: 'invalid_arguments' } });
    expect(r.steps[0]).not.toHaveProperty('result');
    expect(r.steps[1]).toMatchObject({ step: 2, ok: true, result: 2 });
  });

  it('неизвестный инструмент и исключение инструмента не прерывают цикл', async () => {
    const reg = createRegistry([{ ...add, name: 'boom', run: () => { throw new Error('сломано'); } }]);
    const { model, seen } = scripted([call('c1', 'nope', {}), call('c2', 'boom', { a: 1, b: 1 }), final('сдаюсь')]);
    const r = await runAgent({ model, registry: reg, prompt: 'x' });
    expect(r.answer).toBe('сдаюсь');
    expect(r.steps.map((s) => s.error?.code)).toEqual(['unknown_tool', 'tool_error']);
    expect(JSON.parse((seen[2][4] as { content: string }).content)).toEqual({ error: { code: 'tool_error', message: 'сломано' } });
  });

  it('результат undefined записывается как null', async () => {
    const reg = createRegistry([{ ...add, run: () => undefined }]);
    const { model, seen } = scripted([call('c1', 'add', { a: 1, b: 1 }), final('ok')]);
    await runAgent({ model, registry: reg, prompt: 'x' });
    expect((seen[1][2] as { content: string }).content).toBe('{"result":null}');
  });

  it('лимит шагов: последний вызов не исполняется, журнал в ошибке', async () => {
    let runs = 0;
    const reg = createRegistry([{ ...add, run: () => { runs++; return 0; } }]);
    const { model, seen } = scripted([call('c1', 'add', { a: 1, b: 1 }), call('c2', 'add', { a: 1, b: 1 }), call('c3', 'add', { a: 1, b: 1 }), final('никогда')]);
    const e = await agentErr(runAgent({ model, registry: reg, prompt: 'x', maxSteps: 3 }));
    expect(e.code).toBe('step_limit');
    expect(e.steps).toHaveLength(2);
    expect(runs).toBe(2);
    expect(seen).toHaveLength(3);
  });

  it('по умолчанию шесть обращений к модели; maxSteps: 1 допускает только ответ', async () => {
    expect((await runAgent({ model: scripted([final('да')]).model, registry: createRegistry([add]), prompt: 'x', maxSteps: 1 })).answer).toBe('да');
    expect((await agentErr(runAgent({ model: scripted([call('c', 'add', { a: 1, b: 1 })]).model, registry: createRegistry([add]), prompt: 'x', maxSteps: 1 }))).code).toBe('step_limit');
    const { model, seen } = scripted(Array.from({ length: 10 }, (_, i) => call(`c${i}`, 'add', { a: 1, b: 1 })));
    const e = await agentErr(runAgent({ model, registry: createRegistry([add]), prompt: 'x' }));
    expect(e.code).toBe('step_limit');
    expect(seen).toHaveLength(6);
    expect(e.steps).toHaveLength(5);
  });

  it('сбой модели – model_failed с cause и накопленным журналом', async () => {
    const boom = new Error('503');
    const { model } = scripted([call('c1', 'add', { a: 1, b: 1 }), boom]);
    const e = await agentErr(runAgent({ model, registry: createRegistry([add]), prompt: 'x' }));
    expect(e.code).toBe('model_failed');
    expect(e.cause).toBe(boom);
    expect(e.steps).toHaveLength(1);
  });

  it('шаг неправильной формы – bad_model_output', async () => {
    const bad = [{ type: 'think' }, { type: 'tool_call', id: '', name: 'add', args: {} }, { type: 'tool_call', id: 'c', name: 5, args: {} }, { type: 'final', text: 42 }, null];
    for (const b of bad) {
      const e = await agentErr(runAgent({ model: scripted([b as unknown as ModelStep]).model, registry: createRegistry([add]), prompt: 'x' }));
      expect(e.code, JSON.stringify(b)).toBe('bad_model_output');
    }
  });

  it('некорректный вход – bad_request, модель не вызывается', async () => {
    for (const o of [{ prompt: '  ' }, { prompt: 'x', maxSteps: 0 }, { prompt: 'x', maxSteps: 2.5 }]) {
      const { model, seen } = scripted([final('x')]);
      const e = await agentErr(runAgent({ model, registry: createRegistry([add]), ...o }));
      expect(e.code).toBe('bad_request');
      expect(seen).toHaveLength(0);
    }
  });
});
