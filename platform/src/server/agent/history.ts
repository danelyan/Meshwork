import type { Message as DbMessage } from '@prisma/client';

import type { ChatMessage, ToolCall } from '@/server/llm/types';

/** Сколько последних сообщений диалога уходит в модель (векторной памяти нет — простая обрезка). */
export const HISTORY_WINDOW = 20;
/** Длиннее — обрезаем: старый результат инструмента не должен съедать контекст. */
export const HISTORY_MAX_CHARS = 4_000;
/** Сообщения старше окна сворачиваются в одну строку-сводку этой длины. */
export const SUMMARY_MAX_CHARS = 1_200;

export function toChatMessage(m: Pick<DbMessage, 'role' | 'content' | 'toolCalls' | 'toolCallId'>): ChatMessage {
  const out: ChatMessage = { role: m.role, content: m.content };
  if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length) {
    out.toolCalls = m.toolCalls as unknown as ToolCall[];
  }
  if (m.role === 'tool' && m.toolCallId) out.toolCallId = m.toolCallId;
  return out;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[… обрезано]`;
}

/**
 * История для модели: системные строки (версия промпта) выкидываются; окно —
 * последние HISTORY_WINDOW сообщений, сдвинутое к ближайшему сообщению user,
 * чтобы не начинать с осиротевшего `tool` (провайдеры такое отвергают); всё,
 * что раньше окна, — одна сводка «user: …» в начале. Результаты инструментов
 * вне последнего хода режутся до HISTORY_MAX_CHARS.
 */
export function buildHistory(
  messages: Pick<DbMessage, 'role' | 'content' | 'toolCalls' | 'toolCallId'>[],
  opts: { window?: number; maxChars?: number } = {},
): ChatMessage[] {
  const window = opts.window ?? HISTORY_WINDOW;
  const maxChars = opts.maxChars ?? HISTORY_MAX_CHARS;
  const dialog = messages.filter((m) => m.role !== 'system');
  let start = Math.max(0, dialog.length - window);
  while (start > 0 && start < dialog.length && dialog[start]?.role !== 'user') start--;
  const older = dialog.slice(0, start);
  const recent = dialog.slice(start).map(toChatMessage);
  const lastUserIdx = recent.map((m) => m.role).lastIndexOf('user');
  const out: ChatMessage[] = recent.map((m, i) =>
    m.role === 'tool' && i < lastUserIdx ? { ...m, content: clip(m.content, maxChars) } : m,
  );
  if (older.length) {
    const lines = older
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content.trim()))
      .map((m) => `${m.role === 'user' ? 'кандидат' : 'консультант'}: ${m.content.replace(/\s+/g, ' ').slice(0, 160)}`);
    const summary = clip(lines.join('\n'), SUMMARY_MAX_CHARS);
    out.unshift({ role: 'user', content: `Сводка более ранней части диалога (${older.length} сообщений):\n${summary}` });
  }
  return out;
}
