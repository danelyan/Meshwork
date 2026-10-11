// Аудит промпта интервьюера созвона (лейн call-interviewer, 12.10): поток при алфавитном порядке ключей
// (DeepSeek на Yandex), удержание правила смены темы кодом, цифры из резюме, отказ без дубля, промпт
// без несуществующего next.level и без мужского рода в примерах.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildPayload, mustLeave, nextCallQuestion, quotesProfileNumber, type InterviewerInput } from '@/server/call/interviewer';
import { CALL_LIMITS, REFUSED_RE, withRefusal } from '@/server/call/plan';
import { CallInterviewerOutput } from '@/server/call/schemas';
import type { CompleteRequest, CompleteResult, LlmProvider } from '@/server/llm/types';

const topics = [
  { topic: 'Делал игры на Unity', catalogId: 'gd.unity', claimStatement: 'Делал игры на Unity', resumeFact: 'платформер на Unity за 3 месяца, 60 FPS' },
  { topic: 'Физика и столкновения', catalogId: 'gd.physics', claimStatement: 'Физика и столкновения', resumeFact: null },
  { topic: 'Игровой UI', catalogId: 'gd.ui', claimStatement: 'Игровой UI', resumeFact: null },
];
const base: InterviewerInput = { specialization: 'gamedev', claimedGrade: 'junior', topics, turns: [], limits: CALL_LIMITS };
const weakL1: InterviewerInput = {
  ...base,
  turns: [{ topic: topics[0]!.topic, catalogId: 'gd.unity', level: 1, question: 'Привет! Чем Update отличается от FixedUpdate?', answer: 'Ну они оба вызываются, я всё в Update пишу.' }],
};

/** Провайдер: стримит сырой JSON кусками; фиксирует, сколько символов ушло до первого предложения. */
function fake(replies: string[]): LlmProvider & { calls: CompleteRequest[]; firstAt: number[] } {
  const calls: CompleteRequest[] = [];
  const firstAt: number[] = [];
  return {
    name: 'fake', model: 'fake', supportsTools: true, supportsJsonSchema: true, calls, firstAt,
    async complete(req): Promise<CompleteResult> {
      calls.push(req);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
      for (let i = 0; i < r.length; i += 4) req.onJsonDelta?.(r.slice(i, i + 4));
      return { kind: 'json', json: JSON.parse(r), usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, provider: 'fake', model: 'fake' };
    },
  };
}

describe('интервьюер созвона: поток при алфавитном порядке ключей', () => {
  it('тема по catalogId — первое предложение уходит до поля topic', async () => {
    // Порядок как у DeepSeek на Yandex: answerSignal, catalogId, done, question, topic.
    const raw = '{"answerSignal":"weak","catalogId":"gd.physics","done":false,"question":"Теперь про физику. Как ты настраиваешь столкновения в игре?","topic":"Физика и столкновения"}';
    const llm = fake([raw]);
    const sent: string[] = [];
    let topicSeenAtFirst: boolean | null = null;
    const orig = llm.complete.bind(llm);
    let buf = '';
    llm.complete = (req, s) =>
      orig({ ...req, onJsonDelta: (c) => { buf += c; req.onJsonDelta?.(c); } }, s);
    const out = await nextCallQuestion(weakL1, llm, undefined, {
      onSentence: (t) => {
        if (topicSeenAtFirst === null) topicSeenAtFirst = buf.includes('"topic"');
        sent.push(t);
      },
      closable: false,
    });
    expect(sent[0]).toBe('Теперь про физику.');
    expect(topicSeenAtFirst).toBe(false);
    expect(out.meta).toMatchObject({ topic: 'Физика и столкновения', catalogId: 'gd.physics' });
  });

  it('done в схеме идёт до question', () => {
    const keys = Object.keys(CallInterviewerOutput.shape);
    expect(keys.indexOf('done')).toBeLessThan(keys.indexOf('question'));
  });
});

