// Автотест приватности (R-E-07, R-N-07, R-C-16): до принятого приглашения ни имя, ни почта, ни контакт кандидата
// не попадают в то, что отдаётся работодателю. Тут сериализаторы и фильтры; БД и маршруты проверяют integration-тесты.
import { toAssistantCandidate } from '@/server/agent/employer/cards';
import type { MatchItem } from '@/server/employer/matching';
import { candidateContact, contactEmail, dedupeClaims, maskSubmissionForEmployer, pseudonym, toCandidateCard, type CardSource } from '@/server/employer/privacy';

const SECRETS = ['Иванов Пётр Сергеевич', 'petr.ivanov@example.com', '@petr_ivanov', '+7 912 345-67-89'];
const src: CardSource = {
  id: 'cand1',
  name: SECRETS[0]!,
  email: SECRETS[1]!,
  contact: SECRETS[2]!,
  specialization: 'backend',
  fspState: 'linked',
  category: { specialization: 'backend', grade: 'middle' },
  claims: [{ catalogId: 'sql', statement: 'Оптимизация SQL', level: 'artifact', sourceType: 'github' }],
};
const leaks = (v: unknown) => SECRETS.filter((s) => JSON.stringify(v).includes(s));

describe('toCandidateCard', () => {
  it('до принятия: псевдоним, contacts=null, ни имя, ни почта, ни контакт не сериализуются', () => {
    const card = toCandidateCard(src, false);
    expect(card.displayName).toBe(pseudonym('cand1'));
    expect(card.contacts).toBeNull();
    expect(leaks(card)).toEqual([]);
  });

  it('после принятия: имя и ровно один способ связи – указанный кандидатом, а не почта аккаунта', () => {
    const card = toCandidateCard(src, true);
    expect(card.displayName).toBe(src.name);
    expect(card.contacts).toEqual({ name: src.name, contact: '@petr_ivanov' });
    expect(JSON.stringify(card)).not.toContain(SECRETS[1]);
  });

  it('псевдоним не раскрывает id и стабилен', () => {
    expect(pseudonym('cand1')).toMatch(/^Кандидат #[0-9A-F]{6}$/);
    expect(pseudonym('cand1')).toBe(pseudonym('cand1'));
    expect(pseudonym('cand1')).not.toContain('cand1');
  });

  it('лишние поля источника (цитата, телефон в произвольном поле) не просачиваются', () => {
    const dirty = { ...src, phone: SECRETS[3], quote: 'мой телефон +7 912 345-67-89', claims: [{ ...src.claims[0]!, quote: 'quote +7 912 345-67-89', sourceRef: 'https://github.com/petr' }] };
    const card = toCandidateCard(dirty as CardSource, false);
    expect(JSON.stringify(card)).not.toMatch(/912|github\.com\/petr|quote/);
  });
});

describe('контакты после принятия', () => {
  it('служебная почта онбординга не контакт', () => {
    expect(contactEmail('user-1@users.invalid')).toBeNull();
    expect(candidateContact({ contact: null, email: 'user-1@users.invalid' })).toBeNull();
    expect(candidateContact({ contact: '  ', email: 'a@b.ru' })).toBe('a@b.ru');
  });
});

describe('dedupeClaims', () => {
  it('наружу только каталожная формулировка, уровень и тип источника; цитата и ссылка остаются внутри', () => {
    const catalog = new Map([['sql', { id: 'sql', statement: 'Оптимизация SQL' }]]) as never;
    const out = dedupeClaims([{ catalogId: 'sql', level: 'artifact', sourceKind: 'github', quote: 'petr.ivanov@example.com', sourceRef: 'x' } as never], catalog);
    expect(out).toEqual([{ catalogId: 'sql', level: 'artifact', statement: 'Оптимизация SQL', sourceType: 'github' }]);
    const doc = dedupeClaims([{ catalogId: 'sql', level: 'self_reported', sourceKind: 'resume' }], catalog);
    expect(doc[0]!.sourceType).toBeNull();
  });
});

describe('карточка помощника работодателя', () => {
  it('даже для принятого кандидата в карточку помощника не попадают имя и контакты', () => {
    const item = {
      rank: 1,
      score: 1,
      covered: 1,
      total: 2,
      candidate: toCandidateCard(src, true),
      invitation: { id: 'i', status: 'accepted', vacancyId: null },
      explanation: { summary: 'закрывает 1 из 2', covered: [{ statement: 'Оптимизация SQL', level: 'artifact' }], proven: [], missing: [], fsp: '', category: '', subcategory: '', stackMatched: [] },
    } as unknown as MatchItem;
    const card = toAssistantCandidate(item);
    expect(leaks(card)).toEqual([]);
    expect(card.alias).toBe(pseudonym('cand1'));
  });
});

describe('maskSubmissionForEmployer (сдачи проектов)', () => {
  const dirty = {
    rubric: {
      results: [{ id: 'c1', evidence: 'автор petr.ivanov@example.com, tg @x; +7 912 345-67-89 t.me/petr_ivanov', file: 'src/by-petr.ivanov@example.com.ts' }],
    },
    lint: { note: 'см. t.me/petr_ivanov', details: { raw: 'petr.ivanov@example.com' } },
  };

  it('до принятия: контакты в доказательствах, файле, заметке линтера и ошибке маскируются, details убран', () => {
    const { result, error } = maskSubmissionForEmployer(dirty, 'упало у petr.ivanov@example.com', false);
    expect(JSON.stringify({ result, error })).not.toMatch(/petr\.ivanov@|912|t\.me\/petr/);
    expect(JSON.stringify(result)).toContain('[скрыто]');
    expect(result?.lint.details).toBeUndefined();
  });

  it('после принятия – без изменений', () => {
    const r = maskSubmissionForEmployer(dirty, 'e', true);
    expect(r.result).toBe(dirty);
    expect(r.error).toBe('e');
  });

  it('нет результата – null', () => {
    expect(maskSubmissionForEmployer(null, null, false)).toEqual({ result: null, error: null });
  });
});

// lane resume-fields (R-C-01/02, R-E-07, ТЗ 2.2 п. 2): ФИО и контакт из резюме – только после принятия;
// стаж, роли (без компаний) и софт-скиллы (метки словаря) видны и до принятия.
describe('toCandidateCard: поля из резюме', () => {
  const withResume: CardSource = {
    ...src,
    experience: { experienceYears: 6, roles: ['Backend Engineer', 'Тимлид в Сбере', 'petr.ivanov@example.com'], softSkills: ['Наставничество', 'Иванов Пётр Сергеевич'] },
  };

  it('до принятия: ни ФИО, ни контакт не сериализуются; стаж, роли без компаний и софт-скиллы словаря – видны', () => {
    const card = toCandidateCard(withResume, false);
    expect(leaks(card)).toEqual([]);
    expect(card.contacts).toBeNull();
    expect(card.experience).toEqual({ years: 6, roles: ['Backend Engineer', 'Тимлид'], softSkills: ['Наставничество'] });
    expect(JSON.stringify(card)).not.toContain('Сбер');
  });

  it('после принятия: имя и контакт открываются, проекция опыта та же', () => {
    const card = toCandidateCard(withResume, true);
    expect(card.contacts).toEqual({ name: SECRETS[0], contact: SECRETS[2] });
    expect(card.experience?.years).toBe(6);
  });

  it('нет данных – поля experience нет', () => {
    expect(toCandidateCard({ ...src, experience: { experienceYears: null, roles: [], softSkills: [] } }, false)).not.toHaveProperty('experience');
    expect(toCandidateCard(src, false)).not.toHaveProperty('experience');
  });
});
