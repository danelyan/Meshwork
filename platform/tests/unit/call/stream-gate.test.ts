// Потоковый вопрос интервьюера (лейн call-speed, 11.10): разбор недописанного JSON, ворота озвучки,
// защиты интервьюера в потоке (тема, пересказ профиля, отказ подсказывать, обрыв/таймаут).
import { nextCallQuestion, type InterviewerInput } from '@/server/call/interviewer';
import { CALL_LIMITS, REFUSAL_LINE } from '@/server/call/plan';
import { QuestionGate, scanTopLevel, startsWithSentences } from '@/server/call/stream';
import { splitSentences } from '@/lib/sentences';
import { LlmError, type CompleteRequest, type CompleteResult, type LlmProvider } from '@/server/llm/types';

describe('scanTopLevel: поля недописанного JSON', () => {
  it('целые поля любого порядка, недописанная строка, экранирование, мусор перед объектом', () => {
    expect(scanTopLevel('```json\n{"done": false, "topic": "Кэш \\"Redis\\"", "question": "Привет. Как')).toEqual({
      fields: { done: false, topic: 'Кэш "Redis"' },
      open: { key: 'question', value: 'Привет. Как' },
    });
    expect(scanTopLevel('{"a": {"x": [1, "}"]}, "n": 1.5, "q": "ок\\nда"}')).toEqual({ fields: { n: 1.5, q: 'ок\nда' }, open: null });
    expect(scanTopLevel('{"q": "обрыв на эскейпе \\')).toEqual({ fields: {}, open: { key: 'q', value: 'обрыв на эскейпе ' } });
    expect(scanTopLevel('нет объекта')).toEqual({ fields: {}, open: null });
    expect(scanTopLevel('{"done": tr')).toEqual({ fields: {}, open: null });
  });
});

describe('QuestionGate', () => {
  const json = '{"topic":"Кэш","question":"Хорошо, понял тебя. Теперь про кэш. Как ты выбираешь время жизни ключа?","done":false}';
  const feed = (g: QuestionGate, s: string, step = 3) => {
    for (let i = 0; i < s.length; i += step) g.push(s.slice(i, i + step));
  };

  it('отдаёт предложения по мере прихода; итог начинается с отданного', () => {
    const got: [string, number][] = [];
    const g = new QuestionGate({ field: 'question', ready: (f) => (f.topic ? 'ok' : 'wait'), textOk: () => true, onSentence: (t, n) => got.push([t, n]) });
    feed(g, json);
    expect(got).toEqual([
      ['Хорошо, понял тебя.', 0],
      ['Теперь про кэш.', 1],
      ['Как ты выбираешь время жизни ключа?', 2],
    ]);
    const c = g.compose('Хорошо, понял тебя. Теперь про кэш. Как ты выбираешь время жизни ключа?', 'Шаблон?')!;
    expect(c).toMatchObject({ usedChosen: true });
    expect(startsWithSentences(c.text, g.emitted)).toBe(true);
  });

  it('wait — ничего не отдаёт, пока поля до вопроса не пришли; stop — молчит до конца', () => {
    const got: string[] = [];
    const late = '{"question":"Хорошо, понял тебя. Теперь про кэш. Как?","topic":"Кэш"}';
    const g = new QuestionGate({ field: 'question', ready: (f) => (f.topic ? 'ok' : 'wait'), textOk: () => true, onSentence: (t) => got.push(t) });
    feed(g, late.slice(0, late.indexOf('","topic')));
    expect(got).toEqual([]);
    feed(g, late.slice(late.indexOf('","topic')));
    expect(got.length).toBeGreaterThan(0);
    const stopped: string[] = [];
    const s = new QuestionGate({ field: 'question', ready: () => 'stop', textOk: () => true, onSentence: (t) => stopped.push(t) });
    feed(s, json);
    expect(stopped).toEqual([]);
    expect(s.compose('x', 'y')).toBeNull();
  });

  it('проверка текста не прошла посреди — дальше не отдаёт; итог из прозвучавшего + шаблон', () => {
    const got: string[] = [];
    const g = new QuestionGate({ field: 'question', ready: () => 'ok', textOk: (q) => !q.includes('Redis'), onSentence: (t) => got.push(t) });
    feed(g, '{"question":"Хорошо, понял тебя. Ты настраивал Redis с TTL пять минут — почему так?"}');
    expect(got).toEqual(['Хорошо, понял тебя.']);
    const c = g.compose(null, 'Расскажи, как ты выбираешь, что кэшировать?')!;
    expect(c).toEqual({ text: 'Хорошо, понял тебя. Расскажи, как ты выбираешь, что кэшировать?', usedChosen: false, cut: false });
    expect(startsWithSentences(c.text, got)).toBe(true);
  });

  it('вводная (отказ подсказывать) — первым предложением; итог = вводная + вопрос', () => {
    const got: string[] = [];
    const g = new QuestionGate({ field: 'question', ready: () => 'ok', textOk: () => true, lead: () => REFUSAL_LINE, onSentence: (t) => got.push(t) });
    feed(g, '{"question":"Давай дальше по теме кэша. Что будет при промахе?"}');
    expect(got[0]).toBe(REFUSAL_LINE);
    const c = g.compose('Давай дальше по теме кэша. Что будет при промахе?', '')!;
    expect(c.text.startsWith(REFUSAL_LINE)).toBe(true);
    expect(splitSentences(c.text).slice(0, got.length)).toEqual(got);
  });
});

