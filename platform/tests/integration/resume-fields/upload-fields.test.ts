// R-C-01/02 + R-E-07: загрузка резюме заполняет пустые поля профиля, не перетирает заполненные,
// а работодатель до принятия приглашения не видит ни ФИО, ни контакт из резюме.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { POST } from '@/app/api/uploads/route';
import { profileDetails } from '@/server/claims/profile-details';
import { resetEnvCache } from '@/server/env';
import { signSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';

const demoPdf = readFileSync(join(process.cwd(), 'src/server/demo/pdf/demo-1.pdf'));
function upload(candidateId: string): Request {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(demoPdf)], { type: 'application/pdf' }), 'demo-1.pdf');
  return new Request('http://localhost/api/uploads', { method: 'POST', body: form, headers: { cookie: `cid=${signSession(candidateId)}` } });
}

describe('api/uploads → поля профиля из резюме', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fsp-resume-fields-'));
  beforeAll(() => { process.env.UPLOAD_DIR = dir; resetEnvCache(); });
  afterAll(async () => { delete process.env.UPLOAD_DIR; resetEnvCache(); rmSync(dir, { recursive: true, force: true }); await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    await prisma.candidate.createMany({ data: [
      { id: 'empty', email: 'dmitry.r@example.test', name: 'dmitry.r' },
      { id: 'filled', email: 'own@example.test', name: 'Дима Р.', contact: '@dima_own' },
    ] });
    await prisma.candidateProfile.create({ data: { candidateId: 'filled', experienceYears: 2 } });
  });

  it('пустой профиль: ФИО, контакт, стаж, роли, софт-скиллы из демо-резюме, с цитатой; работодатель до принятия видит только стаж/роли/софт', async () => {
    const res = await POST(upload('empty'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.profileFields.applied).toEqual(expect.arrayContaining(['name', 'contact', 'experienceYears', 'roles']));

    const c = await prisma.candidate.findUniqueOrThrow({ where: { id: 'empty' }, include: { profile: true, resumeFields: true } });
    expect(c.name).toBe('Дмитрий Рябинин');
    expect(c.contact).toBe('dmitry.ryabinin@example.com');
    expect(c.profile?.experienceYears).toBe(6);
    expect(c.profile?.roles).toEqual(['Backend Engineer']);
    expect(c.resumeFields.every((f) => f.status === 'applied' && f.quote.length > 0 && f.uploadId === body.uploadId)).toBe(true);

    const d = await profileDetails('empty');
    expect(d.resumeFields.map((f) => f.key)).toEqual(expect.arrayContaining(['name', 'contact', 'experienceYears', 'roles']));
    expect(d.resumeFields.every((f) => f.fromResume)).toBe(true);
    const card = JSON.stringify(d.employerPreview);
    expect(card).not.toMatch(/Дмитрий|Рябинин|dmitry\.ryabinin|ПэйФлоу|Лавка/);
    expect(d.employerPreview.contacts).toBeNull();
    expect(d.employerPreview.experience).toMatchObject({ years: 6, roles: ['Backend Engineer'] });
  });

  it('заполненное кандидатом не перетирается – предложение «в резюме указано иначе»', async () => {
    const body = await (await POST(upload('filled'))).json();
    expect(body.profileFields.suggested).toEqual(expect.arrayContaining(['name', 'contact', 'experienceYears']));
    const c = await prisma.candidate.findUniqueOrThrow({ where: { id: 'filled' }, include: { profile: true } });
    expect(c.name).toBe('Дима Р.');
    expect(c.contact).toBe('@dima_own');
    expect(c.profile?.experienceYears).toBe(2);
    const d = await profileDetails('filled');
    expect(d.resumeFields.find((f) => f.key === 'experienceYears')).toMatchObject({ suggestion: true, current: 2, resume: 6 });
  });
});
