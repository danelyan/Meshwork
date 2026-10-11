import { chooseGapCta } from '@/lib/career-gap';

const v = (over: Partial<Parameters<typeof chooseGapCta>[0]> = {}) => ({ specialization: 'backend', grade: 'middle' as const, missing: [{ catalogId: 'sql' }], projectTaskId: null, ...over });
const mid = [{ specialization: 'backend', grade: 'middle' as const }];

it('sends to the test when there is no category for the direction or the grade is too low', () => {
  expect(chooseGapCta(v(), [])).toMatchObject({ kind: 'test', href: '/test' });
  expect(chooseGapCta(v(), [{ specialization: 'frontend', grade: 'senior' }])).toMatchObject({ kind: 'test' });
  expect(chooseGapCta(v({ grade: 'senior' }), mid)).toMatchObject({ kind: 'test' });
  expect(chooseGapCta(v({ missing: [] }), [])).toMatchObject({ kind: 'test' });
});

it('a higher category covers a lower vacancy grade', () => {
  expect(chooseGapCta(v({ grade: 'junior' }), mid).kind).not.toBe('test');
});

it('offers the vacancy project when it is available, else confirming a skill', () => {
  expect(chooseGapCta(v({ projectTaskId: 'p 1' }), mid)).toMatchObject({ kind: 'project', href: '/projects/p%201', label: 'Взять проект' });
  expect(chooseGapCta(v(), mid)).toMatchObject({ kind: 'skill', href: '/consultant', label: 'Подтвердить навык' });
});

it('shows "in the selection" without a button when nothing is missing, and never offers applying', () => {
  const done = chooseGapCta(v({ missing: [], projectTaskId: 'p' }), mid);
  expect(done).toMatchObject({ kind: 'done', href: null, label: 'Вы в подборке' });
  for (const c of [chooseGapCta(v(), []), chooseGapCta(v(), mid)]) expect(c.hint).toContain('пригласит сама');
});
