// ИИнтервью в потоковом режиме (лейн call-speed): компетенция по плану проверяется до первого предложения.
import { buildBlockPlan } from '@/server/interview/context';
import { type InterviewerInput, nextInterviewQuestion, plannedFor } from '@/server/interview/interviewer';
import { INTERVIEW_LIMITS } from '@/server/interview/plan';
import { startsWithSentences } from '@/server/call/stream';
import type { CompleteResult, LlmProvider } from '@/server/llm/types';

const base: InterviewerInput = {
  specialization: 'backend',
  subcategoryId: 'backend.web-api',
  claimedGrade: 'middle',
  plan: buildBlockPlan('backend', 'backend.web-api', [{ competencyId: 'backend.data', wrong: 1, right: 0 }]),
  testHints: [{ competencyId: 'backend.data', wrong: 1, right: 0 }],
  resumeFacts: ['переписал очередь платежей на Kafka и снизил задержку вдвое'],
  turns: [],
  limits: INTERVIEW_LIMITS,
};

function llm(raws: string[]): LlmProvider & { n: number } {
  const p = {
    name: 'f', model: 'f', supportsTools: true, supportsJsonSchema: true, n: 0,
    async complete(req: Parameters<LlmProvider['complete']>[0]): Promise<CompleteResult> {
      const raw = raws[Math.min(p.n++, raws.length - 1)]!;
      for (let i = 0; i < raw.length; i += 5) req.onJsonDelta?.(raw.slice(i, i + 5));
      return { kind: 'json', json: JSON.parse(raw), usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, provider: 'f', model: 'f' };
    },
  };
  return p;
}

describe('nextInterviewQuestion: потоковый режим', () => {
  it('компетенция по плану — предложения уходят, реплика начинается с них', async () => {
    const id = plannedFor(base, null).competency.id;
    const got: string[] = [];
    const r = await nextInterviewQuestion(base, llm([JSON.stringify({ answerSignal: 'none', competencyId: id, question: 'Привет, я интервьюер, у нас четыре блока. Расскажи про свой последний проект: за что отвечал лично ты?', done: false })]), undefined, { closable: false, onSentence: (t) => got.push(t) });
    expect(got.length).toBe(2);
    expect(startsWithSentences(r.question, got)).toBe(true);
    expect(r.meta.competencyId).toBe(id);
  });

  it('компетенция не по плану — молчит, переформулировка; вторая попытка стримится', async () => {
    const id = plannedFor(base, null).competency.id;
    const got: string[] = [];
    const p = llm([
      JSON.stringify({ answerSignal: 'none', competencyId: 'backend.data', question: 'Неверная компетенция, длинное начало. Вопрос?', done: false }),
      JSON.stringify({ answerSignal: 'none', competencyId: id, question: 'Привет, я интервьюер, начнём с контекста. Чем ты занимался последний год?', done: false }),
    ]);
    const r = await nextInterviewQuestion(base, p, undefined, { closable: false, onSentence: (t) => got.push(t) });
    expect(p.n).toBe(2);
    expect(got.join(' ')).not.toContain('Неверная');
    expect(r.question).toContain('Чем ты занимался');
  });
});
