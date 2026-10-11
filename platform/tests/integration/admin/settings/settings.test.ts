import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATCH as claimPatch } from '@/app/api/admin/catalogs/claims/[id]/route';
import { GET as catalogsGet } from '@/app/api/admin/catalogs/route';
import { PATCH as subPatch } from '@/app/api/admin/catalogs/subcategories/[id]/route';
import { PUT as templatePut } from '@/app/api/admin/catalogs/templates/[kind]/[id]/route';
import { GET as settingGet, PUT as settingPut } from '@/app/api/admin/settings/[key]/route';
import { POST as rollbackPost } from '@/app/api/admin/settings/[key]/rollback/route';
import { GET as settingsGet } from '@/app/api/admin/settings/route';
import { ADMIN_COOKIE, signAdminToken } from '@/server/admin/session';
import { createStaff } from '@/server/admin/staff';
import { getSetting, listSettingVersions, resetSettingsCache, setSetting } from '@/server/admin/settings';
import { companySanction } from '@/server/employer';
import { listTemplateViews } from '@/server/project/service';
import { intervals } from '@/server/test';

import { prisma, resetDb } from '../../../helpers/db';
import { jsonRequest } from '../../../helpers/requests';

const PASS = 'owner-pass-123';
const key = (k: string) => ({ params: Promise.resolve({ key: k }) });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

async function sessionFor(role: 'owner' | 'moderator' | 'support') {
  const { staff } = await createStaff(null, { email: `${role}@example.ru`, name: role, role, password: PASS });
  await prisma.staffMember.update({ where: { id: staff.id }, data: { totpEnabledAt: new Date() } });
  const s = await prisma.adminSession.create({ data: { staffId: staff.id, expiresAt: new Date(Date.now() + 3600_000) } });
  return { staff, actor: { staffId: staff.id, ip: null }, cookie: `${ADMIN_COOKIE}=${signAdminToken(s.id)}` };
}

const auditRows = (action: string) => prisma.adminAuditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

