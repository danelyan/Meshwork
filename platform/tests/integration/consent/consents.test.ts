import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { POST as register } from '@/app/api/auth/register/route';
import { DELETE as revoke } from '@/app/api/consents/[kind]/route';
import { GET as listConsents, POST as grant } from '@/app/api/consents/route';
import { GET as devObjections, POST as devAnswer } from '@/app/api/dev/objections/route';
import { GET as companyInvites, POST as invite } from '@/app/api/employer/invitations/route';
import { POST as assistant } from '@/app/api/employer/assistant/messages/route';
import { GET as employerCalls } from '@/app/api/employer/calls/route';
import { GET as submissions } from '@/app/api/employer/project-submissions/route';
import { GET as search } from '@/app/api/employer/search/route';
import { GET as matches } from '@/app/api/employer/vacancies/[id]/matches/route';
import { GET as favorites, PUT as setFavorite } from '@/app/api/favorites/route';
import { POST as respond } from '@/app/api/invitations/[id]/route';
import { GET as myObjections, POST as object } from '@/app/api/objections/route';
import { POST as onboarding } from '@/app/api/onboarding/route';
import { POST as startTest } from '@/app/api/test/start/route';
import { CONSENT_VERSION } from '@/server/auth/consent';
import { purgeExpiredRecordings } from '@/server/consent/recordings';
import { listEmployerCalls } from '@/server/defense-room';
import { loadEmployerContext } from '@/server/employer';
import { CONSENT_TEXTS, consentVersion } from '@/server/consent/texts';
import { resetEnvCache } from '@/server/env';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

const CAND = 'cand-c';
const cand = `cid=${signUserSession({ userId: 'u-cand', role: 'candidate', candidateId: CAND })}`;
const emp = `cid=${signUserSession({ userId: 'u-emp', role: 'employer', employerProfileId: 'p-emp' })}`;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const local = (url: string, method: string, body: unknown, cookie: string) => {
  const r = jsonRequest(url, method, body, cookie);
  r.headers.set('origin', 'http://localhost');
  return r;
};
const DATA = path.join(tmpdir(), `fsp-consent-${process.pid}`);

async function seedPair() {
  await prisma.candidate.create({ data: { id: CAND, name: 'Анна Кандидатова', email: 'anna@example.test', specialization: 'backend', contact: '@anna' } });
  await prisma.user.create({ data: { id: 'u-cand', name: 'Анна', role: 'candidate', candidateId: CAND } });
  await prisma.company.create({ data: { id: 'co-c', name: 'Компания', isDemo: false } });
  await prisma.user.create({ data: { id: 'u-emp', name: 'HR', role: 'employer' } });
  await prisma.employerProfile.create({ data: { id: 'p-emp', userId: 'u-emp', companyId: 'co-c' } });
}
const grantEmployer = async () => {
  for (const kind of ['employer_offer', 'employer_data_obligation'] as const) {
    expect((await grant(local('/api/consents', 'POST', { kind, version: consentVersion(kind) }, emp))).status).toBe(201);
  }
};
const sentInvitation = () => prisma.invitation.create({ data: { id: 'inv-1', companyId: 'co-c', employerProfileId: 'p-emp', candidateId: CAND, salaryFrom: 100000, salaryTo: 150000 } });
const contactsSeenByEmployer = async () => {
  const body = await (await companyInvites(jsonRequest('/x', 'GET', undefined, emp))).json();
  return body.invitations[0].candidate.contacts as { name: string; contact: string | null } | null;
};

