// Аудит онбординга (docs/research/prompt-audit/onboarding.md): пропуск текстом, подсказки консультанту
// посреди шага, вход реплики-связки и проверки живого харнесса eval/prompt-audit/onboarding.
import { asideCannedReply, asideNote } from '@/server/agent/onboarding-aside';
import { ONBOARDING_PROMPT, ONBOARDING_PROMPT_VERSION } from '@/server/onboarding/prompt';
import { looksLikeSkip, matchStepText } from '@/server/onboarding/match';
import { findStep } from '@/server/onboarding/scenario';

import { asideChecks, leadChecks } from '../../../eval/prompt-audit/onboarding/checks';

const complete = vi.fn();
vi.mock('@/server/env', () => ({ getEnv: () => ({ LLM_PROVIDER: 'openai-chat' }) }));
vi.mock('@/server/llm', () => ({ getLlm: () => ({ complete }) }));

describe('looksLikeSkip', () => {
  const text = { kind: 'text' as const };
  const one = { kind: 'one' as const };
  it.each(['пропустить', 'Пропусти', 'пропущу этот вопрос', 'skip', 'Дальше!', 'позже', 'не сейчас'])('явный пропуск на любом необязательном шаге: %s', (t) => {
    expect(looksLikeSkip(text, t)).toBe(true);
    expect(looksLikeSkip(one, t)).toBe(true);
  });
  it.each(['не знаю', 'Не знаю.', 'хз', 'нет', '-', "I don't know", 'n/a'])('пустышка на текстовом шаге — пропуск, на шаге с вариантами — нет: %s', (t) => {
    expect(looksLikeSkip(text, t)).toBe(true);
    expect(looksLikeSkip({ kind: 'chips' }, t)).toBe(true);
    expect(looksLikeSkip(one, t)).toBe(false);
  });
  it('обязательный шаг, согласие и роль текстом не пропускаются', () => {
    expect(looksLikeSkip({ kind: 'one', required: true }, 'пропустить')).toBe(false);
    expect(looksLikeSkip({ kind: 'role' }, 'пропустить')).toBe(false);
    expect(looksLikeSkip({ kind: 'consents' }, 'skip')).toBe(false);
  });
  it('содержательный ответ — не пропуск', () => {
    for (const t of ['Москва', 'не знаю, может Казань', 'нет офиса, только удалёнка', 'пропускал дедлайны, теперь нет', '?']) expect(looksLikeSkip(text, t)).toBe(false);
  });
  it('вариант шага «Пока нет» сопоставляется раньше пропуска', () => {
    const fsp = findStep('fspParticipation')!;
    expect(matchStepText({ kind: fsp.kind, options: fsp.options as never }, 'пока нет')).not.toBeNull();
  });
});

describe('asideNote / asideCannedReply', () => {
  const base = { stepId: 'grade', question: 'На какой грейд претендуешь?', options: ['Junior', 'Middle', 'Senior'] };
  it('необязательный шаг: подсказать кнопку пропуска и не изображать пропуск', () => {
    const n = asideNote(base);
    expect(n).toMatch(/«Пропустить вопрос»/);
    expect(n).toMatch(/не пиши «пропускаем»/);
    expect(n).toMatch(/не выполняй и не обсуждай/);
    expect(asideCannedReply(base)).toMatch(/Пропустить вопрос/);
  });
  it('обязательный шаг: пропуска нет', () => {
    const n = asideNote({ ...base, stepId: 'subcategory', required: true });
    expect(n).toMatch(/пропустить его нельзя/);
    expect(n).not.toMatch(/«Пропустить вопрос»/);
    expect(asideCannedReply({ ...base, required: true })).not.toMatch(/Пропустить вопрос/);
  });
});

describe('промпт реплики-связки', () => {
  it('v7: пояснение шага во входе, правила про род, пустые ответы и чужой язык', () => {
    expect(ONBOARDING_PROMPT_VERSION).toBe('onboarding-v7');
    expect(ONBOARDING_PROMPT).toMatch(/только из step\.sub/);
    expect(ONBOARDING_PROMPT).toMatch(/даже по имени/);
    expect(ONBOARDING_PROMPT).toMatch(/Ответ пустой или не по делу/);
    expect(ONBOARDING_PROMPT).toMatch(/на другом языке - реплика всё равно по-русски/);
    expect(ONBOARDING_PROMPT).not.toMatch(/\{\{/);
  });
  it('leadFor передаёт модели sub шага', async () => {
    const { leadFor } = await import('@/server/onboarding/phrase');
    complete.mockResolvedValue({ kind: 'text', text: 'Хорошо, теперь контакт.' });
    const ctx = { answers: { role: 'candidate' }, facts: { role: 'candidate' as const, consent: true, name: '', fspState: null, specialization: null } };
    await leadFor(findStep('candidateContact')!, ctx, { step: findStep('salary')!, value: { from: 100, to: 200 }, label: '100–200' });
    const input = JSON.parse(complete.mock.calls[0]![0].messages[0].content);
    expect(input.step.sub).toMatch(/только когда ты примешь/);
  });
});

describe('проверки харнесса', () => {
  const lead = (answer: string, id = 'Lx') => ({ id, kind: 'lead' as const, step: 'x', name: 'Пётр', prev: 'y', answer });
  it('ловят угаданный род, мужской род Киры, тире, похвалу пустого ответа', () => {
    expect(leadChecks(lead('ок'), 'Пётр, теперь отрасли, где ты уже работал.')).toContain('угадан род собеседника: «где ты уже работал»');
    expect(leadChecks(lead('ок'), 'Понял, дальше.').join()).toMatch(/мужской род/);
    expect(leadChecks(lead('ок'), 'Принято — дальше.')).toContain('длинное тире');
    expect(leadChecks(lead('не знаю'), 'Отличный ответ, дальше зарплата.')).toContain('похвалила пустой ответ');
    expect(leadChecks(lead('ок'), 'Пётр, хорошо, вернёмся к этому позже. Теперь отрасли.')).toEqual([]);
  });
  it('aside: возврат к шагу, изображённый пропуск, условный грейд не считается присвоенным', () => {
    const c = { id: 'A09', kind: 'aside' as const, step: 'x', text: 'пропустить' };
    expect(asideChecks(c, 'Поняла, пропускаем этот шаг. Выбери вариант.', [])).toContain('изобразила пропуск, которого не делала');
    expect(asideChecks(c, 'Шаг необязательный: нажми «Пропустить вопрос» под ним.', [])).toEqual([]);
    expect(asideChecks({ ...c, id: 'A07' }, 'Если ты сейчас на уровне джуна, выбери вариант честно.', []).join()).not.toMatch(/назвал грейд/);
    expect(asideChecks({ ...c, id: 'A05' }, 'Погоду не подскажу.', [])).toContain('не вернула к шагу');
  });
});
