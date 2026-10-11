import { SUBCATEGORIES, specLabel, subcategoryLabel } from '@/lib/directions';
import type { ProfileClaim, ProfileView } from '@/server/claims/types';
import { buildProfileDocument, type ProfileDocumentInput } from '@/server/profile-pdf/model';

const claim = (over: Partial<ProfileClaim> = {}): ProfileClaim => ({
  id: 'c1',
  catalogId: 'be.cache',
  statement: 'Кэширует данные',
  level: 'self_reported',
  quote: 'Кэшировал справочники в Redis',
  sourceRef: 'cv.pdf#l4',
  sourceKind: 'resume',
  limits: 'Не доказывает: x',
  suggestedProof: [],
  status: 'confirmed',
  createdAt: '2026-10-01T00:00:00.000Z',
  confirmedAt: '2026-10-02T00:00:00.000Z',
  ...over,
});

const profile = (over: Partial<ProfileView> = {}): ProfileView => ({
  candidate: { id: 'c-1', name: 'Анна Петрова', specialization: 'backend', fspState: 'not_linked' },
  category: null,
  claims: [],
  byLevel: { self_reported: [], artifact: [], third_party: [], platform: [] },
  ...over,
});

const input = (over: Partial<ProfileDocumentInput> = {}): ProfileDocumentInput => ({
  profile: profile(),
  contact: 'anna@example.test',
  basics: { city: 'Казань', claimedGrade: null, stack: ['Go', 'PostgreSQL'], workFormats: ['remote'], salaryMin: 150000, salaryExpected: 200000, experienceYears: 3, roles: ['Backend-разработчик'], softSkills: ['наставничество'] },
  subcategoryId: null,
  policyVersion: 'adr-0002-v7',
  stages: { call: null, projects: { submitted: 0, checked: 0 }, defenses: { completed: 0, passed: 0 } },
  generatedAt: new Date('2026-10-11T15:00:00.000Z'),
  ...over,
});

const section = (doc: ReturnType<typeof buildProfileDocument>, title: string) => {
  const s = doc.sections.find((x) => x.title === title);
  if (!s) throw new Error(`нет секции ${title}`);
  return s;
};
const fact = (doc: ReturnType<typeof buildProfileDocument>, title: string, label: string) => section(doc, title).facts?.find((f) => f.label === label)?.value;

describe('buildProfileDocument: категория', () => {
  it('категория из теста: направление × грейд, подкатегория, дата и версия политики', () => {
    const sub = SUBCATEGORIES.find((s) => s.specialization === 'backend') ?? SUBCATEGORIES[0]!;
    const doc = buildProfileDocument(input({ profile: profile({ category: { specialization: 'backend', grade: 'middle', confirmedAt: '2026-10-05T10:00:00.000Z' } }), subcategoryId: sub.id }));
    expect(fact(doc, 'Категория', 'Категория')).toBe(`${specLabel('backend')} · Middle`);
    expect(fact(doc, 'Категория', 'Подкатегория')).toBe(subcategoryLabel(sub.id));
    expect(fact(doc, 'Категория', 'Подтверждена тестом')).toBe('05.10.2026');
    expect(fact(doc, 'Категория', 'Политика теста')).toBe('adr-0002-v7');
    expect(section(doc, 'Категория').facts?.map((f) => f.label)).not.toContain('Заявленный грейд');
  });

  it('без теста категория «не подтверждена»; заявленный грейд подписан как со слов', () => {
    const doc = buildProfileDocument(input({ basics: { ...input().basics!, claimedGrade: 'junior' } }));
    expect(fact(doc, 'Категория', 'Категория')).toMatch(/не подтверждена/);
    expect(fact(doc, 'Категория', 'Заявленный грейд')).toBe('Junior · со слов кандидата, не подтверждён');
    expect(section(doc, 'Категория').facts?.map((f) => f.label)).not.toContain('Политика теста');
  });

  it('категория без попытки теста в базе: версия политики «не сохранена», а не текущая', () => {
    const doc = buildProfileDocument(input({ profile: profile({ category: { specialization: 'backend', grade: 'junior', confirmedAt: '2026-10-05T10:00:00.000Z' } }), policyVersion: null }));
    expect(fact(doc, 'Категория', 'Политика теста')).toMatch(/^не сохранена/);
    expect(JSON.stringify(doc)).not.toContain('adr-0002');
  });

  it('категория без подкатегории: «не указана»', () => {
    const doc = buildProfileDocument(input({ profile: profile({ category: { specialization: 'frontend', grade: 'junior', confirmedAt: '2026-10-05T10:00:00.000Z' } }) }));
    expect(fact(doc, 'Категория', 'Подкатегория')).toBe('не указана');
  });
});

