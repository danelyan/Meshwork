import { filtersToQuery, parseFilters } from '@/server/employer/schemas';

const toRaw = (query: string) => Object.fromEntries(new URLSearchParams(query));

describe('фильтры выдачи: query → фильтры → query', () => {
  it('подкатегория не теряется в ссылках истории и подсказок ослабления', () => {
    const { filters } = parseFilters({ spec: 'backend', sub: 'backend.web-api', grade: 'middle', fsp: '1' });
    expect(filters).toEqual({ specialization: 'backend', subcategory: 'backend.web-api', grade: 'middle', fsp: true });

    const query = filtersToQuery(filters);
    expect(new URLSearchParams(query).get('sub')).toBe('backend.web-api');
    expect(parseFilters(toRaw(query)).filters).toEqual(filters);
  });

  it('подкатегория без spec в запросе: направление выводится из неё и обратный путь даёт те же фильтры', () => {
    const { filters } = parseFilters({ sub: 'frontend.ui-app' });
    expect(filters).toEqual({ specialization: 'frontend', subcategory: 'frontend.ui-app' });
    expect(parseFilters(toRaw(filtersToQuery(filters))).filters).toEqual(filters);
  });

  it('без подкатегории параметра sub в ссылке нет; с fullstack он не пишется', () => {
    expect(filtersToQuery({ specialization: 'backend' })).toBe('spec=backend');
    expect(filtersToQuery({ fullstack: true, subcategory: 'backend.web-api' })).toBe('spec=fullstack');
  });
});
