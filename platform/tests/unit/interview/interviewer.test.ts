import { buildBlockPlan } from '@/server/interview/context';
import { type InterviewerInput, buildInterviewerPayload, nextInterviewQuestion } from '@/server/interview/interviewer';
import { INTERVIEW_LIMITS, type InterviewTurn } from '@/server/interview/plan';
import { clearStubResponses, createStubProvider, registerStubResponse } from '@/server/llm/providers/stub';

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
const long = 'Я отвечал за сервис платежей: переписал обработку очереди, добавил идемпотентность по ключу запроса, измерил задержку до и после — она упала вдвое, потому что убрали синхронный вызов.';

afterEach(() => clearStubResponses());

describe('интервьюер ИИнтервью на stub-провайдере', () => {
  it('первый вопрос — знакомство, meta с компетенцией и блоком, озвучиваемый русский текст', async () => {
    const r = await nextInterviewQuestion(base, createStubProvider());
    expect(r.meta).toMatchObject({ competencyId: 'common.context', block: 'intro', level: 2, routedBy: null, catalogId: null, topic: 'Контекст и роль' });
    expect(r.question).toMatch(/[а-яё]/i);
    expect(r.done).toBe(false);
  });

  it('полный прогон на stub: блоки по порядку, done после последнего, вопросов в лимитах', async () => {
    const llm = createStubProvider();
    const turns: InterviewTurn[] = [];
    let done = false;
    for (let i = 0; i < 12 && !done; i++) {
      const r = await nextInterviewQuestion({ ...base, turns }, llm);
      done = r.done;
      if (!done) turns.push({ question: r.question, answer: long, competencyId: r.meta.competencyId!, block: r.meta.block!, level: r.meta.level });
    }
    expect(done).toBe(true);
    expect(turns.length).toBeGreaterThanOrEqual(INTERVIEW_LIMITS.minQuestions);
    expect(turns.length).toBeLessThanOrEqual(INTERVIEW_LIMITS.maxQuestions);
    const blocks = [...new Set(turns.map((t) => t.block))];
    expect(blocks).toEqual(['intro', 'test', 'systems', 'team']);
    // Пометка по тесту: компетенция с ошибками идёт первой среди не-ядра — после ядра web-api.
    const payload = buildInterviewerPayload(base);
    expect(payload.blocks.find((b) => b.id === 'test')!.competencies.find((c) => c.id === 'backend.data')!.test).toEqual({ wrong: 1, right: 0 });
  });

  it('модель назвала компетенцию не по плану дважды → вопрос из шаблона по плану', async () => {
    let calls = 0;
    registerStubResponse('interview_interviewer', () => {
      calls++;
      return { json: { answerSignal: 'none', competencyId: 'backend.security', question: 'Расскажи про хранение паролей и токены?', done: false } };
    });
    const r = await nextInterviewQuestion(base, createStubProvider());
    expect(calls).toBe(2);
    expect(r.meta.fallback).toBe(true);
    expect(r.meta.competencyId).toBe('common.context');
  });

  it('невалидный JSON → одна повторная попытка с подсказкой; валидный второй ответ принимается', async () => {
    const outs = [{ json: { nonsense: true } }, { json: { answerSignal: 'none', competencyId: 'common.context', question: 'Привет! Расскажи про последний проект и свою роль в нём?', done: false } }];
    let n = 0;
    registerStubResponse('interview_interviewer', () => outs[n++]);
    const r = await nextInterviewQuestion(base, createStubProvider());
    expect(n).toBe(2);
    expect(r.meta.fallback).toBeUndefined();
    expect(r.question).toContain('последний проект');
  });

  it('пересказ резюме → одна переформулировка, затем шаблон', async () => {
    const outs = [
      { json: { answerSignal: 'none', competencyId: 'common.context', question: 'Привет! Ты переписал очередь платежей на Kafka и снизил задержку вдвое — расскажи, как?', done: false } },
      { json: { answerSignal: 'none', competencyId: 'common.context', question: 'Привет! Расскажи про последний проект: за что отвечал лично ты?', done: false } },
    ];
    let n = 0;
    registerStubResponse('interview_interviewer', () => outs[n++]);
    const r = await nextInterviewQuestion(base, createStubProvider());
    expect(n).toBe(2);
    expect(r.question).toContain('последний проект');
    expect(r.meta.fallback).toBeUndefined();
  });

  it('дополнительный вопрос: компетенция и уровень заданы кодом, meta.probe', async () => {
    const c = base.plan.test[0]!;
    const turns: InterviewTurn[] = [
      { question: 'q1', answer: long, competencyId: 'common.context', block: 'intro', level: 2 },
      { question: 'q2', answer: 'не знаю', competencyId: c.id, block: 'test', level: 2 },
    ];
    const r = await nextInterviewQuestion({ ...base, turns, force: { competency: c, block: 'test', level: 1 } }, createStubProvider());
    expect(r.meta).toMatchObject({ competencyId: c.id, block: 'test', level: 1, probe: 'inconclusive' });
    expect(r.done).toBe(false);
    const p = buildInterviewerPayload({ ...base, turns, force: { competency: c, block: 'test', level: 1 } });
    expect(p.next.probe).toBe(true);
    expect(p.next.ifStrong.competencyId).toBe(c.id);
  });

  it('модель недоступна (503) → шаблон, интервью не падает', async () => {
    registerStubResponse('interview_interviewer', () => {
      throw new Error('503');
    });
    const r = await nextInterviewQuestion(base, createStubProvider());
    expect(r.meta.fallback).toBe(true);
    expect(r.question.length).toBeGreaterThan(20);
  });
});

describe('перебивание в плане интервьюера', () => {
  it('ход с interrupted уходит модели с услышанным текстом и недосказанным хвостом', () => {
    const turns: InterviewTurn[] = [
      { question: 'Привет! Расскажи про проект. …(перебит)', answer: 'Я делал платёжный сервис', competencyId: 'common.context', block: 'intro', level: 2, interrupted: { heardSentences: 1, tail: 'За что отвечал лично ты?' } },
    ];
    const p = buildInterviewerPayload({ ...base, turns });
    expect(p.turns[0]).toMatchObject({ question: 'Привет! Расскажи про проект. …(перебит)', interrupted: { heardSentences: 1, unspokenTail: 'За что отвечал лично ты?' } });
    expect(buildInterviewerPayload(base).turns).toEqual([]);
  });
});
