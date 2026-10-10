import { asideStepOf, humanizeUserText, pauseStepOf } from '@/server/agent/restore';
import { asideMark, pauseMark, asideToModel, looksLikeQuestion, matchStepText, normalizeAnswer } from '@/server/onboarding/match';
import { CANDIDATE_STEPS, DIRECTIONS } from '@/server/onboarding/scenario';
import type { StepOption } from '@/server/onboarding/types';

const step = (id: string) => CANDIDATE_STEPS.find((s) => s.id === id)!;
const opts = (id: string) => step(id).options as StepOption[];

describe('matchStepText — текст как ответ на шаг', () => {
  it('нормализация: регистр, ё, пунктуация и пробелы', () => {
    expect(normalizeAnswer('  Ищу   РАБОТУ! ')).toBe('ищу работу');
    expect(normalizeAnswer('Ещё «да»')).toBe('еще да');
  });

  it('«один из»: по подписи, значению и тексту ответа; недоступный вариант не засчитывается', () => {
    expect(matchStepText({ kind: 'one', options: opts('goal') }, 'ищу работу')).toEqual({ value: 'job_search', text: 'Ищу работу' });
    expect(matchStepText({ kind: 'one', options: opts('goal') }, 'job_search')).toMatchObject({ value: 'job_search' });
    expect(matchStepText({ kind: 'one', options: opts('fsp') }, 'ФСП ID привязан (демо)')).toMatchObject({ value: 'linked' });
    expect(matchStepText({ kind: 'one', options: DIRECTIONS }, 'FRONTEND')).toMatchObject({ value: 'frontend' });
    expect(matchStepText({ kind: 'one', options: DIRECTIONS }, 'mobile')).toBeNull();
    expect(matchStepText({ kind: 'one', options: opts('goal') }, 'а зачем это?')).toBeNull();
    // Точное имя варианта со знаком вопроса — всё равно ответ (решение интегратора): «?» срезает нормализация.
    expect(matchStepText({ kind: 'one', options: opts('goal') }, 'Ищу работу?')).toMatchObject({ value: 'job_search' });
  });

  it('роль — по подписи; согласие текстом не даётся', () => {
    const role = [
      { value: 'candidate', label: 'Я специалист' },
      { value: 'employer', label: 'Я работодатель' },
    ];
    expect(matchStepText({ kind: 'role', options: role }, 'я работодатель')).toMatchObject({ value: 'employer' });
    expect(matchStepText({ kind: 'consent' }, 'согласен')).toBeNull();
  });

  it('«несколько»: перечисление через запятую или «и» — все части должны совпасть', () => {
    expect(matchStepText({ kind: 'many', options: opts('formats') }, 'удалённо, гибрид')).toEqual({ value: ['remote', 'hybrid'], text: 'Удалённо, Гибрид' });
    expect(matchStepText({ kind: 'many', options: opts('formats') }, 'офис и удаленно')).toMatchObject({ value: ['office', 'remote'] });
    expect(matchStepText({ kind: 'many', options: opts('formats') }, 'офис и бассейн')).toBeNull();
  });

  it('вопрос — по знаку вопроса; граница доверия — только кандидат после согласия и роли', () => {
    expect(looksLikeQuestion('Казань?')).toBe(true);
    expect(looksLikeQuestion('Казань')).toBe(false);
    expect(asideToModel('candidate', 'one')).toBe(true);
    expect(asideToModel('candidate', 'consent')).toBe(false);
    expect(asideToModel('pending', 'role')).toBe(false);
    expect(asideToModel('pending', 'text')).toBe(false); // работодатель до компании
    expect(asideToModel('employer', 'one')).toBe(false);
    expect(asideToModel('candidate', 'summary')).toBe(false);
  });

  it('маркер шага в тексте хода: читается при восстановлении и не виден человеку', () => {
    const content = `Зачем цель?\n${asideMark('goal')}`;
    expect(asideStepOf(content)).toBe('goal');
    expect(asideStepOf('просто вопрос')).toBeNull();
    expect(humanizeUserText(content, new Map())).toBe('Зачем цель?');
  });
});

describe('маркер паузы знакомства (решение владельца 10.10)', () => {
  it('шаг паузы читается из хода, маркер не показывается кандидату и не путается с вопросом посреди шага', () => {
    const content = `Что дальше?\n${pauseMark('documents')}`;
    expect(pauseStepOf(content)).toBe('documents');
    expect(asideStepOf(content)).toBeNull();
    expect(pauseStepOf(`x\n${asideMark('goal')}`)).toBeNull();
    expect(humanizeUserText(content, new Map())).toBe('Что дальше?');
  });
});
