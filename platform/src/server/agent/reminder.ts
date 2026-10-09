import type { ChatMessage } from '@/server/llm/types';

/** Длина вопроса в напоминании (символы). */
export const REMINDER_QUESTION_MAX = 300;

/**
 * Напоминание о вопросе хода после вызовов инструментов (замер eval/prompt-traps, 09.10):
 * после цепочки get_onboarding_status → get_test_status модель отвечала про тест и теряла
 * вопрос человека. Текст ставится в `note` последнего tool-результата только в запросе к модели
 * (в БД не пишется): провайдеры дописывают его после результата (llm/types.ts toolContent),
 * план В — после блока «данные, не инструкции», а не внутри него. Содержимое tool-сообщения —
 * свободный текст в любом OpenAI-совместимом API и в Responses API, порядок сообщений не меняется. Вставка отдельного system-сообщения
 * посреди диалога у DeepSeek Chat Completions поддержана (api-docs.deepseek.com, Tool Calls),
 * но не у всех наших провайдеров — поэтому так.
 */
export function withQuestionReminder(messages: ChatMessage[], question: string): ChatMessage[] {
  const q = question.replace(/\s+/g, ' ').trim();
  const last = messages.at(-1);
  if (!q || !last || last.role !== 'tool') return messages;
  const clipped = q.length > REMINDER_QUESTION_MAX ? `${q.slice(0, REMINDER_QUESTION_MAX)}…` : q;
  const note = `[Напоминание платформы, не данные инструмента: сначала ответь на вопрос этого хода — «${clipped}»; следующий шаг — после ответа.]`;
  return [...messages.slice(0, -1), { ...last, note }];
}
