import { buildSystem } from '@/server/agent/loop';
import { type JourneyState, journeyPromptBlock, stepHint } from '@/server/agent/journey';

const state: JourneyState = {
  steps: { onboarding: true, test: true, call: false, project: false, ai_defense: false },
  counts: { sources: 2, proposed: 3, confirmed: 1, pendingInvitations: 0, acceptedInvitations: 0 },
  hasCategory: true,
  callNeedsSources: false,
  onboardedAt: new Date('2026-10-10T10:00:00Z'),
  hired: null,
  aiConsent: true,
  hidden: false,
  nextStep: 'call',
};
const base = { now: new Date('2026-10-11T12:00:00Z'), toolsExhausted: false };

describe('блок <journey> в системном промпте', () => {
  it('есть при переданном journey: шаги, nextStep, подсказка, счётчики', () => {
    const block = journeyPromptBlock(state);
    const sys = buildSystem({ ...base, journey: block });
    expect(sys).toContain('## Путь кандидата');
    expect(sys).toContain('знакомство ✓, тест ✓, созвон с ИИ –, проект –, ИИ-защита –');
    expect(sys).toContain('СЛЕДУЮЩИЙ ШАГ: call');
    expect(sys).toContain(stepHint(state));
    expect(sys).toContain('предложено 3, подтверждено 1');
    expect(sys).toContain('get_onboarding_status');
    expect(sys).toContain('не первый');
  });
  it('скрытость профиля и согласие на оценку ИИ — строками состояния; без согласия подсказка сначала про согласие', () => {
    expect(journeyPromptBlock(state)).toContain('Профиль скрыт: нет.');
    expect(journeyPromptBlock({ ...state, hidden: true })).toContain('Профиль скрыт: да');
    expect(journeyPromptBlock({ ...state, aiConsent: false })).toContain('Согласие на оценку ИИ: нет');
    expect(stepHint({ ...state, aiConsent: false })).toMatch(/^Нет согласия на оценку ИИ/);
    expect(stepHint({ ...state, aiConsent: false, nextStep: 'waiting' })).not.toMatch(/согласия на оценку ИИ/);
    expect(stepHint({ ...state, nextStep: 'waiting' })).toMatch(/Профиль скрыт: да/);
  });
  it('без journey блока нет', () => {
    expect(buildSystem(base)).not.toContain('## Путь кандидата');
    expect(buildSystem({ ...base, journey: null })).not.toContain('## Путь кандидата');
  });
  it('в онбординг-aside блок не попадает', () => {
    const sys = buildSystem({ ...base, journey: journeyPromptBlock(state), onboarding: { stepId: 'goal', options: [] } as never });
    expect(sys).not.toContain('## Путь кандидата');
  });
});