describe('настройки платформы без деплоя', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    resetSettingsCache();
  });
  afterEach(() => vi.useRealTimers());

  it('без записей в БД действуют умолчания из кода', async () => {
    expect(await getSetting('employer.dailyInvitationLimit')).toBe(20);
    expect(await getSetting('test.gradeChangeIntervalDays')).toBe(30);
    expect(await getSetting('test.retakeSameGradeDays')).toBe(14);
    expect(await getSetting('employer.complaintSanctions')).toEqual({ reducedAt: 3, reducedLimit: 5, blockedAt: 5 });
    expect(await getSetting('catalog.hiddenTaskTemplates')).toEqual([]);
  });

  it('запись: значение, версия и журнал в одной транзакции; кэш сбрасывается сразу', async () => {
    const { actor } = await sessionFor('owner');
    expect(await getSetting('employer.dailyInvitationLimit')).toBe(20); // кэш прогрет
    await setSetting('employer.dailyInvitationLimit', 35, { staffId: actor.staffId, ip: '1.2.3.4' }, 'Рост спроса на стенде');
    expect(await getSetting('employer.dailyInvitationLimit')).toBe(35);
    const row = await prisma.platformSetting.findUniqueOrThrow({ where: { key: 'employer.dailyInvitationLimit' } });
    expect(row).toMatchObject({ value: 35, updatedById: actor.staffId });
    const versions = await listSettingVersions('employer.dailyInvitationLimit');
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ value: 35, reason: 'Рост спроса на стенде' });
    const log = await auditRows('edit_settings');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: actor.staffId, targetType: 'setting', targetId: 'employer.dailyInvitationLimit', reason: 'Рост спроса на стенде', ip: '1.2.3.4' });
    expect(log[0]!.before).toMatchObject({ value: 20, isDefault: true });
    expect(log[0]!.after).toMatchObject({ value: 35 });
  });

  it('невалидное значение и пустая причина: 400, в БД и журнале ничего', async () => {
    const { actor } = await sessionFor('owner');
    await expect(setSetting('employer.dailyInvitationLimit', 'много', actor, 'Проверка схемы')).rejects.toMatchObject({ status: 400 });
    await expect(setSetting('employer.dailyInvitationLimit', 0, actor, 'Проверка схемы')).rejects.toMatchObject({ status: 400 });
    await expect(setSetting('employer.dailyInvitationLimit', 30, actor, '  ')).rejects.toMatchObject({ status: 400 });
    expect(await prisma.platformSetting.count()).toBe(0);
    expect(await prisma.platformSettingVersion.count()).toBe(0);
    expect(await prisma.adminAuditLog.count({ where: { action: { startsWith: 'edit_settings' } } })).toBe(0);
  });

  it('другой процесс подхватывает изменение не позже чем через TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
    expect(await getSetting('test.retakeSameGradeDays')).toBe(14);
    await prisma.platformSetting.create({ data: { key: 'test.retakeSameGradeDays', value: 3 } }); // запись «из другого процесса»
    expect(await getSetting('test.retakeSameGradeDays')).toBe(14);
    vi.setSystemTime(new Date('2026-10-11T10:00:31Z'));
    expect(await getSetting('test.retakeSameGradeDays')).toBe(3);
  });

  it('значение в БД, не проходящее схему, не ломает чтение: умолчание', async () => {
    await prisma.platformSetting.create({ data: { key: 'employer.dailyInvitationLimit', value: 'oops' } });
    expect(await getSetting('employer.dailyInvitationLimit')).toBe(20);
  });

  it('откат на версию и возврат умолчания: новая версия, значение, журнал', async () => {
    const { staff, cookie } = await sessionFor('owner');
    const put = (value: unknown, reason: string) => settingPut(jsonRequest('/api/admin/settings/test.gradeChangeIntervalDays', 'PUT', { value, reason }, cookie), key('test.gradeChangeIntervalDays'));
    expect((await put(10, 'Сокращаем интервал')).status).toBe(200);
    expect((await put(7, 'Ещё короче')).status).toBe(200);
    const versions = await listSettingVersions('test.gradeChangeIntervalDays');
    const first = versions.find((v) => v.value === 10)!;
    const rb = await rollbackPost(jsonRequest('/api/admin/settings/test.gradeChangeIntervalDays/rollback', 'POST', { versionId: first.id, reason: 'Вернуть 10 дней' }, cookie), key('test.gradeChangeIntervalDays'));
    expect(rb.status).toBe(200);
    expect(await getSetting('test.gradeChangeIntervalDays')).toBe(10);
    expect(await listSettingVersions('test.gradeChangeIntervalDays')).toHaveLength(3);
    const rolled = await auditRows('edit_settings.rollback');
    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toMatchObject({ actorId: staff.id, targetId: 'test.gradeChangeIntervalDays', reason: 'Вернуть 10 дней' });
    const def = await rollbackPost(jsonRequest('/x', 'POST', { toDefault: true, reason: 'Назад к умолчанию' }, cookie), key('test.gradeChangeIntervalDays'));
    expect(def.status).toBe(200);
    expect(await getSetting('test.gradeChangeIntervalDays')).toBe(30);
    const notFound = await rollbackPost(jsonRequest('/x', 'POST', { versionId: 'nope', reason: 'Проверка ошибки' }, cookie), key('test.gradeChangeIntervalDays'));
    expect(notFound.status).toBe(404);
  });

  it('API: 401 без входа, 403 модератору и поддержке, неизвестный ключ 404', async () => {
    const mod = await sessionFor('moderator');
    const sup = await sessionFor('support');
    const owner = await sessionFor('owner');
    expect((await settingsGet(jsonRequest('/api/admin/settings', 'GET'))).status).toBe(401);
    for (const who of [mod, sup]) {
      expect((await settingsGet(jsonRequest('/api/admin/settings', 'GET', undefined, who.cookie))).status).toBe(403);
      expect((await settingGet(jsonRequest('/x', 'GET', undefined, who.cookie), key('test.retakeSameGradeDays'))).status).toBe(403);
      expect((await settingPut(jsonRequest('/x', 'PUT', { value: 5, reason: 'Проверка прав' }, who.cookie), key('test.retakeSameGradeDays'))).status).toBe(403);
      expect((await rollbackPost(jsonRequest('/x', 'POST', { toDefault: true, reason: 'Проверка прав' }, who.cookie), key('test.retakeSameGradeDays'))).status).toBe(403);
    }
    expect(await prisma.platformSetting.count()).toBe(0);
    expect(await prisma.adminAuditLog.count({ where: { action: { startsWith: 'edit_settings' } } })).toBe(0);
    expect((await settingPut(jsonRequest('/x', 'PUT', { value: 5, reason: 'Нет такой' }, owner.cookie), key('no.such'))).status).toBe(404);
    const list = (await (await settingsGet(jsonRequest('/api/admin/settings', 'GET', undefined, owner.cookie))).json()) as { settings: { key: string; internal: boolean }[] };
    expect(list.settings.some((s) => s.key === 'employer.dailyInvitationLimit')).toBe(true);
    expect(list.settings.some((s) => s.internal)).toBe(false);
  });

  it('PUT без причины: 400', async () => {
    const owner = await sessionFor('owner');
    const res = await settingPut(jsonRequest('/x', 'PUT', { value: 5, reason: '' }, owner.cookie), key('test.retakeSameGradeDays'));
    expect(res.status).toBe(400);
    expect(await prisma.platformSettingVersion.count()).toBe(0);
  });

  it('лимит приглашений и пороги санкций применяются без деплоя', async () => {
    const { actor } = await sessionFor('owner');
    const co = await prisma.company.create({ data: { name: 'ООО Тест' } });
    expect(await companySanction(co.id)).toEqual({ level: 'none', complaints: 0, limit: 20 });
    await setSetting('employer.dailyInvitationLimit', 7, actor, 'Ограничиваем рассылку');
    expect((await companySanction(co.id)).limit).toBe(7);
    // пороги санкций читаются из настроек: одна жалоба при reducedAt=1 уже снижает лимит
    await setSetting('employer.complaintSanctions', { reducedAt: 1, reducedLimit: 2, blockedAt: 3 }, actor, 'Ужесточаем санкции');
    const cand = await prisma.candidate.create({ data: { name: 'Кандидат', email: 'c@example.ru' } });
    const inv = await prisma.invitation.create({ data: { companyId: co.id, candidateId: cand.id, message: 'Привет', salaryFrom: 100_000, salaryTo: 150_000 } });
    await prisma.complaint.create({ data: { companyId: co.id, candidateId: cand.id, invitationId: inv.id, reason: 'spam' } });
    expect(await companySanction(co.id)).toMatchObject({ level: 'reduced', complaints: 1, limit: 2 });
    // окно подсчёта тоже настройка: жалоба «старше» окна не считается
    await prisma.complaint.updateMany({ data: { createdAt: new Date(Date.now() - 10 * 86_400_000) } });
    await setSetting('employer.complaintWindowDays', 7, actor, 'Окно короче');
    expect(await companySanction(co.id)).toMatchObject({ level: 'none', complaints: 0, limit: 7 });
  });

  it('интервалы теста берутся из настроек, в демо-режиме остаются минутами', async () => {
    const { actor } = await sessionFor('owner');
    expect(await intervals(false)).toMatchObject({ gradeChangeMs: 30 * 86_400_000, retakeMs: 14 * 86_400_000 });
    await setSetting('test.gradeChangeIntervalDays', 7, actor, 'Короче интервал');
    await setSetting('test.retakeSameGradeDays', 2, actor, 'Короче пересдача');
    expect(await intervals(false)).toMatchObject({ gradeChangeMs: 7 * 86_400_000, retakeMs: 2 * 86_400_000, gradeChangeDays: 7, retakeDays: 2 });
    expect(await intervals(true)).toMatchObject({ demo: true, gradeChangeMs: 120_000, retakeMs: 60_000 });
  });
});

