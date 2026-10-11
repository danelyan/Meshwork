import { buildSystem } from '@/server/agent/loop';
import { type JourneyState, journeyPromptBlock, stepHint } from '@/server/agent/journey';

const state: JourneyState = {
  steps: { onboarding: true, test: true, call: false, project: false, ai_defense: false },
  counts: { sources: 2, proposed: 3, confirmed: 1, pendingInvitations: 0, acceptedInvitations: 0 },
  hasCategory: true,
  callNeedsSources: false,
  onboardedAt: new Date('2026-10-10T10:00:00Z'),
  hired: null,
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
  it('без journey блока нет', () => {
    expect(buildSystem(base)).not.toContain('## Путь кандидата');
    expect(buildSystem({ ...base, journey: null })).not.toContain('## Путь кандидата');
  });
  it('в онбординг-aside блок не попадает', () => {
    const sys = buildSystem({ ...base, journey: journeyPromptBlock(state), onboarding: { stepId: 'goal', options: [] } as never });
    expect(sys).not.toContain('## Путь кандидата');
  });
});
