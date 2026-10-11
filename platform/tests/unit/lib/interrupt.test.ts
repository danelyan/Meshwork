import { decideInterrupt, type AiStatus, type InterruptDecision } from '@/lib/interrupt';
import { isHardInterrupt } from '@/lib/sentences';

const cases: [string, AiStatus, InterruptDecision][] = [
  ['', 'speaking', 'ignore'],
  ['   ', 'idle', 'ignore'],
  ['угу', 'speaking', 'ignore'],
  ['Ага, понятно.', 'speaking', 'ignore'],
  ['хорошо', 'loading', 'ignore'],
  ['угу', 'thinking', 'ignore'],
  ['угу', 'idle', 'turn'],
  ['Хорошо', 'idle', 'turn'],
  ['Стоп!', 'speaking', 'hard'],
  ['подождите, я не договорил', 'thinking', 'hard'],
  ['Не надо дальше', 'loading', 'hard'],
  ['Погоди', 'speaking', 'hard'],
  ['стоп', 'idle', 'turn'],
  ['Я писал на Go пять лет', 'speaking', 'interrupt'],
  ['Я писал на Go пять лет', 'loading', 'queue'],
  ['Я писал на Go пять лет', 'thinking', 'queue'],
  ['Я писал на Go пять лет', 'idle', 'turn'],
  ['да, я с этим работал', 'speaking', 'interrupt'],
];

describe('decideInterrupt – семантический фильтр перебивания', () => {
  it.each(cases)('%j при %s → %s', (text, aiStatus, want) => {
    expect(decideInterrupt({ text, aiStatus })).toBe(want);
  });
});

describe('isHardInterrupt', () => {
  it.each([
    ['стоп', true],
    ['Стойте!', true],
    ['подожди секунду', true],
    ['ну подождите', false],
    ['не нужно повторять', true],
    ['Ещё минуту', false],
    ['Тише, пожалуйста', true],
    ['перестаньте', false],
    ['стопка книг', false],
    ['я не надо', false],
    ['', false],
  ])('%j → %s', (text, want) => {
    expect(isHardInterrupt(text as string)).toBe(want);
  });
});
