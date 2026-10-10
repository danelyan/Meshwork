import { getSubcategory, SPEC_LABEL, SPECIALIZATIONS, SUBCATEGORIES, subcategoriesFor, subcategoryMatches } from '@/lib/directions';
import { passesFilters, type CandidateEvidence } from '@/server/employer/ranking';
import { parseFilters, VacancyInput } from '@/server/employer/schemas';

describe('справочник направлений (ADR 0003, дополнение 10.10)', () => {
  it('четыре направления, 17 подкатегорий карты, id вида направление.подкатегория, порядок без повторов', () => {
    expect(SPECIALIZATIONS).toEqual(['backend', 'frontend', 'ai', 'engineering']);
    for (const s of SPECIALIZATIONS) expect(SPEC_LABEL[s].length).toBeGreaterThan(1);
    expect(SUBCATEGORIES).toHaveLength(17);
    expect(new Set(SUBCATEGORIES.map((s) => s.id)).size).toBe(17);
    for (const s of SUBCATEGORIES) expect(s.id.startsWith(`${s.specialization}.`)).toBe(true);
    expect(subcategoriesFor('backend').map((s) => s.id)).toEqual(['backend.web-api', 'backend.integrations', 'backend.highload', 'backend.data-model']);
    expect(subcategoriesFor('ai')).toHaveLength(5);
    expect(subcategoriesFor('engineering')).toHaveLength(4);
  });

  it('active — подкатегории с шаблоном проекта к сдаче (ADR 0003), остальные planned', () => {
    expect(SUBCATEGORIES.filter((s) => s.status === 'active').map((s) => s.id).sort()).toEqual(
      ['ai.llm-apps', 'backend.integrations', 'backend.web-api', 'engineering.data-eng', 'frontend.ui-app'].sort(),
    );
  });

  it('подкатегория должна принадлежать направлению', () => {
    expect(subcategoryMatches('ai', 'ai.mlops')).toBe(true);
    expect(subcategoryMatches('ai', 'backend.web-api')).toBe(false);
    expect(subcategoryMatches('ai', null)).toBe(true);
    expect(getSubcategory('nope')).toBeUndefined();
  });
});

describe('фильтры поиска и потребность: подкатегория', () => {
  const cand = (sub: string | null): CandidateEvidence => ({ id: 'c', specialization: 'ai', subcategoryId: sub, fspState: 'not_linked', category: null, claims: [] });

  it('parseFilters: sub задаёт направление; чужая или неизвестная подкатегория отбрасывается', () => {
    expect(parseFilters({ sub: 'ai.llm-apps' }).filters).toMatchObject({ specialization: 'ai', subcategory: 'ai.llm-apps' });
    expect(parseFilters({ spec: 'backend', sub: 'ai.llm-apps' }).filters).toEqual({ specialization: 'backend' });
    expect(parseFilters({ sub: 'ai.unknown' }).filters).toEqual({});
    expect(parseFilters({ spec: 'engineering' }).filters).toEqual({ specialization: 'engineering' });
  });

  it('passesFilters: без подкатегории или с другой — не проходит', () => {
    expect(passesFilters(cand('ai.llm-apps'), { subcategory: 'ai.llm-apps' })).toBe(true);
    expect(passesFilters(cand('ai.mlops'), { subcategory: 'ai.llm-apps' })).toBe(false);
    expect(passesFilters(cand(null), { subcategory: 'ai.llm-apps' })).toBe(false);
    expect(passesFilters(cand(null), { specialization: 'ai' })).toBe(true);
  });

  it('VacancyInput: подкатегория необязательна и проверяется по направлению', () => {
    const base = { title: 'AI-инженер', specialization: 'ai', grade: 'junior', salaryFrom: 1, salaryTo: 2, stack: [], needs: [{ catalogId: 'ai.rag', weight: 2 }] };
    expect(VacancyInput.parse(base).subcategoryId).toBeNull();
    expect(VacancyInput.parse({ ...base, subcategoryId: 'ai.llm-apps' }).subcategoryId).toBe('ai.llm-apps');
    expect(VacancyInput.safeParse({ ...base, subcategoryId: 'backend.web-api' }).success).toBe(false);
  });
});
