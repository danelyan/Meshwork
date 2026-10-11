// Аудит промпта комнаты ИИнтервью (interviewer.md v2) и кода вокруг него — без сети.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { checkQuestion, shownGender } from '../../../eval/prompt-audit/interview-room/checks';
import { buildBlockPlan } from '@/server/interview/context';
import { INTERVIEW_PROMPT_VERSION, asksForAnswerAll, nextInterviewQuestion, repeatsAsked, stripPraise } from '@/server/interview/interviewer';
import { competenciesFor } from '@/server/interview/model';
import { INTERVIEW_CLOSING_LINE, INTERVIEW_LIMITS, type InterviewTurn, planInterviewNext, templateInterviewQuestion } from '@/server/interview/plan';
import { clearStubResponses, createStubProvider, registerStubResponse } from '@/server/llm/providers/stub';
import type { LlmProvider } from '@/server/llm/types';

const prompt = readFileSync(path.join(process.cwd(), 'src/server/interview/prompts/interviewer.md'), 'utf8');
const MASC = /(?<![а-яё])(ты )?(делал|сделал|принимал|отвечал|заплатил|получал|договаривался|вёл|разрешал|писал|строил|проверял|чинил|нашёл|мерил|менял|хранил|изолировал)(?![а-яё])/i;

afterEach(() => clearStubResponses());

describe('interviewer.md v2', () => {
  it('версия поднята', () => {
    expect(INTERVIEW_PROMPT_VERSION).toBe('interview-interviewer-v2');
  });

  it('вопросы в примерах — по одному «?» и без мужского рода о кандидате', () => {
    const qs = [...prompt.matchAll(/"question": "([^"]+)"/g)].map((m) => m[1]!);
    expect(qs.length).toBeGreaterThanOrEqual(4);
    for (const q of qs) {
      expect((q.match(/\?/g) ?? []).length).toBe(1);
      expect(q).not.toMatch(MASC);
    }
  });

  it('есть пример отказа на «сколько баллов»', () => {
    expect(prompt).toContain('Сколько у меня сейчас баллов');
    expect(prompt).toMatch(/Подсказать не могу/);
  });
});

describe('фокусы компетенций — без мужского рода о кандидате (уходят в вопрос, шаблон и подсказку)', () => {
  it.each(['backend', 'frontend', 'ai', 'engineering'] as const)('%s', (spec) => {
    for (const c of competenciesFor(spec)) for (const f of Object.values(c.focus)) expect(f).not.toMatch(MASC);
  });
});

describe('план: нет повтора вопроса, когда углублять некуда', () => {
  it('Senior, сильный ответ на уровне 3 в системном дизайне с одной компетенцией → следующий блок, а не тот же вопрос', () => {
    const plan = buildBlockPlan('backend', 'backend.highload', []);
    expect(plan.systems.length).toBe(1);
    const turns: InterviewTurn[] = [
      { question: 'q1', answer: 'a', competencyId: 'common.context', block: 'intro', level: 3 },
      { question: 'q2', answer: 'a', competencyId: plan.test[0]!.id, block: 'test', level: 3 },
      { question: 'q3', answer: 'a', competencyId: plan.test[1]!.id, block: 'test', level: 3 },
      { question: 'q4', answer: 'a', competencyId: plan.test[2]!.id, block: 'test', level: 3 },
      { question: 'q5', answer: 'a', competencyId: plan.systems[0]!.id, block: 'systems', level: 3 },
    ];
    const next = planInterviewNext({ plan, turns, grade: 'senior', signal: 'strong' });
    expect(next.block).toBe('team');
  });

  it('Middle: после сильного ответа уровня 2 в системном дизайне — углубление той же компетенции (как раньше)', () => {
    const plan = buildBlockPlan('backend', 'backend.web-api', []);
    const turns: InterviewTurn[] = [
      { question: 'q1', answer: 'a', competencyId: 'common.context', block: 'intro', level: 2 },
      { question: 'q2', answer: 'a', competencyId: plan.test[0]!.id, block: 'test', level: 2 },
      { question: 'q3', answer: 'a', competencyId: plan.test[1]!.id, block: 'test', level: 2 },
      { question: 'q4', answer: 'a', competencyId: plan.systems[0]!.id, block: 'systems', level: 2 },
    ];
    const next = planInterviewNext({ plan, turns, grade: 'middle', signal: 'strong' });
    expect(next).toMatchObject({ block: 'systems', level: 3 });
    expect(next.competency.id).toBe(plan.systems[0]!.id);
  });
});

describe('шаблон запасного вопроса — грамотный', () => {
  it('тема в именительном падеже, без «Про «…»»', () => {
    const plan = buildBlockPlan('frontend', 'frontend.ui-app', []);
    for (const c of plan.test) for (const lvl of [1, 2, 3] as const) {
      const q = templateInterviewQuestion(c, 'test', lvl, false);
      expect(q).not.toMatch(/Про «/);
      const t = /^[A-ZА-ЯЁ]{2}/.test(c.title) ? c.title : c.title.charAt(0).toLowerCase() + c.title.slice(1);
      expect(q).toContain(`тема — ${t}.`);
    }
    expect(templateInterviewQuestion(plan.intro[0]!, 'intro', 1, true)).toMatch(/четыре коротких блока/);
  });
});

