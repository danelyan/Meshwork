import { describe, expect, it } from 'vitest';

import { ethicsNotice, rejectMessage, sensitiveTopics } from '@/server/defense-room/ethics';
import { decideFollowUp } from '@/server/defense-room/interviewer';
import { loadRoomPrompt, ROOM_PROMPT_VERSION } from '@/server/defense-room/prompts';
import type { PlanItem, TranscriptEntry } from '@/server/defense-room/types';
import { itemTurns } from '@/server/defense-room/verdict';
import type { CompleteRequest, LlmProvider } from '@/server/llm/types';

// Вопросы работодателя на защищённые темы (ст. 3, 64 ТК РФ) — все должны срабатывать.
const SENSITIVE: [string, string][] = [
  ['Сколько вам лет?', 'age'],
  ['Какой у вас возраст? Не помешает ли он работе в молодой команде?', 'age'],
  ['Год рождения уточните, пожалуйста', 'age'],
  ['Вы не слишком молоды для тимлида?', 'age'],
  ['Есть ли у вас дети?', 'family'],
  ['Планируете ли вы в ближайшие два года детей?', 'family'],
  ['Не собираетесь в декрет?', 'family'],
  ['Вы замужем? Муж не будет против командировок?', 'family'],
  ['Какое у вас семейное положение?', 'family'],
  ['Женат? Дети есть?', 'family'],
  ['А по национальности вы кто?', 'origin'],
  ['Откуда вы родом?', 'origin'],
  ['Какого вы веры?', 'religion'],
  ['Вы верующий? Соблюдаете пост?', 'religion'],
  ['У вас есть инвалидность?', 'health'],
  ['Есть хронические заболевания?', 'health'],
  ['Вы часто болеете?', 'health'],
  ['Какие у вас политические взгляды?', 'politics'],
  ['За кого вы голосовали?', 'politics'],
  ['Какая у вас сексуальная ориентация?', 'orientation'],
];

// Вопросы по делу, в том числе с «опасными» словами в техническом смысле — не должны срабатывать.
const LEGIT = [
  'Почему вы выбрали PostgreSQL, а не MongoDB для хранения платежей?',
  'Какой возраст записи в кэше вы считаете устаревшим и почему TTL 60 секунд?',
  'Как в React рендерятся дети компонента, если key не задан?',
  'Как вы обходите дочерние узлы дерева — рекурсией или стеком?',
  'Как устроен health check сервиса и что он проверяет?',
  'Готовы к командировкам раз в квартал?',
  'Какие у вас зарплатные ожидания?',
  'Как вы относитесь к переработкам перед релизом?',
  'Что будет, если два воркера вызовут drain одновременно?',
  'Почему в chargeWithRetry задержка растёт как степень двойки?',
  'Вы старались покрыть тестами граничные случаи?',
  'Как вы мигрировали старые записи из родительской таблицы в дочернюю?',
  'Расскажите про ориентацию экрана в мобильной версии — как обрабатывается поворот?',
  'Как вы считаете возраст аккаунта пользователя для антифрода?',
  'Какой самый сложный баг вы чинили в этом проекте?',
  'Сколько лет вы работаете с Kotlin?',
  'Есть ли у вас опыт с Kafka?',
  'Какую партию данных обрабатывает батч за один проход?',
  'Как система ведёт себя, когда сервис болеет — деградирует или падает?',
  'Почему семейство шрифтов подгружается отдельно?',
];

describe('этика вопросов работодателя', () => {
  it.each(SENSITIVE)('ловит: %s', (text, topic) => {
    expect(sensitiveTopics(text)).toContain(topic);
  });
  it.each(LEGIT)('не трогает вопрос по делу: %s', (text) => {
    expect(sensitiveTopics(text)).toEqual([]);
  });
  it('тексты отказа и ремарки называют тему и не обвиняют', () => {
    expect(rejectMessage(['age', 'family'])).toMatch(/возраст, семья и дети.*ТК РФ/);
    expect(ethicsNotice(['family'])).toMatch(/^Небольшая ремарка: вопрос про семья и дети не связан с работой/);
  });
});

let i = 0;
const e = (role: TranscriptEntry['role'], text: string, extra: Partial<TranscriptEntry> = {}): TranscriptEntry => ({ index: i++, role, text, at: '', tMs: 0, ...extra });

describe('ответ на личный вопрос работодателя не уходит оценщику', () => {
  it('после ремарки Киры реплики кандидата пропускаются до следующего вопроса', () => {
    const t = [
      e('ai', 'Что делает chargeWithRetry?', { defense: { kind: 'greeting', itemId: 'q1' } }),
      e('candidate', 'Повторяет платёж с экспоненциальной задержкой.'),
      e('employer', 'Есть ли у вас дети?', { defense: { companyId: 'co' } }),
      e('ai', ethicsNotice(['family']), { defense: { kind: 'notice', companyId: 'co' } }),
      e('candidate', 'Двое, младшему три года.'),
      e('employer', 'А почему не очередь?', { defense: { companyId: 'co' } }),
      e('candidate', 'Очередь дольше для клиента.'),
      e('ai', 'Спасибо. Вернёмся к вопросу. Что сломается при трёх экземплярах?', { defense: { kind: 'return', itemId: 'q2' } }),
      e('candidate', 'Set в памяти, дубль пройдёт.'),
    ];
    const turns = itemTurns(t);
    const all = JSON.stringify(turns);
    expect(all).not.toContain('младшему');
    expect(all).not.toContain('ремарка');
    expect(turns[0]!.qa[0]!.answer).toBe('Повторяет платёж с экспоненциальной задержкой.\nОчередь дольше для клиента.');
    expect(turns[1]!.qa[0]).toEqual({ question: 'Спасибо. Вернёмся к вопросу. Что сломается при трёх экземплярах?', answer: 'Set в памяти, дубль пройдёт.' });
  });
});

describe('промпты комнаты защиты', () => {
  it('версия поднята, правила аудита на месте', () => {
    expect(ROOM_PROMPT_VERSION).toBe('defense-room-prompts-v2-2026-10-12');
    const iv = loadRoomPrompt('interviewer');
    expect(iv).toContain('question_source');
    expect(iv).toMatch(/уточнение не нужно никогда/);
    expect(iv).toMatch(/не подсказывает ответ/);
    expect(loadRoomPrompt('qlc')).toMatch(/кандидат их не видит/);
    expect(loadRoomPrompt('evaluator')).toMatch(/повтор его терминов без нового факта/);
  });

  it('интервьюер получает источник вопроса', async () => {
    let seen: CompleteRequest | null = null;
    const llm = {
      name: 'cap',
      model: 'cap',
      supportsTools: false,
      supportsJsonSchema: true,
      async complete(req: CompleteRequest) {
        seen = req;
        return { kind: 'json', json: { ack: 'Поняла, спасибо', followUp: '' } };
      },
    } as unknown as LlmProvider;
    const item: PlanItem = { source: 'employer', id: 'e-1', employerQuestionId: '1', companyId: 'co', companyName: 'Альфа', question: 'Почему Postgres?', answered: true, followUps: 0 };
    await decideFollowUp(item, 'Нужны транзакции.', 0, llm);
    expect((seen as unknown as CompleteRequest).messages[0]!.content).toContain('<question_source>employer</question_source>');
  });
});
