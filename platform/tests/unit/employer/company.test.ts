import { CompanyPatch } from '@/server/employer/company';

const issues = (input: unknown) => {
  const r = CompanyPatch.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('CompanyPatch', () => {
  it('нормализует: обрезает пробелы, пустое стирает, ИНН без пробелов, Telegram к @name', () => {
    const r = CompanyPatch.parse({ name: '  ООО Пример ', description: '  ', industry: ' Финтех ', inn: '7707 083893', contact: 't.me/northflow' });
    expect(r).toEqual({ name: 'ООО Пример', description: null, industry: 'Финтех', inn: '7707083893', contact: '@northflow' });
  });

  it('null и пустая строка стирают необязательные поля', () => {
    expect(CompanyPatch.parse({ inn: '', contact: '', industry: null })).toEqual({ inn: null, contact: null, industry: null });
  });

  it('частичная правка не добавляет чужих полей', () => {
    expect(Object.keys(CompanyPatch.parse({ industry: 'Медиа' }))).toEqual(['industry']);
  });

  it('отвергает: пустой запрос, неизвестные поля (id, isDemo), короткое имя', () => {
    expect(issues({})).toEqual(['Нет полей для изменения'].map((m) => `: ${m}`));
    expect(issues({ id: 'x', name: 'Ok' }).length).toBeGreaterThan(0);
    expect(issues({ isDemo: false }).length).toBeGreaterThan(0);
    expect(issues({ name: 'A' })).toEqual(['name: Название не короче 2 символов']);
    expect(issues({ name: '   ' })).toHaveLength(1);
  });

  it('отвергает: плохой ИНН, плохой контакт, слишком длинное описание', () => {
    expect(issues({ inn: '1234567890' })[0]).toMatch(/^inn: Не сходится контрольная цифра/);
    expect(issues({ inn: '12ab' })[0]).toMatch(/^inn: ИНН состоит только из цифр/);
    expect(issues({ contact: 'не контакт' })[0]).toMatch(/^contact: Укажи почту/);
    expect(issues({ description: 'я'.repeat(601) })[0]).toMatch(/^description: Не длиннее 600/);
  });
});
