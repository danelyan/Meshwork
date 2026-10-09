import type { AgentEvent } from './types';

/**
 * SSE-кадр: `data: <json AgentEvent>\n\n`. JSON не содержит перевода строки
 * (JSON.stringify экранирует \n), поэтому одно событие — ровно один кадр.
 * U+2028/U+2029 тоже экранируем: в JSON они допустимы, но некоторые парсеры
 * строк считают их концом строки.
 */
export function encodeSse(event: AgentEvent | { type: string }): string {
  const json = JSON.stringify(event).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `data: ${json}\n\n`;
}

/** Разбор потока `data: …\n\n` обратно в события (тесты, клиент). Неполный хвост возвращается в rest. */
export function decodeSse(chunk: string): { events: AgentEvent[]; rest: string } {
  const events: AgentEvent[] = [];
  let rest = chunk;
  for (;;) {
    const idx = rest.indexOf('\n\n');
    if (idx === -1) break;
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()) as AgentEvent);
      } catch {
        /* чужой кадр — пропускаем */
      }
    }
  }
  return { events, rest };
}