describe('справочники', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    resetSettingsCache();
  });

  it('подкатегория: статус и порядок меняются, журнал пишется; поддержка и модератор получают 403', async () => {
    const owner = await sessionFor('owner');
    const mod = await sessionFor('moderator');
    await prisma.subcategory.create({ data: { id: 'backend.test', specialization: 'backend', title: 'Тестовая', description: 'd', status: 'planned', order: 5 } });
    const patch = (cookie: string, body: unknown) => subPatch(jsonRequest('/x', 'PATCH', body, cookie), idCtx('backend.test'));
    expect((await patch(mod.cookie, { status: 'active', reason: 'Проверка прав' })).status).toBe(403);
    expect((await prisma.subcategory.findUniqueOrThrow({ where: { id: 'backend.test' } })).status).toBe('planned');
    expect((await patch(owner.cookie, { status: 'active', order: 1 })).status).toBe(400); // без причины
    expect((await patch(owner.cookie, { reason: 'Ничего не меняем' })).status).toBe(400);
    expect((await patch(owner.cookie, { status: 'active', order: 1, reason: 'Банк заданий готов' })).status).toBe(200);
    expect(await prisma.subcategory.findUniqueOrThrow({ where: { id: 'backend.test' } })).toMatchObject({ status: 'active', order: 1 });
    const log = await auditRows('edit_catalogs.subcategory');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: owner.staff.id, targetType: 'subcategory', targetId: 'backend.test', reason: 'Банк заданий готов' });
    expect(log[0]!.before).toMatchObject({ status: 'planned', order: 5 });
    expect(log[0]!.after).toMatchObject({ status: 'active', order: 1 });
    expect((await patch(owner.cookie, { status: 'active', reason: 'Проверка 404' })).status).toBe(200);
    expect((await subPatch(jsonRequest('/x', 'PATCH', { status: 'active', reason: 'нет такой' }, owner.cookie), idCtx('no.such'))).status).toBe(404);
  });

  it('каталог утверждений: правится только текст и ограничения, id и веса не трогаются', async () => {
    const owner = await sessionFor('owner');
    const sup = await sessionFor('support');
    await prisma.claimCatalog.create({ data: { id: 'be.test', specialization: 'backend', statement: 'Старый текст утверждения', grades: ['junior'], weight: 2, proof: [], markers: [], limits: 'Границы' } });
    const patch = (cookie: string, body: unknown) => claimPatch(jsonRequest('/x', 'PATCH', body, cookie), idCtx('be.test'));
    expect((await patch(sup.cookie, { statement: 'Новый текст утверждения', reason: 'Проверка прав' })).status).toBe(403);
    expect((await patch(owner.cookie, { statement: 'Новый текст утверждения', weight: 3, reason: 'Правка опечатки' })).status).toBe(200);
    expect(await prisma.claimCatalog.findUniqueOrThrow({ where: { id: 'be.test' } })).toMatchObject({ statement: 'Новый текст утверждения', weight: 2 });
    const log = await auditRows('edit_catalogs.claim');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ targetType: 'claim', targetId: 'be.test', reason: 'Правка опечатки' });
    expect((await patch(owner.cookie, { statement: 'ab', reason: 'Слишком коротко' })).status).toBe(400);
  });

  it('шаблоны: снятие и публикация через список скрытых id, журнал, действие на новые выдачи', async () => {
    const owner = await sessionFor('owner');
    const mod = await sessionFor('moderator');
    await prisma.taskTemplate.create({ data: { id: 'be.test-task', taskId: 't1', title: 'Задание', specialization: 'backend', grade: 'junior', catalogIds: [], format: 'single', irtA: 1, irtB: 0 } });
    const put = (cookie: string, kind: string, id: string, published: boolean, reason = 'Ошибка в условии') =>
      templatePut(jsonRequest('/x', 'PUT', { published, reason }, cookie), { params: Promise.resolve({ kind, id }) });
    expect((await put(mod.cookie, 'task', 'be.test-task', false)).status).toBe(403);
    expect(await prisma.platformSetting.count()).toBe(0);

    expect((await put(owner.cookie, 'task', 'be.test-task', false)).status).toBe(200);
    expect(await getSetting('catalog.hiddenTaskTemplates')).toEqual(['be.test-task']);
    expect((await put(owner.cookie, 'task', 'no.such', false)).status).toBe(404);
    expect((await put(owner.cookie, 'bogus', 'be.test-task', false)).status).toBe(400);

    const project = listTemplateViews()[0];
    expect(project).toBeTruthy();
    expect((await put(owner.cookie, 'project', project!.id, false)).status).toBe(200);
    const hiddenProjects = await getSetting('catalog.hiddenProjectTemplates');
    expect(hiddenProjects).toEqual([project!.id]);
    expect(listTemplateViews({ hidden: hiddenProjects }).some((t) => t.id === project!.id)).toBe(false);
    expect(listTemplateViews().some((t) => t.id === project!.id)).toBe(true);

    expect((await put(owner.cookie, 'task', 'be.test-task', true, 'Условие исправлено')).status).toBe(200);
    expect(await getSetting('catalog.hiddenTaskTemplates')).toEqual([]);
    const log = await auditRows('edit_catalogs.templates');
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ actorId: owner.staff.id, targetType: 'setting', targetId: 'catalog.hiddenTaskTemplates' });

    const list = (await (await catalogsGet(jsonRequest('/x', 'GET', undefined, owner.cookie))).json()) as { templates: { kind: string; id: string; published: boolean }[] };
    expect(list.templates.find((t) => t.id === project!.id)?.published).toBe(false);
    expect((await catalogsGet(jsonRequest('/x', 'GET', undefined, mod.cookie))).status).toBe(403);
  });
});
