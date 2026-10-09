// Парсер SSE-кадров консультанта: `data: <json>\n\n`. Чистая функция, без DOM.
// Кадр может прийти разрезанным между чанками, в одном чанке может быть несколько кадров.
import type { AgentEvent } from '@/server/agent/types';

const EVENT_TYPES = new Set<AgentEvent['type']>([
  'step',
  'queue',
  'claims',
  'ask',
  'recommendations',
  'message',
  'error',
  'done',
  'conversation',
]);

/** Событие агента из JSON-строки или null, если это мусор. */
export function parseAgentEvent(json: string, types: ReadonlySet<string> = EVENT_TYPES): AgentEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !types.has(type)) return null;
  return value as AgentEvent;
}

/** Достаёт data-строки из одного кадра; комментарии (`:`) и прочие поля игнорирует. */
function frameData(frame: string): string | null {
  const parts: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) parts.push(line.slice(5).replace(/^ /, ''));
  }
  return parts.length ? parts.join('\n') : null;
}

export interface SseParser<E = AgentEvent> {
  /** Скормить очередной чанк; вернуть события из завершённых кадров. */
  push(chunk: string): E[];
  /** Конец потока: разобрать хвост без завершающей пустой строки. */
  flush(): E[];
}

/** `types` — допустимые типы событий (по умолчанию консультанта; помощник работодателя передаёт свои). */
export function createSseParser<E = AgentEvent>(types: ReadonlySet<string> = EVENT_TYPES): SseParser<E> {
  let buffer = '';

  function drain(final: boolean): E[] {
    const out: E[] = [];
    buffer = buffer.replace(/\r\n?/g, '\n');
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = frameData(frame);
      const event = data === null ? null : parseAgentEvent(data, types);
      if (event) out.push(event as E);
    }
    if (final && buffer.trim()) {
      const data = frameData(buffer);
      const event = data === null ? null : parseAgentEvent(data, types);
      if (event) out.push(event as E);
      buffer = '';
    }
    return out;
  }

  return {
    push(chunk) {
      buffer += chunk;
      return drain(false);
    },
    flush() {
      return drain(true);
    },
  };
}

/** Удобная обёртка: разобрать готовый список чанков (для тестов и однократных вызовов). */
export function parseSseChunks(chunks: string[]): AgentEvent[] {
  const parser = createSseParser();
  const out: AgentEvent[] = [];
  for (const c of chunks) out.push(...parser.push(c));
  out.push(...parser.flush());
  return out;
}