describe('смена темы держит код (mustLeave)', () => {
  it('слабый ответ на уровне 1 — уйти; сильный — остаться; none — остаться', () => {
    expect(mustLeave(weakL1, topics[0]!.topic, 'weak')).toBe(true);
    expect(mustLeave(weakL1, topics[0]!.topic, 'strong')).toBe(false);
    expect(mustLeave(weakL1, topics[0]!.topic, 'none')).toBe(false);
    expect(mustLeave(weakL1, topics[1]!.topic, 'weak')).toBe(false);
  });

  it('payload говорит модели, что делать с текущей темой', () => {
    expect(buildPayload(weakL1).next).toMatchObject({ currentTopic: topics[0]!.topic, afterStrong: 'stay', afterWeak: 'switch' });
    expect(buildPayload(base).next).toMatchObject({ currentTopic: null, afterStrong: 'stay', afterWeak: 'stay' });
  });

  it('модель осталась на теме после слабого L1 → одна переделка, вопрос по другой теме', async () => {
    const stay = JSON.stringify({ answerSignal: 'weak', topic: topics[0]!.topic, catalogId: 'gd.unity', done: false, question: 'Хорошо. А почему физику выносят в FixedUpdate?' });
    const move = JSON.stringify({ answerSignal: 'weak', topic: topics[1]!.topic, catalogId: 'gd.physics', done: false, question: 'Теперь про физику. Как ты настраиваешь столкновения?' });
    const llm = fake([stay, move]);
    const out = await nextCallQuestion(weakL1, llm);
    expect(llm.calls).toHaveLength(2);
    expect(out.meta.topic).toBe(topics[1]!.topic);
    expect(out.question).toContain('столкновения');
  });
});

describe('цифры из резюме и отказ', () => {
  it('число из факта резюме в вопросе — пересказ; числа внутри слов — нет', () => {
    const facts = ['платформер на Unity за 3 месяца, 60 FPS', 'прошивка на STM32F4'];
    expect(quotesProfileNumber('Как ты держишь 60 FPS на мобильных?', facts)).toBe(true);
    expect(quotesProfileNumber('Как ты держишь стабильный FPS?', facts)).toBe(false);
    expect(quotesProfileNumber('Что важно в прошивке для STM32?', facts)).toBe(false);
  });

  it('отказ модели другими словами не дублируется отказом кода', () => {
    expect(REFUSED_RE.test('Оценку я не ставлю — её разбирает отдельный оценщик.')).toBe(true);
    expect(REFUSED_RE.test('Оценивать не буду.')).toBe(true);
    const q = 'Оценку не скажу — её разбирает оценщик. Почему порядок колонок такой?';
    expect(withRefusal(q, 'Какая у меня оценка?')).toBe(q);
  });
});

describe('промпт interviewer.md', () => {
  const md = readFileSync(join(process.cwd(), 'src/server/call/prompts/interviewer.md'), 'utf8');
  it('ссылается только на поля next, которые есть в payload', () => {
    const next = buildPayload(weakL1).next as Record<string, unknown>;
    const refs = [...md.matchAll(/next\.([a-zA-Z]+)/g)].map((m) => m[1]!);
    const known = new Set([...Object.keys(next), 'probeTopic', 'probeLevel']);
    expect(refs.filter((r) => !known.has(r))).toEqual([]);
  });

  it('примеры: done до question, без мужского рода к кандидату', () => {
    const examples = md.slice(md.indexOf('<examples>'), md.indexOf('</examples>'));
    for (const m of examples.matchAll(/\{"answerSignal".*\}/g)) {
      const s = m[0];
      expect(s.indexOf('"done"')).toBeLessThan(s.indexOf('"question"'));
      expect(s).not.toMatch(/(?<![а-яё])ты\s+[а-яё]+(?:л|лся)(?![а-яё])/i);
    }
  });
});