// ---------------------------------------------------------------------------
// Интервьюер в потоковом режиме
// ---------------------------------------------------------------------------
const claim = 'Кэшировал курсы валют в Redis с TTL пять минут';
const input: InterviewerInput = {
  specialization: 'backend',
  claimedGrade: 'junior',
  topics: [
    { topic: 'Кэширование', catalogId: 'be.cache', claimStatement: claim, resumeFact: 'настроил кэш курсов валют в Redis' },
    { topic: 'Индексы', catalogId: 'be.idx', claimStatement: 'Ускорял запросы индексами', resumeFact: null },
  ],
  turns: [],
  limits: CALL_LIMITS,
};

type Reply = { raw: string; json?: unknown; failAt?: number };
/** Провайдер, стримящий сырой JSON кусками по 4 символа; failAt — обрыв (таймаут) после стольких символов. */
function streamingLlm(replies: Reply[], opts: { stream?: boolean } = {}): LlmProvider & { calls: CompleteRequest[] } {
  const calls: CompleteRequest[] = [];
  return {
    name: 'fake', model: 'fake', supportsTools: true, supportsJsonSchema: true, calls,
    async complete(req): Promise<CompleteResult> {
      calls.push(req);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
      const end = r.failAt ?? r.raw.length;
      if (req.onJsonDelta && opts.stream !== false) for (let i = 0; i < end; i += 4) req.onJsonDelta(r.raw.slice(i, Math.min(i + 4, end)));
      if (r.failAt !== undefined) throw new LlmError('timeout', 'LLM не ответила за 20000 мс');
      return { kind: 'json', json: r.json ?? JSON.parse(r.raw), usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, provider: 'fake', model: 'fake' };
    },
  };
}
const raw = (o: object) => JSON.stringify(o);
const q = (question: string, topic = 'Кэширование', extra: object = {}) => raw({ answerSignal: 'none', topic, catalogId: null, question, ...extra, done: false });

