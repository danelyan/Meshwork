import type { Message, Model, ModelStep, ToolInfo } from './model';

export interface ToolSpec extends ToolInfo {
  run(args: Record<string, unknown>): unknown | Promise<unknown>;
}

export type ToolErrorCode = 'unknown_tool' | 'invalid_arguments' | 'tool_error';
export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: { code: ToolErrorCode; message: string } };

export interface ToolRegistry {
  list(): ToolInfo[];
  call(name: string, args: unknown): Promise<ToolOutcome>;
}

export interface StepLog {
  step: number;
  tool: string;
  args: unknown;
  ok: boolean;
  result?: unknown;
  error?: { code: ToolErrorCode; message: string };
}

export interface AgentResult {
  answer: string;
  steps: StepLog[];
  modelCalls: number;
}

export type AgentErrorCode = 'bad_request' | 'step_limit' | 'bad_model_output' | 'model_failed';

export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    public readonly steps: StepLog[] = [],
    message: string = code,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AgentError';
  }
}

const NAME = /^[a-z][a-z0-9_]*$/;

export function createRegistry(tools: ToolSpec[]): ToolRegistry {
  const byName = new Map<string, ToolSpec>();
  for (const t of tools) {
    if (!NAME.test(t.name)) throw new Error(`недопустимое имя инструмента: ${t.name}`);
    if (byName.has(t.name)) throw new Error(`повтор инструмента: ${t.name}`);
    byName.set(t.name, t);
  }
  const fail = (code: ToolErrorCode, message: string): ToolOutcome => ({ ok: false, error: { code, message } });

  return {
    list: () => tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    async call(name, args) {
      const tool = byName.get(name);
      if (!tool) return fail('unknown_tool', `нет инструмента ${name}`);
      if (typeof args !== 'object' || args === null || Array.isArray(args)) return fail('invalid_arguments', 'аргументы должны быть объектом');
      const given = args as Record<string, unknown>;
      for (const key of Object.keys(given)) {
        if (!(key in tool.parameters)) return fail('invalid_arguments', `неизвестный аргумент ${key}`);
      }
      for (const [key, spec] of Object.entries(tool.parameters)) {
        const v = given[key];
        if (v === undefined) {
          if (spec.required) return fail('invalid_arguments', `не хватает аргумента ${key}`);
          continue;
        }
        const ok = spec.type === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === spec.type;
        if (!ok) return fail('invalid_arguments', `аргумент ${key}: нужен ${spec.type}`);
      }
      try {
        const result = await tool.run(given);
        JSON.stringify({ result });
        return { ok: true, result };
      } catch (e) {
        return fail('tool_error', e instanceof Error ? e.message : String(e));
      }
    },
  };
}

export async function runAgent(options: { model: Model; registry: ToolRegistry; prompt: string; maxSteps?: number }): Promise<AgentResult> {
  const { model, registry, prompt } = options;
  const maxSteps = options.maxSteps ?? 6;
  if (typeof prompt !== 'string' || prompt.trim() === '' || !Number.isInteger(maxSteps) || maxSteps < 1) throw new AgentError('bad_request');
  const messages: Message[] = [{ role: 'user', content: prompt }];
  const steps: StepLog[] = [];
  const tools = registry.list();

  for (let call = 1; call <= maxSteps; call++) {
    let step: ModelStep;
    try {
      step = await model.next(messages, tools);
    } catch (cause) {
      throw new AgentError('model_failed', steps, 'model_failed', { cause });
    }
    if (typeof step !== 'object' || step === null) throw new AgentError('bad_model_output', steps);
    if (step.type === 'final') {
      if (typeof step.text !== 'string') throw new AgentError('bad_model_output', steps);
      return { answer: step.text, steps, modelCalls: call };
    }
    if (step.type !== 'tool_call' || typeof step.id !== 'string' || step.id === '' || typeof step.name !== 'string' || step.name === '') {
      throw new AgentError('bad_model_output', steps);
    }
    if (call === maxSteps) throw new AgentError('step_limit', steps);
    messages.push({ role: 'assistant', toolCall: { id: step.id, name: step.name, args: step.args } });
    const out = await registry.call(step.name, step.args);
    if (out.ok) {
      steps.push({ step: call, tool: step.name, args: step.args, ok: true, result: out.result });
      messages.push({ role: 'tool', toolCallId: step.id, name: step.name, content: JSON.stringify({ result: out.result === undefined ? null : out.result }) });
    } else {
      steps.push({ step: call, tool: step.name, args: step.args, ok: false, error: out.error });
      messages.push({ role: 'tool', toolCallId: step.id, name: step.name, content: JSON.stringify({ error: out.error }) });
    }
  }
  throw new AgentError('step_limit', steps);
}
