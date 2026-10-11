// R-C-01/02: пустые поля заполняются из резюме, заполненные кандидатом не перетираются — предложение.
import { actOnResumeField, applyResumeFields, resumeFieldsView, type ParsedResumeField } from '@/server/resume-fields';

type Row = { id: string; candidateId: string; key: string; value: unknown; quote: string; sourceRef: string; status: string; uploadId: string | null };

function fakeDb(init: { name: string; email: string; contact: string | null; profile?: { experienceYears: number | null; roles: string[]; softSkills: string[] } | null }) {
  const cand = { ...init, profile: init.profile ?? null };
  const rows: Row[] = [];
  let n = 0;
  const db = {
    candidate: {
      findUnique: async () => ({ name: cand.name, email: cand.email, contact: cand.contact, profile: cand.profile }),
      update: async ({ data }: { data: { name?: string; contact?: string } }) => Object.assign(cand, data),
    },
    candidateProfile: {
      upsert: async ({ update, create }: { update: object; create: object }) => {
        cand.profile = cand.profile ? { ...cand.profile, ...update } : { experienceYears: null, roles: [], softSkills: [], ...create };
        return cand.profile;
      },
    },
    resumeField: {
      findMany: async () => rows,
      findUnique: async ({ where }: { where: { candidateId_key: { key: string } } }) => rows.find((r) => r.key === where.candidateId_key.key) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
      upsert: async ({ where, create, update }: { where: { candidateId_key: { key: string } }; create: Row; update: Partial<Row> }) => {
        const r = rows.find((x) => x.key === where.candidateId_key.key);
        if (r) return Object.assign(r, update);
        const row = { ...create, id: `rf${++n}` } as Row;
        rows.push(row);
        return row;
      },
    },
  };
  return { db: db as never, cand, rows };
}

const FIELDS: ParsedResumeField[] = [
  { key: 'name', value: 'Дмитрий Рябинин', quote: '# Дмитрий Рябинин — Backend', sourceRef: 'L1' },
  { key: 'contact', value: 'dmitry@example.com', quote: 'dmitry@example.com · Москва', sourceRef: 'L3' },
  { key: 'experienceYears', value: 6, quote: '### «ПэйФлоу», Backend Engineer (2022 — 2026)', sourceRef: 'L9' },
  { key: 'roles', value: ['Backend Engineer'], quote: '### «ПэйФлоу», Backend Engineer (2022 — 2026)', sourceRef: 'L9' },
  { key: 'softSkills', value: ['Наставничество'], quote: 'Наставник двух стажёров', sourceRef: 'L12' },
];

describe('applyResumeFields', () => {
  it('пустой профиль (имя = часть почты): всё заполняется, у каждого поля пометка «из резюме» и цитата', async () => {
    const { db, cand } = fakeDb({ name: 'dmitry', email: 'dmitry@example.com', contact: null });
    const res = await applyResumeFields('c1', 'u1', FIELDS, { db });
    expect(res.applied).toEqual(['name', 'contact', 'experienceYears', 'roles', 'softSkills']);
    expect(cand.name).toBe('Дмитрий Рябинин');
    expect(cand.contact).toBe('dmitry@example.com');
    expect(cand.profile).toMatchObject({ experienceYears: 6, roles: ['Backend Engineer'], softSkills: ['Наставничество'] });
    const view = await resumeFieldsView('c1', db);
    expect(view.every((v) => v.fromResume && !v.suggestion && v.quote)).toBe(true);
  });

  it('заполненное кандидатом не перетирается: «в резюме указано иначе», принять или оставить своё', async () => {
    const { db, cand } = fakeDb({ name: 'Дима Рябинин', email: 'x@example.com', contact: '@dima_r', profile: { experienceYears: 4, roles: [], softSkills: [] } });
    const res = await applyResumeFields('c1', 'u1', FIELDS, { db });
    expect(res.suggested).toEqual(['name', 'contact', 'experienceYears']);
    expect(cand.name).toBe('Дима Рябинин');
    expect(cand.contact).toBe('@dima_r');
    expect(cand.profile?.experienceYears).toBe(4);
    let view = await resumeFieldsView('c1', db);
    expect(view.find((v) => v.key === 'experienceYears')).toMatchObject({ suggestion: true, current: 4, resume: 6 });

    view = await actOnResumeField('c1', { action: 'accept', key: 'experienceYears' }, db);
    expect(cand.profile?.experienceYears).toBe(6);
    expect(view.find((v) => v.key === 'experienceYears')).toMatchObject({ fromResume: true, suggestion: false });

    await actOnResumeField('c1', { action: 'dismiss', key: 'name' }, db);
    // повторная загрузка того же резюме не предлагает отклонённое снова
    const again = await applyResumeFields('c1', 'u2', FIELDS, { db });
    expect(again.suggested).not.toContain('name');
  });

  it('правка кандидатом снимает пометку «из резюме»; роль — без компании', async () => {
    const { db, cand } = fakeDb({ name: '', email: 'a@b.ru', contact: null });
    await applyResumeFields('c1', 'u1', FIELDS, { db });
    const view = await actOnResumeField('c1', { action: 'set', key: 'roles', value: ['Тимлид в Яндексе'] }, db);
    expect(cand.profile?.roles).toEqual(['Тимлид']);
    expect(view.find((v) => v.key === 'roles')).toBeUndefined();
  });
});