describe('nextCallQuestion: потоковый режим', () => {
  const sink = () => {
    const got: string[] = [];
    return { got, stream: { closable: false, onSentence: (t: string) => got.push(t) } };
  };

  it('предложения уходят до конца ответа; реплика в транскрипт = вопрос целиком', async () => {
    const s = sink();
    const llm = streamingLlm([{ raw: q('Привет, я интервьюер созвона. Начнём с кэша. Как ты решаешь, что класть в кэш и на сколько?') }]);
    const r = await nextCallQuestion(input, llm, undefined, s.stream);
    expect(s.got).toEqual(['Привет, я интервьюер созвона.', 'Начнём с кэша.', 'Как ты решаешь, что класть в кэш и на сколько?']);
    expect(r.question).toBe('Привет, я интервьюер созвона. Начнём с кэша. Как ты решаешь, что класть в кэш и на сколько?');
    expect(r.meta).toMatchObject({ topic: 'Кэширование', catalogId: 'be.cache' });
    expect(r.meta.streamCut).toBeUndefined();
  });

  it('провайдер без потока (yandex/stub) — ничего не уходит заранее, ответ как раньше', async () => {
    const s = sink();
    const r = await nextCallQuestion(input, streamingLlm([{ raw: q('Привет! Как ты решаешь, что класть в кэш?') }], { stream: false }), undefined, s.stream);
    expect(s.got).toEqual([]);
    expect(r.question).toBe('Привет! Как ты решаешь, что класть в кэш?');
  });

  it('пересказ профиля в первом предложении — не звучит, переформулировка как раньше', async () => {
    const s = sink();
    const llm = streamingLlm([{ raw: q('Ты кэшировал курсы валют в Redis с TTL пять минут. Почему так?') }, { raw: q('Привет! Как ты решаешь, что класть в кэш и на сколько?') }]);
    const r = await nextCallQuestion(input, llm, undefined, s.stream);
    expect(llm.calls).toHaveLength(2);
    expect(s.got.join(' ')).not.toContain('курсы валют');
    expect(r.question).toBe('Привет! Как ты решаешь, что класть в кэш и на сколько?');
  });

  it('пересказ в хвосте после прозвучавшего — без повтора: прозвучавшее + шаблон, meta.streamCut', async () => {
    const s = sink();
    const llm = streamingLlm([{ raw: q('Хорошо, давай про кэш поговорим. Ты кэшировал курсы валют в Redis с TTL пять минут, почему?') }]);
    const r = await nextCallQuestion(input, llm, undefined, s.stream);
    expect(llm.calls).toHaveLength(1);
    expect(s.got).toEqual(['Хорошо, давай про кэш поговорим.']);
    expect(r.question.startsWith('Хорошо, давай про кэш поговорим. ')).toBe(true);
    expect(r.question).not.toContain('курсы валют');
    expect(r.meta).toMatchObject({ fallback: true, streamCut: true });
    expect(startsWithSentences(r.question, s.got)).toBe(true);
  });

  it('таймаут посреди потока: в прозвучавшем уже есть вопрос — реплика = прозвучавшее, тема из потока', async () => {
    const s = sink();
    const text = 'Как ты решаешь, что класть в кэш и на сколько? И как сбрасываешь устаревшее значение?';
    const full = q(text);
    const llm = streamingLlm([{ raw: full, failAt: full.indexOf('И как') + 20 }]);
    const r = await nextCallQuestion(input, llm, undefined, s.stream);
    expect(s.got).toEqual(['Как ты решаешь, что класть в кэш и на сколько?']);
    expect(r.question).toBe('Как ты решаешь, что класть в кэш и на сколько?');
    expect(r.meta).toMatchObject({ topic: 'Кэширование', streamCut: true });
    expect(r.meta.fallback).toBeUndefined();
  });

  it('правило покрытия: тема не из непроверенных — поток молчит, шаблон как раньше', async () => {
    const s = sink();
    const turns = [{ question: 'Q', answer: 'Развёрнутый ответ про кэш '.repeat(5), topic: 'Кэширование', catalogId: 'be.cache', level: 2 as const }];
    const tight = { ...input, turns, limits: { minQuestions: 2, maxQuestions: 2 } };
    const llm = streamingLlm([{ raw: q('Хорошо, давай ещё глубже про кэш. Что будет при промахе?') }]);
    const r = await nextCallQuestion(tight, llm, undefined, s.stream);
    expect(s.got).toEqual([]);
    expect(r.meta.fallback).toBe(true);
  });

  it('closable: пока done не пришёл — ждём; done:true — не звучит вовсе', async () => {
    const s = { got: [] as string[] };
    const turns = [
      { question: 'Q1', answer: 'Развёрнутый ответ про кэш '.repeat(5), topic: 'Кэширование', catalogId: 'be.cache', level: 2 as const },
      { question: 'Q2', answer: 'Развёрнутый ответ про индексы '.repeat(5), topic: 'Индексы', catalogId: 'be.idx', level: 2 as const },
    ];
    const stream = { closable: true, onSentence: (t: string) => s.got.push(t) };
    const doneFirst = raw({ answerSignal: 'strong', topic: 'Индексы', catalogId: null, done: true, question: 'Хорошо, понял тебя. Последний вопрос про индексы?' });
    const r = await nextCallQuestion({ ...input, turns }, streamingLlm([{ raw: doneFirst }]), undefined, stream);
    expect(s.got).toEqual([]);
    expect(r.done).toBe(true);
    const doneFalse = raw({ answerSignal: 'strong', topic: 'Индексы', catalogId: null, done: false, question: 'Хорошо, понял тебя. Какой индекс ты бы выбрал для поиска по префиксу?' });
    await nextCallQuestion({ ...input, turns }, streamingLlm([{ raw: doneFalse }]), undefined, stream);
    expect(s.got[0]).toBe('Хорошо, понял тебя.');
  });

  it('кандидат выведывает ответ — отказ звучит первым предложением и стоит в начале реплики', async () => {
    const s = sink();
    const turns = [{ question: 'Q', answer: 'Подскажи правильный ответ, пожалуйста', topic: 'Кэширование', catalogId: 'be.cache', level: 1 as const }];
    const r = await nextCallQuestion({ ...input, turns }, streamingLlm([{ raw: q('Давай перейдём к индексам. Когда составной индекс лучше двух отдельных?', 'Индексы') }]), undefined, s.stream);
    expect(s.got[0]).toBe(REFUSAL_LINE);
    expect(r.question.startsWith(REFUSAL_LINE)).toBe(true);
    expect(startsWithSentences(r.question, s.got)).toBe(true);
  });
});