describe('согласия (ADR 0005)', () => {
  beforeAll(async () => {
    process.env.CALL_DATA_DIR = DATA;
    resetEnvCache();
  });
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(() => prisma.$disconnect());

  it('регистрация: Г1 пишется видом pd_processing; без галочки аккаунт не создаётся', async () => {
    const post = (body: unknown) => register(local('/api/auth/register', 'POST', body, ''));
    expect((await post({ email: 'x@example.test', password: 'Correct-Horse-9', consent: '' })).status).toBe(400);
    expect((await post({ email: 'x@example.test', password: 'Correct-Horse-9', consent: CONSENT_VERSION })).status).toBe(200);
    const rows = await prisma.consent.findMany({ select: { kind: true, version: true } });
    expect(rows).toEqual([{ kind: 'pd_processing', version: CONSENT_VERSION }]);
  });

  it('онбординг кандидата: шаг согласий после роли; без Г3 тест закрыт, без Г4 профиль скрыт; с Г3/Г4 — открыто', async () => {
    await prisma.user.create({ data: { id: 'u1', name: 'Иван', email: 'ivan@example.test', consents: { create: { version: CONSENT_VERSION } } } });
    let c = `cid=${signUserSession({ userId: 'u1', role: 'pending' })}`;
    const act = (body: unknown) => onboarding(local('/api/onboarding', 'POST', body, c));
    const r = await act({ action: 'answer', stepId: 'role', value: 'candidate' });
    expect(r.status).toBe(200);
    c = cookieFrom(r)!;
    const v = await r.json();
    expect(v.current).toMatchObject({ id: 'candidateConsents', kind: 'consents', required: true });
    expect(v.current.options.map((o: { value: string }) => o.value)).toEqual(['ai_assessment', 'employer_visibility', 'research', 'marketing']);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } });
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: user.candidateId! } })).hiddenFromEmployers).toBe(true);

    // Ни одной галочки — можно продолжить; профиль скрыт, тест закрыт понятной ошибкой со ссылкой на кабинет.
    expect((await act({ action: 'answer', stepId: 'candidateConsents', value: [] })).status).toBe(200);
    const blocked = await startTest(local('/api/test/start', 'POST', { specialization: 'backend', grade: 'junior' }, c));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatchObject({ code: 'consent_required', details: { kind: 'ai_assessment', href: '/settings#consents' } });

    // Дать Г3 и Г4 из кабинета.
    for (const kind of ['ai_assessment', 'employer_visibility'] as const) {
      expect((await grant(local('/api/consents', 'POST', { kind, version: consentVersion(kind) }, c))).status).toBe(201);
    }
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: user.candidateId! } })).hiddenFromEmployers).toBe(false);
    const after = await startTest(local('/api/test/start', 'POST', { specialization: 'backend', grade: 'junior' }, c));
    expect((await after.json().catch(() => ({}))).error?.code).not.toBe('consent_required');
  });

  it('онбординг: отмеченные галочки — согласия текущих версий, Г4 открывает профиль', async () => {
    await prisma.user.create({ data: { id: 'u2', name: 'Пётр', consents: { create: { version: CONSENT_VERSION } } } });
    let c = `cid=${signUserSession({ userId: 'u2', role: 'pending' })}`;
    const r = await onboarding(local('/api/onboarding', 'POST', { action: 'answer', stepId: 'role', value: 'candidate' }, c));
    c = cookieFrom(r)!;
    expect((await onboarding(local('/api/onboarding', 'POST', { action: 'answer', stepId: 'candidateConsents', value: ['ai_assessment', 'employer_visibility', 'marketing'] }, c))).status).toBe(200);
    const rows = await prisma.consent.findMany({ where: { userId: 'u2' }, select: { kind: true, version: true } });
    expect(rows.map((x) => x.kind).sort()).toEqual(['ai_assessment', 'employer_visibility', 'marketing', 'pd_processing']);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: 'u2' } });
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: u.candidateId! } })).hiddenFromEmployers).toBe(false);
  });

  it('работодатель без оферты и обязательства: нет поиска и приглашений; после принятия — есть', async () => {
    await seedPair();
    const s = await search(jsonRequest('/api/employer/search', 'GET', undefined, emp));
    expect(s.status).toBe(409);
    expect((await s.json()).error).toMatchObject({ code: 'consent_required', details: { href: '/employer/company#consents' } });
    const body = { candidateId: CAND, message: 'Есть задача', salaryFrom: 100000, salaryTo: 150000 };
    expect((await invite(local('/api/employer/invitations', 'POST', body, emp))).status).toBe(409);
    await grantEmployer();
    expect((await search(jsonRequest('/api/employer/search', 'GET', undefined, emp))).status).toBe(200);
    expect((await invite(local('/api/employer/invitations', 'POST', body, emp))).status).toBe(201);
  });

  it('без оферты закрыты все данные кандидатов: подборка, помощник, избранное, сдачи проекта, защиты, приглашения', async () => {
    await seedPair();
    await prisma.vacancy.create({ data: { id: 'vac-c', companyId: 'co-c', title: 'Backend', specialization: 'backend', grade: 'junior', salaryFrom: 1, salaryTo: 2, needs: [] } });
    const get = (url: string) => jsonRequest(url, 'GET', undefined, emp);
    const code = async (r: Response) => [r.status, ((await r.json()) as { error?: { code: string } }).error?.code];
    const closed = [409, 'consent_required'];
    expect(await code(await matches(get('/x'), params({ id: 'vac-c' })))).toEqual(closed);
    expect(await code(await assistant(local('/api/employer/assistant/messages', 'POST', { text: 'Кого посмотреть?' }, emp)))).toEqual(closed);
    expect(await code(await favorites(get('/api/favorites')))).toEqual(closed);
    expect(await code(await setFavorite(local('/api/favorites', 'PUT', { kind: 'candidate', targetId: CAND, saved: true }, emp)))).toEqual(closed);
    expect(await code(await submissions(get('/api/employer/project-submissions?needId=vac-c')))).toEqual(closed);
    expect(await code(await employerCalls(get('/api/employer/calls')))).toEqual(closed);
    expect(await code(await companyInvites(get('/api/employer/invitations')))).toEqual(closed);
    await grantEmployer();
    expect((await matches(get('/x'), params({ id: 'vac-c' }))).status).toBe(200);
    expect((await favorites(get('/api/favorites'))).status).toBe(200);
    expect((await submissions(get('/api/employer/project-submissions?needId=vac-c'))).status).toBe(200);
    expect((await employerCalls(get('/api/employer/calls'))).status).toBe(200);
    expect((await companyInvites(get('/api/employer/invitations'))).status).toBe(200);
  });

  it('раскрытие изолировано между работодателями: отзыв для A не закрывает B, без приглашения контактов нет', async () => {
    await seedPair();
    await grantEmployer();
    for (const x of ['b', 'z']) {
      await prisma.company.create({ data: { id: `co-${x}`, name: `Компания ${x}`, isDemo: false } });
      await prisma.user.create({ data: { id: `u-emp-${x}`, name: `HR ${x}`, role: 'employer' } });
      await prisma.employerProfile.create({ data: { id: `p-emp-${x}`, userId: `u-emp-${x}`, companyId: `co-${x}` } });
      await prisma.consent.createMany({ data: (['employer_offer', 'employer_data_obligation'] as const).map((kind) => ({ userId: `u-emp-${x}`, kind, version: consentVersion(kind) })) });
    }
    const empB = `cid=${signUserSession({ userId: 'u-emp-b', role: 'employer', employerProfileId: 'p-emp-b' })}`;
    const empZ = `cid=${signUserSession({ userId: 'u-emp-z', role: 'employer', employerProfileId: 'p-emp-z' })}`;
    await sentInvitation();
    await prisma.invitation.create({ data: { id: 'inv-b', companyId: 'co-b', employerProfileId: 'p-emp-b', candidateId: CAND, salaryFrom: 100000, salaryTo: 150000 } });
    const version = CONSENT_TEXTS.identity_disclosure.version;
    for (const id of ['inv-1', 'inv-b']) {
      expect((await respond(local(`/api/invitations/${id}`, 'POST', { action: 'accept', disclosureVersion: version }, cand), params({ id }))).status).toBe(200);
    }
    const contactsOf = async (cookie: string) => {
      const body = await (await companyInvites(jsonRequest('/x', 'GET', undefined, cookie))).json();
      return (body.invitations as { candidate: { contacts: unknown } }[]).map((i) => i.candidate.contacts);
    };
    expect(await contactsOf(emp)).toEqual([{ name: 'Анна Кандидатова', contact: '@anna' }]);
    expect(await contactsOf(empB)).toEqual([{ name: 'Анна Кандидатова', contact: '@anna' }]);
    expect(await contactsOf(empZ)).toEqual([]);
    expect((await revoke(local('/api/consents/identity_disclosure?invitationId=inv-1', 'DELETE', undefined, cand), params({ kind: 'identity_disclosure' }))).status).toBe(200);
    expect(await contactsOf(emp)).toEqual([null]);
    expect(await contactsOf(empB)).toEqual([{ name: 'Анна Кандидатова', contact: '@anna' }]);
    // Раскрытие по чужому приглашению выдать нельзя.
    expect((await grant(local('/api/consents', 'POST', { kind: 'identity_disclosure', version, context: { invitationId: 'inv-zz' } }, cand))).status).toBe(404);
  });

  it('принятие приглашения: без раскрытия — 409, с раскрытием — контакты; отзыв раскрытия возвращает псевдоним', async () => {
    await seedPair();
    await grantEmployer();
    await sentInvitation();
    const r1 = await respond(local('/api/invitations/inv-1', 'POST', { action: 'accept' }, cand), params({ id: 'inv-1' }));
    expect(r1.status).toBe(409);
    expect((await r1.json()).error.code).toBe('consent_required');
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: 'inv-1' } })).status).toBe('sent');
    expect(await contactsSeenByEmployer()).toBeNull();

    const ok = await respond(local('/api/invitations/inv-1', 'POST', { action: 'accept', disclosureVersion: CONSENT_TEXTS.identity_disclosure.version }, cand), params({ id: 'inv-1' }));
    expect(ok.status).toBe(200);
    expect(await contactsSeenByEmployer()).toEqual({ name: 'Анна Кандидатова', contact: '@anna' });
    await prisma.callSession.create({ data: { id: 'def-1', candidateId: CAND, kind: 'defense', aiDefense: true, status: 'finished', policyVersion: 'v' } });
    const ctx = await loadEmployerContext('p-emp');
    expect((await listEmployerCalls(ctx)).map((c) => c.candidateName)).toEqual(['Анна Кандидатова']);
    const d = await prisma.consent.findFirstOrThrow({ where: { userId: 'u-cand', kind: 'identity_disclosure' } });
    expect(d.context).toEqual({ invitationId: 'inv-1' });

    // Отзыв без приглашения — 400; с приглашением — псевдоним снова, приглашение остаётся принятым.
    expect((await revoke(local('/api/consents/identity_disclosure', 'DELETE', undefined, cand), params({ kind: 'identity_disclosure' }))).status).toBe(400);
    expect((await revoke(local('/api/consents/identity_disclosure?invitationId=inv-1', 'DELETE', undefined, cand), params({ kind: 'identity_disclosure' }))).status).toBe(200);
    expect(await contactsSeenByEmployer()).toBeNull();
    // Список защит с именем (кабинет «Звонки») тоже закрывается отзывом раскрытия.
    expect(await listEmployerCalls(ctx)).toEqual([]);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: 'inv-1' } })).status).toBe('accepted');
    const list = await (await listConsents(jsonRequest('/api/consents', 'GET', undefined, cand))).json();
    expect(list.items.find((i: { kind: string }) => i.kind === 'identity_disclosure')).toMatchObject({ invitationId: 'inv-1', company: 'Компания', state: 'revoked' });
  });

  it('Г1 отзывается только удалением аккаунта (409); устаревшая версия — 409', async () => {
    await seedPair();
    await prisma.consent.create({ data: { userId: 'u-cand', version: CONSENT_VERSION } });
    const r = await revoke(local('/api/consents/pd_processing', 'DELETE', undefined, cand), params({ kind: 'pd_processing' }));
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('consent_revoke_is_erase');
    expect((await grant(local('/api/consents', 'POST', { kind: 'research', version: 'old' }, cand))).status).toBe(409);
  });

  it('отзыв записи созвона удаляет аудио кандидата; очистка по сроку не трогает свежие', async () => {
    await seedPair();
    await prisma.consent.create({ data: { userId: 'u-cand', kind: 'call_recording', version: consentVersion('call_recording') } });
    const mk = async (id: string, startedAt: Date) => {
      await prisma.callSession.create({ data: { id, candidateId: CAND, kind: 'qualifying', status: 'finished', policyVersion: 'v', audioPath: `calls/${id}`, startedAt } });
      await mkdir(path.join(DATA, 'calls', id), { recursive: true });
      await writeFile(path.join(DATA, 'calls', id, '000.wav'), 'x');
    };
    const now = new Date();
    await mk('call-old', new Date(now.getTime() - 100 * 86400_000));
    await mk('call-new', new Date(now.getTime() - 5 * 86400_000));
    expect(await purgeExpiredRecordings(now, 90)).toBe(1);
    expect(existsSync(path.join(DATA, 'calls', 'call-old'))).toBe(false);
    expect(existsSync(path.join(DATA, 'calls', 'call-new'))).toBe(true);
    expect((await prisma.callSession.findUniqueOrThrow({ where: { id: 'call-old' } })).audioPath).toBeNull();

    const r = await revoke(local('/api/consents/call_recording', 'DELETE', undefined, cand), params({ kind: 'call_recording' }));
    expect(r.status).toBe(200);
    expect((await r.json()).deletedRecordings).toBe(1);
    expect(existsSync(path.join(DATA, 'calls', 'call-new'))).toBe(false);
    expect((await prisma.callSession.findUniqueOrThrow({ where: { id: 'call-new' } })).audioPath).toBeNull();
    expect((await prisma.callSession.count({ where: { candidateId: CAND } }))).toBe(2); // транскрипт и оценки остаются
  });

  it('возражение: своё — 201 со сроком 30 дней, чужое — 404, повтор открытого — 409; ответ через dev-панель', async () => {
    await seedPair();
    await prisma.callSession.create({ data: { id: 'call-1', candidateId: CAND, kind: 'qualifying', status: 'finished', policyVersion: 'v' } });
    const text = 'Оценка по теме транзакций занижена: я ответил про изоляцию.';
    expect((await object(local('/api/objections', 'POST', { subject: 'call', subjectId: 'чужой', text }, cand))).status).toBe(404);
    const r = await object(local('/api/objections', 'POST', { subject: 'call', subjectId: 'call-1', text }, cand));
    expect(r.status).toBe(201);
    const o = await r.json();
    expect(new Date(o.dueAt).getTime() - new Date(o.createdAt).getTime()).toBe(30 * 86400_000);
    expect((await object(local('/api/objections', 'POST', { subject: 'call', subjectId: 'call-1', text }, cand))).status).toBe(409);

    const dev = (req: Request) => { req.headers.set('host', 'localhost'); return req; };
    const open = await (await devObjections(dev(jsonRequest('http://localhost/api/dev/objections', 'GET', undefined, cand)))).json();
    expect(open.objections).toHaveLength(1);
    expect((await devAnswer(dev(local('http://localhost/api/dev/objections', 'POST', { id: o.id, answer: 'Пересмотрели, оценка верна.' }, cand)))).status).toBe(200);
    const mine = await (await myObjections(jsonRequest('/api/objections', 'GET', undefined, cand))).json();
    expect(mine.objections[0]).toMatchObject({ status: 'answered', answer: 'Пересмотрели, оценка верна.' });
  });
});