describe('конец интервью без вызова LLM', () => {
  it('план закончен при любом сигнале → итоговая реплика, модель не вызывается', async () => {
    const plan = buildBlockPlan('backend', 'backend.web-api', []);
    const turns: InterviewTurn[] = [
      { question: 'q1', answer: 'a', competencyId: 'common.context', block: 'intro', level: 2 },
      { question: 'q2', answer: 'a', competencyId: plan.test[0]!.id, block: 'test', level: 2 },
      { question: 'q3', answer: 'a', competencyId: plan.test[1]!.id, block: 'test', level: 2 },
      { question: 'q4', answer: 'a', competencyId: plan.systems[0]!.id, block: 'systems', level: 2 },
      { question: 'q5', answer: 'a', competencyId: plan.systems[0]!.id, block: 'systems', level: 3 },
      { question: 'q6', answer: 'a', competencyId: 'common.teamwork', block: 'team', level: 2 },
    ];
    let calls = 0;
    const llm: LlmProvider = { ...createStubProvider(), complete: async () => { calls++; throw new Error('не должен вызываться'); } };
    const r = await nextInterviewQuestion({ specialization: 'backend', subcategoryId: 'backend.web-api', claimedGrade: 'middle', plan, testHints: [], resumeFacts: [], turns, limits: INTERVIEW_LIMITS }, llm);
    expect(calls).toBe(0);
    expect(r).toMatchObject({ done: true, question: INTERVIEW_CLOSING_LINE });
  });

  it('середина интервью — модель вызывается', async () => {
    let calls = 0;
    registerStubResponse('interview_interviewer', () => {
      calls++;
      return { json: { answerSignal: 'none', competencyId: 'common.context', question: 'Привет! Пройдём четыре коротких блока. Какая часть последнего проекта была на тебе?', done: false } };
    });
    const plan = buildBlockPlan('backend', 'backend.web-api', []);
    await nextInterviewQuestion({ specialization: 'backend', subcategoryId: 'backend.web-api', claimedGrade: 'middle', plan, testHints: [], resumeFacts: [], turns: [], limits: INTERVIEW_LIMITS }, createStubProvider());
    expect(calls).toBe(1);
  });
});

describe('проверки аудита (eval/prompt-audit/interview-room/checks.ts)', () => {
  const base = { index: 2, done: false, block: 'test', prev: [], lastAnswer: null, resumeFacts: [], signal: 'strong', interruptedTail: null };
  it('род кандидата: мужской род — нарушение, пока кандидат его не показал', () => {
    expect(checkQuestion({ ...base, question: 'Что ты сделал с ошибкой?' }).flags).toContain('gender_m');
    expect(checkQuestion({ ...base, question: 'Что ты сделал с ошибкой?', prev: [{ question: 'q', answer: 'Я отвечал за платежи' }] }).flags).not.toContain('gender_m');
    expect(shownGender(['я сделала вёрстку'])).toBe('f');
    expect(shownGender(['ну я отвечал за API'])).toBe('m');
  });
  it('два вопроса, похвала, «ты упомянул», отказ', () => {
    expect(checkQuestion({ ...base, question: 'Хорошо. Как? И почему?' }).flags).toEqual(expect.arrayContaining(['two_questions', 'ack_praise']));
    expect(checkQuestion({ ...base, question: 'Ты упомянул Redis — зачем он?' }).flags).toContain('retell_mention');
    expect(checkQuestion({ ...base, question: 'Давай про API: как версионируешь?', expect: { refusal: true } }).flags).toContain('no_refusal');
  });
});

describe('страховки кода вокруг модели', () => {
  it('«сколько баллов» и «я прав?» — отказ подсказать', () => {
    expect(asksForAnswerAll('Сколько у меня сейчас баллов? Я прав был в прошлом ответе?')).toBe(true);
    expect(asksForAnswerAll('Прав ли я?')).toBe(true);
    expect(asksForAnswerAll('Я сделал составной индекс по статусу и дате.')).toBe(false);
    expect(asksForAnswerAll('Думаю, справа налево — так правильнее читать план.')).toBe(false);
  });
  it('одобрение в начале снимается', () => {
    expect(stripPraise('Хорошо. Теперь про шардирование: по какому ключу?')).toBe('Теперь про шардирование: по какому ключу?');
    expect(stripPraise('Поняла. Что выберешь?')).toBe('Поняла. Что выберешь?');
  });
  it('повтор прошлого вопроса ловится по услышанному тексту', () => {
    const q = 'Теперь про проектирование. Представь сервис, который принимает 1000 заказов в секунду и хранит их историю за год. С чего начнёшь?';
    expect(repeatsAsked(q, [{ question: q }])).toBe(true);
    expect(repeatsAsked('Теперь усложним: заказов стало в десять раз больше. Что поменяешь первым?', [{ question: q }])).toBe(false);
  });

  it('модель повторила вопрос → повтор с подсказкой, принят новый', async () => {
    const q = 'Представь сервис, который принимает 1000 заказов в секунду и хранит их историю за год. С чего начнёшь?';
    const plan = buildBlockPlan('backend', 'backend.web-api', []);
    const turns: InterviewTurn[] = [{ question: q, answer: 'Начну с профиля нагрузки и схемы хранения, затем кэш и партиционирование по дате.', competencyId: 'common.context', block: 'intro', level: 2 }];
    const outs = [q, 'Теперь про данные: какой индекс поставишь под выборку по статусу и дате?'];
    let n = 0;
    registerStubResponse('interview_interviewer', () => ({ json: { answerSignal: 'strong', competencyId: plan.test[0]!.id, question: outs[n++]!, done: false } }));
    const r = await nextInterviewQuestion({ specialization: 'backend', subcategoryId: 'backend.web-api', claimedGrade: 'middle', plan, testHints: [], resumeFacts: [], turns, limits: INTERVIEW_LIMITS }, createStubProvider());
    expect(n).toBe(2);
    expect(r.question).toBe(outs[1]);
  });
});
