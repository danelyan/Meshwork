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

/** Результат-заглушка вызова, который не выполнился: ход остановили («Стоп», таймаут) посреди пачки вызовов. */
export const INTERRUPTED_TOOL_RESULT = JSON.stringify({ error: { code: 'aborted', message: 'Вызов не выполнен: ход остановлен' } });

/**
 * У каждого вызова в сообщении ассистента должен быть результат: провайдеры отвергают историю, где
 * на часть id из `toolCalls` нет сообщения `tool`. После остановки хода посреди пачки такие вызовы
 * остаются в базе — им дописывается заглушка сразу за результатами той же пачки.
 */
function closeToolCalls(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as ChatMessage;
    out.push(m);
    if (m.role !== 'assistant' || !m.toolCalls?.length) continue;
    const answered = new Set<string>();
    while (messages[i + 1]?.role === 'tool') {
      const t = messages[++i] as ChatMessage;
      out.push(t);
      if (t.toolCallId) answered.add(t.toolCallId);
    }
    for (const call of m.toolCalls) {
      if (!answered.has(call.id)) out.push({ role: 'tool', content: INTERRUPTED_TOOL_RESULT, toolCallId: call.id });
    }
  }
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
 * вне последнего хода режутся до HISTORY_MAX_CHARS. Вызовам без результата
 * (ход остановлен посреди пачки) дописывается заглушка — см. closeToolCalls.
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
  const recent = closeToolCalls(dialog.slice(start).map(toChatMessage));
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

/**
 * Бюджет истории в символах на один вызов модели. Самые узкие модели основного
 * провайдера — YandexGPT Pro/Lite 5 с контекстом 32 768 токенов (дока AI Studio
 * «Модели»); минус системный промпт (~3–4k), описания инструментов (~3k) и ответ
 * (TURN_MAX_TOKENS). Русский текст ≈ 3–4 символа на токен — 48k символов
 * держат историю в ~14k токенов (оценка, не замер токенизатором).
 */
export const HISTORY_TOTAL_MAX_CHARS = 48_000;
/** Результат инструмента в последнем ходе не режем короче этого. */
const TAIL_TOOL_MIN_CHARS = 2_000;
export const OMITTED_NOTE = '[Более ранняя часть диалога опущена: не влезла в контекст модели. Состояние профиля — через get_profile.]';

function sizeOf(m: ChatMessage): number {
  return m.content.length + (m.toolCalls?.length ? JSON.stringify(m.toolCalls).length : 0);
}

/**
 * Ужать историю под бюджет символов, сохранив последний ход целиком по структуре:
 *  1. последнее сообщение user и всё после него (вызовы и результаты инструментов
 *     этого хода) остаются всегда — иначе у tool-результата пропадёт вызов, а у
 *     модели — вопрос, на который она отвечает;
 *  2. более ранние ходы выкидываются с начала целыми ходами (от user до user), на
 *     их место встаёт одна пометка OMITTED_NOTE;
 *  3. если и последний ход не влез — результаты инструментов в нём режутся поровну.
 * Системный промпт сюда не входит: он уходит отдельным полем и не режется никогда.
 */
export function fitHistory(messages: ChatMessage[], maxChars: number = HISTORY_TOTAL_MAX_CHARS): ChatMessage[] {
  const total = messages.reduce((s, m) => s + sizeOf(m), 0);
  if (total <= maxChars) return messages;
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  const tail = lastUser >= 0 ? messages.slice(lastUser) : messages.slice();
  const prefix = lastUser >= 0 ? messages.slice(0, lastUser) : [];
  const tailSize = tail.reduce((s, m) => s + sizeOf(m), 0);

  // ходы префикса: границы — сообщения user
  const turns: ChatMessage[][] = [];
  for (const m of prefix) {
    if (m.role === 'user' || turns.length === 0) turns.push([m]);
    else (turns[turns.length - 1] as ChatMessage[]).push(m);
  }
  let budget = maxChars - tailSize - OMITTED_NOTE.length;
  const kept: ChatMessage[][] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i] as ChatMessage[];
    const size = t.reduce((s, m) => s + sizeOf(m), 0);
    if (size > budget) break;
    budget -= size;
    kept.unshift(t);
  }
  const dropped = kept.length < turns.length;
  let out: ChatMessage[] = [
    ...(dropped ? [{ role: 'user' as const, content: OMITTED_NOTE }] : []),
    ...kept.flat(),
    ...tail,
  ];
  const outSize = out.reduce((s, m) => s + sizeOf(m), 0);
  if (outSize > maxChars) {
    const tools = tail.filter((m) => m.role === 'tool').length;
    const fixed = out.reduce((s, m) => s + (m.role === 'tool' && tail.includes(m) ? 0 : sizeOf(m)), 0);
    const per = Math.max(TAIL_TOOL_MIN_CHARS, Math.floor((maxChars - fixed) / Math.max(1, tools)));
    out = out.map((m) => (m.role === 'tool' && tail.includes(m) ? { ...m, content: clip(m.content, per) } : m));
  }
  return out;
}
