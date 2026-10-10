import { feedRank } from '@/server/project/service';

const item = (subcategoryId: string | null, specialization = 'backend', taken = false) => ({ my: { taken }, subcategoryId, specialization });

describe('лента: порядок feedRank', () => {
  const scope = { specialization: 'backend' };

  it('взятые → своя подкатегория → соседние того же направления → остальные', () => {
    const items = [item('backend.web-api'), item('frontend.ui-app', 'frontend'), item('backend.integrations'), item('backend.web-api', 'backend', true)];
    const sorted = [...items].sort((a, b) => feedRank(a, scope, 'backend.integrations') - feedRank(b, scope, 'backend.integrations'));
    expect(sorted.map((i) => i.subcategoryId)).toEqual(['backend.web-api', 'backend.integrations', 'backend.web-api', 'frontend.ui-app']);
    expect(sorted[0]!.my.taken).toBe(true);
  });

  it('без подкатегории кандидата — только направление; без направления — всё в одном ранге', () => {
    expect(feedRank(item('backend.web-api'), scope, null)).toBe(2);
    expect(feedRank(item(null), scope, 'backend.web-api')).toBe(2);
    expect(feedRank(item('backend.web-api'), { specialization: null }, null)).toBe(3);
  });
});
