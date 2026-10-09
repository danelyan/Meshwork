import { describe, expect, it } from 'vitest';

import { REMINDER_QUESTION_MAX, withQuestionReminder } from '@/server/agent/reminder';
import type { ChatMessage } from '@/server/llm/types';

const base: ChatMessage[] = [
  { role: 'user', content: 'Есть премиум?' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_test_status', arguments: '{}' }] },
  { role: 'tool', content: '{"category":null}', toolCallId: 'c1' },
];

describe('withQuestionReminder', () => {
  it('после tool-результата дописывает вопрос хода, не меняя порядок и исходный массив', () => {
    const out = withQuestionReminder(base, '  Есть   премиум? ');
    expect(out).toHaveLength(3);
    expect(out[2]!.role).toBe('tool');
    expect(out[2]!.toolCallId).toBe('c1');
    expect(out[2]!.content).toMatch(/^\{"category":null\}\n\n\[Напоминание платформы.*«Есть премиум\?»/s);
    expect(base[2]!.content).toBe('{"category":null}');
  });

  it('без вызовов инструментов и без текста вопроса — ничего не меняет', () => {
    const first = base.slice(0, 1);
    expect(withQuestionReminder(first, 'Есть премиум?')).toBe(first);
    expect(withQuestionReminder(base, '   ')).toBe(base);
  });

  it('длинный вопрос обрезается', () => {
    const out = withQuestionReminder(base, 'а'.repeat(REMINDER_QUESTION_MAX + 50));
    expect(out[2]!.content).toContain(`${'а'.repeat(REMINDER_QUESTION_MAX)}…`);
  });
});
