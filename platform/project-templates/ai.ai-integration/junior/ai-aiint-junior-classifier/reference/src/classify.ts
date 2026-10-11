import type { Llm } from './llm';

export interface ClassifyInput {
  text: string;
  labels: string[];
}

export interface Classification {
  label: string;
  confidence: number;
  attempts: number;
}

export type ClassifyErrorCode = 'bad_request' | 'llm_failed' | 'invalid_output';

export class ClassifyError extends Error {
  constructor(
    public readonly code: ClassifyErrorCode,
    public readonly attempts: number = 0,
    message: string = code,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ClassifyError';
  }
}

export class ReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplyError';
  }
}

export function buildPrompt(input: ClassifyInput): string {
  return [
    'Отнеси обращение к одной из категорий.',
    `Категории: ${input.labels.join(', ')}.`,
    'Ответь только JSON-объектом вида {"label": "<категория>", "confidence": <число от 0 до 1>}.',
    '',
    'Обращение:',
    input.text.trim(),
  ].join('\n');
}

export function parseReply(raw: string, labels: string[]): { label: string; confidence: number } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ReplyError('в ответе нет JSON-объекта');
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ReplyError('JSON не разбирается');
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) throw new ReplyError('ответ не JSON-объект');
  const { label, confidence } = obj as Record<string, unknown>;
  if (typeof label !== 'string' || !labels.includes(label)) throw new ReplyError(`поле label: значение не из списка меток`);
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new ReplyError('поле confidence: нужно число от 0 до 1');
  }
  return { label, confidence };
}

export async function classify(llm: Llm, input: ClassifyInput, options?: { maxAttempts?: number }): Promise<Classification> {
  const max = options?.maxAttempts ?? 3;
  const { labels } = input;
  if (
    typeof input.text !== 'string' ||
    input.text.trim() === '' ||
    !Array.isArray(labels) ||
    labels.length < 2 ||
    labels.some((l) => typeof l !== 'string' || l.trim() === '') ||
    new Set(labels).size !== labels.length ||
    !Number.isInteger(max) ||
    max < 1
  ) {
    throw new ClassifyError('bad_request');
  }
  const base = buildPrompt(input);
  let prompt = base;
  let attempts = 0;
  for (;;) {
    attempts++;
    let raw: string;
    try {
      raw = await llm.complete(prompt);
    } catch (cause) {
      throw new ClassifyError('llm_failed', attempts, 'llm_failed', { cause });
    }
    try {
      return { ...parseReply(raw, labels), attempts };
    } catch (e) {
      if (!(e instanceof ReplyError)) throw e;
      if (attempts >= max) throw new ClassifyError('invalid_output', attempts, e.message);
      prompt = `${base}\n\nПредыдущий ответ не подошёл: ${e.message}.\nТвой предыдущий ответ:\n${raw}\nОтветь заново, только JSON.`;
    }
  }
}
