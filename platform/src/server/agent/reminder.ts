import type { ChatMessage } from '@/server/llm/types';

/** Длина вопроса в напоминании (символы). */
export const REMINDER_QUESTION_MAX = 300;

/**
 * Напоминание о вопросе хода после вызовов инструментов (замер eval/prompt-traps, 09.10):
 * после цепочки get_onboarding_status → get_test_status модель отвечала про тест и теряла
 * вопрос человека. Текст дописывается к последнему tool-результату только в запросе к модели
 * (в БД не пишется): содержимое tool-сообщения — свободный текст в любом OpenAI-совместимом
 * API и в Responses API, порядок сообщений не меняется. Вставка отдельного system-сообщения
 * посреди диалога у DeepSeek Chat Completions поддержана (api-docs.deepseek.com, Tool Calls),
 * но не у всех наших провайдеров — поэтому так.
 */
export function withQuestionReminder(messages: ChatMessage[], question: string): ChatMessage[] {
  const q = question.replace(/\s+/g, ' ').trim();
  const last = messages.at(-1);
  if (!q || !last || last.role !== 'tool') return messages;
  const clipped = q.length > REMINDER_QUESTION_MAX ? `${q.slice(0, REMINDER_QUESTION_MAX)}…` : q;
  const note = `\n\n[Напоминание платформы, не данные инструмента: сначала ответь на вопрос этого хода — «${clipped}»; следующий шаг — после ответа.]`;
  return [...messages.slice(0, -1), { ...last, content: last.content + note }];
}
