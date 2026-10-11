import { candidateStages, checklistProgress, employerStages, hasSavedAnswer, markStages, stageAnswer } from '@/server/consultant/stages';
import type { OnboardingView } from '@/server/onboarding/types';

const view = (over: Partial<OnboardingView>): OnboardingView => ({ history: [], summary: null, progress: { done: 0, total: 0 }, ...over }) as OnboardingView;
const row = (stepId: string, answer: string | null) => ({ stepId, lead: '', question: '', answer, editable: true });

describe('markStages – состояния этапов знакомства', () => {
  it('первый незакрытый этап – «сейчас», закрытые – «готово», остальные – «дальше»', () => {
    const s = markStages([
      { id: 'a', label: 'А', done: true, doneNote: 'Backend' },
      { id: 'b', label: 'Б', done: false, nextNote: 'потом' },
      { id: 'c', label: 'В', done: false, nextNote: 'подтверждает грейд' },
    ]);
    expect(s.map((x) => x.state)).toEqual(['done', 'now', 'next']);
    expect(s.map((x) => x.note)).toEqual(['Backend', 'сейчас', 'подтверждает грейд']);
  });

  it('закрытый этап после текущего остаётся закрытым; без подписей – «готово» и «дальше»', () => {
    const s = markStages([
      { id: 'a', label: 'А', done: false },
      { id: 'b', label: 'Б', done: true },
      { id: 'c', label: 'В', done: false },
    ]);
    expect(s.map((x) => x.state)).toEqual(['now', 'done', 'next']);
    expect(s.map((x) => x.note)).toEqual(['сейчас', 'готово', 'дальше']);
  });
});

describe('stageAnswer – ответ шага знакомства', () => {
  it('берёт ответ из ленты, пропущенный шаг и неизвестный шаг – null', () => {
    const v = view({ history: [row('grade', 'Middle'), row('city', null)] });
    expect(stageAnswer(v, 'grade')).toBe('Middle');
    expect(stageAnswer(v, 'city')).toBeNull();
    expect(stageAnswer(v, 'salary')).toBeNull();
    expect(stageAnswer(undefined, 'grade')).toBeNull();
  });

  it('итог знакомства важнее ленты', () => {
    const v = view({ history: [row('grade', 'Junior')], summary: { items: [{ stepId: 'grade', label: 'Предполагаемый грейд', value: 'Middle' }], skipped: [], warnings: [] } });
    expect(stageAnswer(v, 'grade')).toBe('Middle');
  });
});

describe('candidateStages – полоса кандидата', () => {
  const base = { specialization: null, claimedGrade: null, materials: false, terms: false, category: null, progress: { done: 0, total: 8 } };

  it('пять этапов в порядке макета; пустой профиль начинается со специализации', () => {
    const s = candidateStages(base);
    expect(s.title).toBe('Знакомство с Кирой');
    expect(s.items.map((x) => x.label)).toEqual(['Специализация', 'Грейд', 'Резюме и опыт', 'Условия', 'Тест']);
    expect(s.items.map((x) => x.state)).toEqual(['now', 'next', 'next', 'next', 'next']);
    expect(s.items[4]?.note).toBe('подтверждает грейд');
    expect({ done: s.done, total: s.total }).toEqual({ done: 0, total: 8 });
  });

  it('грейд со слов не закрывает тест: категорию даёт только тест', () => {
    const s = candidateStages({ ...base, specialization: 'Backend', claimedGrade: 'Middle', materials: true, terms: true });
    expect(s.items.map((x) => x.state)).toEqual(['done', 'done', 'done', 'done', 'now']);
    expect(s.items[1]?.note).toBe('Middle · со слов');
    expect(s.items[4]).toMatchObject({ id: 'test', note: 'сейчас' });
  });

  it('после теста этап «Тест» показывает категорию', () => {
    const s = candidateStages({ ...base, specialization: 'Backend', category: 'Backend · Middle' });
    expect(s.items[4]).toMatchObject({ state: 'done', note: 'Backend · Middle' });
    expect(s.items[1]).toMatchObject({ state: 'done', note: 'по тесту' });
    expect(s.items[2]?.state).toBe('now');
  });
});

describe('employerStages – полоса работодателя', () => {
  it('без ленты знакомства заполненность считается по этапам', () => {
    const s = employerStages({ company: 'Гранит Софт', industry: 'Финтех', contact: true, needs: 2, invitations: 0 });
    expect(s.title).toBe('Знакомство с компанией');
    expect(s.items.map((x) => x.state)).toEqual(['done', 'done', 'done', 'done', 'now']);
    expect(s.items[3]?.note).toBe('активных: 2');
    expect({ done: s.done, total: s.total }).toEqual({ done: 4, total: 5 });
  });

  it('с лентой знакомства заполненность – её прогресс', () => {
    const s = employerStages({ company: 'Гранит Софт', industry: null, contact: false, needs: 0, invitations: 0, progress: { done: 2, total: 11 } });
    expect({ done: s.done, total: s.total }).toEqual({ done: 2, total: 11 });
    expect(s.items[1]).toMatchObject({ id: 'industry', state: 'now' });
  });
});

describe('checklistProgress', () => {
  it('считает заполненные поля', () => {
    expect(checklistProgress([true, false, true])).toEqual({ done: 2, total: 3 });
  });
});

describe('hasSavedAnswer – сохранённые ответы знакомства без ленты', () => {
  it('ответ есть: непустая строка, непустой список, объект', () => {
    expect(hasSavedAnswer({ experience: 'oneToThree' }, 'experience')).toBe(true);
    expect(hasSavedAnswer({ formats: ['remote'] }, 'formats')).toBe(true);
    expect(hasSavedAnswer({ salary: { from: 100, to: 200 } }, 'salary')).toBe(true);
  });

  it('ответа нет: пусто, пробелы, нет ключа, не объект', () => {
    expect(hasSavedAnswer({ experienceSummary: '  ' }, 'experienceSummary')).toBe(false);
    expect(hasSavedAnswer({ formats: [] }, 'formats')).toBe(false);
    expect(hasSavedAnswer({ city: null }, 'city')).toBe(false);
    expect(hasSavedAnswer({}, 'experience')).toBe(false);
    expect(hasSavedAnswer(null, 'experience')).toBe(false);
    expect(hasSavedAnswer(['experience'], 'experience')).toBe(false);
  });
});
