import { CALL_LIMITS, heuristicSignal, planNext, routeLevel, startLevel, type TopicSeed } from '@/server/call/plan';
import { resolveLevel } from '@/server/call/interviewer';

const topics: TopicSeed[] = [
  { topic: 'Индексы', catalogId: 'be.idx', claimStatement: 'Ускорял запросы индексами', resumeFact: null },
  { topic: 'Идемпотентность', catalogId: 'be.idem', claimStatement: null, resumeFact: null },
  { topic: 'Кэширование', catalogId: null, claimStatement: null, resumeFact: null },
];
const turn = (topic: string, level: 1 | 2 | 3, answer: string | null) => ({ question: 'Вопрос?', answer, topic, catalogId: null, level });

describe('маршрут по уровню (ADR 0003)', () => {
  it('после сильного ответа — глубже, после слабого — проще, в пределах 1..3', () => {
    expect(routeLevel(1, 'strong')).toBe(2);
    expect(routeLevel(2, 'strong')).toBe(3);
    expect(routeLevel(3, 'strong')).toBe(3);
    expect(routeLevel(3, 'weak')).toBe(2);
    expect(routeLevel(1, 'weak')).toBe(1);
    expect(routeLevel(2, 'none')).toBe(2);
  });

  it('стартовый уровень по заявленному грейду', () => {
    expect(startLevel('middle')).toBe(2);
    expect(startLevel('junior')).toBe(1);
    expect(startLevel(null)).toBe(1);
  });

  it('уровень считает код по сигналу модели, а не модель: та же тема — routeLevel, новая — стартовый', () => {
    const input = { specialization: 'backend', claimedGrade: 'junior' as const, topics, turns: [turn('Индексы', 2, 'ответ')], limits: CALL_LIMITS };
    expect(resolveLevel(input, 'Индексы', 'strong')).toBe(3);
    expect(resolveLevel(input, 'Индексы', 'weak')).toBe(1);
    expect(resolveLevel(input, 'Идемпотентность', 'strong')).toBe(1);
  });
});

describe('planNext — тема и уровень без модели (stub, запасной путь)', () => {
  it('первый вопрос — первая тема со стартового уровня', () => {
    expect(planNext({ topics, turns: [], grade: 'middle', signal: null })).toMatchObject({ topicIndex: 0, level: 2 });
  });

  it('сильный ответ — остаёмся на теме и копаем глубже', () => {
    const p = planNext({ topics, turns: [turn('Индексы', 1, 'x')], grade: 'junior', signal: 'strong' });
    expect(p).toMatchObject({ topicIndex: 0, level: 2, switched: false });
  });

  it('слабый ответ на базовом уровне — следующая тема', () => {
    const p = planNext({ topics, turns: [turn('Индексы', 1, 'не знаю')], grade: 'junior', signal: 'weak' });
    expect(p).toMatchObject({ topicIndex: 1, level: 1, switched: true });
  });

  it('после вопроса уровня 3 или двух вопросов по теме — новая непроверенная тема', () => {
    expect(planNext({ topics, turns: [turn('Индексы', 3, 'x')], grade: 'middle', signal: 'strong' })).toMatchObject({ topicIndex: 1, switched: true });
    const two = [turn('Индексы', 1, 'x'), turn('Индексы', 2, 'x')];
    expect(planNext({ topics, turns: two, grade: 'junior', signal: 'strong' })).toMatchObject({ topicIndex: 1 });
  });

  it('эвристика сигнала: «не знаю» и короткое — слабо, развёрнутое — сильно', () => {
    expect(heuristicSignal('Не знаю')).toBe('weak');
    expect(heuristicSignal('a'.repeat(200))).toBe('strong');
    expect(heuristicSignal('Средний по длине ответ про индексы и планы запросов')).toBe('none');
    expect(heuristicSignal(null)).toBe('none');
  });
});