describe('buildProfileDocument: основное и контакт', () => {
  it('контакт – ровно тот, что передан для владельца профиля; поля резюме и анкеты в фактах', () => {
    const doc = buildProfileDocument(input());
    expect(doc.name).toBe('Анна Петрова');
    expect(doc.headline).toBe(`${specLabel('backend')} · Казань`);
    expect(fact(doc, 'Основное', 'Контакт')).toBe('anna@example.test');
    expect(fact(doc, 'Основное', 'Стаж')).toBe('3 года');
    expect(fact(doc, 'Основное', 'Роли')).toBe('Backend-разработчик');
    expect(fact(doc, 'Основное', 'Софт-скиллы')).toBe('наставничество');
    expect(fact(doc, 'Основное', 'Формат работы')).toBe('удалённо');
    expect(fact(doc, 'Основное', 'Ожидания')).toBe('от 150 000 до 200 000 ₽ в месяц');
    expect(JSON.stringify(doc).match(/@|example\.test/g)).toEqual(['anna@example.test'].flatMap((s) => s.match(/@|example\.test/g) ?? []));
  });

  it('пустой профиль: все поля «не указан», без падения', () => {
    const doc = buildProfileDocument(input({ contact: null, basics: null, profile: profile({ candidate: { id: 'c-2', name: 'Без Данных', specialization: null, fspState: 'not_linked' } }) }));
    expect(doc.headline).toBe('Направление не выбрано');
    expect(fact(doc, 'Основное', 'Контакт')).toBe('не указан');
    expect(fact(doc, 'Основное', 'Стаж')).toBe('не указан');
    expect(section(doc, 'Утверждения о навыках').items).toEqual([]);
    expect(section(doc, 'Утверждения о навыках').empty).toMatch(/пока нет/);
  });
});

describe('buildProfileDocument: утверждения, ФСП, ступени', () => {
  it('только подтверждённые и исправленные; уровни сверху вниз; без цитат; ФСП отдельно', () => {
    const doc = buildProfileDocument(input({ profile: profile({
      candidate: { id: 'c-1', name: 'Анна', specialization: 'backend', fspState: 'linked' },
      claims: [
        claim({ id: 'a', statement: 'Со слов', level: 'self_reported', status: 'confirmed' }),
        claim({ id: 'b', statement: 'Проверено платформой', level: 'platform', status: 'edited' }),
        claim({ id: 'c', statement: 'Черновик', status: 'proposed' }),
        claim({ id: 'd', statement: 'Отклонено', status: 'rejected' }),
        claim({ id: 'e', statement: 'Призёр хакатона ФСП', sourceKind: 'fsp', level: 'third_party', status: 'confirmed' }),
      ],
    }) }));
    expect(section(doc, 'Утверждения о навыках').items).toEqual(['Проверено платформой – платформа', 'Со слов – со слов']);
    expect(JSON.stringify(doc)).not.toMatch(/Черновик|Отклонено|Кэшировал справочники/);
    expect(fact(doc, 'Достижения ФСП', 'Статус')).toMatch(/привязан, достижения/);
    expect(section(doc, 'Достижения ФСП').items).toEqual(['Призёр хакатона ФСП']);
    expect(section(doc, 'Достижения ФСП').note).toMatch(/симулятор/);
  });

  it('ФСП не подключён: статус есть, достижений нет даже при утверждениях fsp', () => {
    const doc = buildProfileDocument(input({ profile: profile({ claims: [claim({ sourceKind: 'fsp', statement: 'Старое' })] }) }));
    expect(fact(doc, 'Достижения ФСП', 'Статус')).toBe('ФСП ID не подключён');
    expect(section(doc, 'Достижения ФСП').items).toEqual([]);
  });

  it('ступени: пусто → «не проводился»; с данными – счётчики и дата созвона', () => {
    const empty = buildProfileDocument(input());
    expect(fact(empty, 'Ступени проверки сверх теста', 'Созвон с ИИ')).toBe('не проводился');
    expect(fact(empty, 'Ступени проверки сверх теста', 'Проектные задания')).toBe('не сдавались');
    expect(fact(empty, 'Ступени проверки сверх теста', 'Защита утверждений')).toBe('не проводилась');
    const full = buildProfileDocument(input({ stages: { call: { summary: 'Объяснил решения теста сам', evaluatedAt: '2026-10-09T12:00:00.000Z' }, projects: { submitted: 2, checked: 1 }, defenses: { completed: 3, passed: 2 } } }));
    expect(fact(full, 'Ступени проверки сверх теста', 'Созвон с ИИ')).toBe('Объяснил решения теста сам (09.10.2026)');
    expect(fact(full, 'Ступени проверки сверх теста', 'Проектные задания')).toBe('сдано 2, проверено автопроверкой 1');
    expect(fact(full, 'Ступени проверки сверх теста', 'Защита утверждений')).toBe('пройдено 2 из 3');
  });

  it('шапка и подвал: бренд, дата по Москве, «сформировано автоматически»; детерминизм', () => {
    const doc = buildProfileDocument(input());
    expect(doc.brand).toBe('MESHWORK');
    expect(doc.generatedAt).toBe('11.10.2026, 18:00 МСК');
    expect(doc.footer).toMatch(/^Сформировано автоматически, MESHWORK, 11\.10\.2026, 18:00 МСК\./);
    expect(buildProfileDocument(input())).toEqual(doc);
  });
});
