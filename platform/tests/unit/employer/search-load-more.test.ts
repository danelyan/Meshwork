import { loadMoreLinks, parseFilters, SEARCH_PAGE_MAX_LIMIT } from '@/server/employer/schemas';
import { DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT } from '@/server/employer/weights';

// Аудит дизайна UI-006: из 126 найденных были доступны только первые 20. Страница поиска догружает выдачу
// ростом limit в адресе; потолок API (MAX_RESULT_LIMIT) при этом не меняется.
describe('поиск по базе: дозагрузка выдачи', () => {
  it('parseFilters: потолок API прежний, потолок страницы поиска выше', () => {
    expect(parseFilters({}).limit).toBe(DEFAULT_RESULT_LIMIT);
    expect(parseFilters({ limit: '126' }).limit).toBe(MAX_RESULT_LIMIT);
    expect(parseFilters({ limit: '126' }, SEARCH_PAGE_MAX_LIMIT).limit).toBe(126);
    expect(parseFilters({ limit: '100000' }, SEARCH_PAGE_MAX_LIMIT).limit).toBe(SEARCH_PAGE_MAX_LIMIT);
    // мусор в limit не ломает страницу
    for (const bad of ['0', '-5', '1.5', 'abc', '']) expect(parseFilters({ limit: bad }, SEARCH_PAGE_MAX_LIMIT).limit).toBe(DEFAULT_RESULT_LIMIT);
  });

  it('первая страница: «ещё 20» и «всех 126», фильтры сохраняются в адресе', () => {
    const links = loadMoreLinks('/employer/search', { specialization: 'backend', grade: 'middle', stack: ['go', 'sql'], fsp: true, expandPool: true }, 20, 126);
    expect(links.next).toEqual({ href: '/employer/search?spec=backend&grade=middle&stack=go%2Csql&fsp=1&pool=all&limit=40', add: 20 });
    expect(links.all).toEqual({ href: '/employer/search?spec=backend&grade=middle&stack=go%2Csql&fsp=1&pool=all&limit=126', count: 126 });
    // ссылка разбирается обратно в те же фильтры и новый limit
    const back = parseFilters(Object.fromEntries(new URL(links.next!.href, 'http://x').searchParams), SEARCH_PAGE_MAX_LIMIT);
    expect(back).toEqual({ filters: { specialization: 'backend', grade: 'middle', stack: ['go', 'sql'], fsp: true, expandPool: true }, limit: 40 });
  });

  it('без фильтров адрес содержит только limit', () => {
    expect(loadMoreLinks('/employer/search', {}, 20, 126).next?.href).toBe('/employer/search?limit=40');
  });

  it('последняя порция короче шага и не дублируется ссылкой «всех»', () => {
    expect(loadMoreLinks('/employer/search', {}, 120, 126)).toEqual({ next: { href: '/employer/search?limit=126', add: 6 }, all: null });
    expect(loadMoreLinks('/employer/search', {}, 20, 35)).toEqual({ next: { href: '/employer/search?limit=35', add: 15 }, all: null });
  });

  it('показано всё - ссылок нет', () => {
    expect(loadMoreLinks('/employer/search', {}, 126, 126)).toEqual({ next: null, all: null });
    expect(loadMoreLinks('/employer/search', {}, 7, 7)).toEqual({ next: null, all: null });
  });

  it('выдача больше потолка страницы: «всех» ведёт к потолку, после него ссылок нет', () => {
    const links = loadMoreLinks('/employer/search', {}, 20, 1000);
    expect(links.all).toEqual({ href: `/employer/search?limit=${SEARCH_PAGE_MAX_LIMIT}`, count: SEARCH_PAGE_MAX_LIMIT });
    expect(loadMoreLinks('/employer/search', {}, SEARCH_PAGE_MAX_LIMIT, 1000)).toEqual({ next: null, all: null });
  });
});
