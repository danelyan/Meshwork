import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DELETE as erase } from '@/app/api/auth/account/route';
import { resetEnvCache } from '@/server/env';
import { signUserSession } from '@/server/session';
import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

let storage: string;
const previous = { upload: process.env.UPLOAD_DIR, calls: process.env.CALL_DATA_DIR };
const body = { confirmation: 'УДАЛИТЬ', reason: 'delete' };
const cookie = (id: string, candidateId: string) => `cid=${signUserSession({ userId: id, role: 'candidate', candidateId })}`;
const request = (value: unknown, session?: string) => jsonRequest('/api/auth/account', 'DELETE', value, session);

async function account(id: string, shared = false) {
  const candidate = await prisma.candidate.create({ data: { id: `candidate-${id}`, email: `${id}@example.test`, name: id } });
  await prisma.user.create({ data: {
    id, name: id, role: 'candidate', candidateId: candidate.id, isDemo: shared,
    accounts: shared ? undefined : { create: { provider: 'email', providerAccountId: `${id}@example.test` } },
  } });
  return { candidateId: candidate.id, cookie: cookie(id, candidate.id) };
}

beforeEach(async () => {
  await resetDb();
  storage = await mkdtemp(join(tmpdir(), 'fsp-account-erasure-'));
  process.env.UPLOAD_DIR = join(storage, 'uploads');
  process.env.CALL_DATA_DIR = join(storage, 'audio');
  resetEnvCache();
});
afterEach(async () => {
  if (!resolve(storage).startsWith(resolve(tmpdir(), 'fsp-account-erasure-'))) throw new Error('Unsafe test cleanup path');
  await rm(storage, { recursive: true, force: true });
  if (previous.upload === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previous.upload;
  if (previous.calls === undefined) delete process.env.CALL_DATA_DIR; else process.env.CALL_DATA_DIR = previous.calls;
  resetEnvCache();
});
afterAll(() => prisma.$disconnect());

it('requires a session, same origin and exact confirmation; rejects supplied ownership IDs', async () => {
  const owner = await account('owner');
  expect((await erase(request(body))).status).toBe(401);
  const foreignOrigin = request(body, owner.cookie);
  foreignOrigin.headers.set('origin', 'https://attacker.example');
  expect((await erase(foreignOrigin)).status).toBe(403);
  expect((await erase(request({ ...body, confirmation: 'да' }, owner.cookie))).status).toBe(400);
  expect((await erase(request({ ...body, userId: 'victim' }, owner.cookie))).status).toBe(400);
  expect(await prisma.user.findUnique({ where: { id: 'owner' } })).not.toBeNull();
});

it('protects shared demo accounts on the product endpoint', async () => {
  const shared = await account('shared', true);
  expect((await erase(request(body, shared.cookie))).status).toBe(403);
  expect(await prisma.candidate.findUnique({ where: { id: shared.candidateId } })).not.toBeNull();
});

it('deletes only own account and files and clears its session', async () => {
  const owner = await account('owner');
  const other = await account('other');
  const call = await prisma.callSession.create({ data: { candidateId: owner.candidateId, kind: 'qualifying', status: 'finished', policyVersion: 'test' } });
  const otherCall = await prisma.callSession.create({ data: { candidateId: other.candidateId, kind: 'defense', status: 'finished', policyVersion: 'test' } });
  await prisma.defenseRoomPlan.create({ data: { callSessionId: call.id, itemsJson: [{ question: 'Private source code question' }], sourceJson: { repoUrl: 'https://example.org/private-owner' } } });
  await prisma.defenseRoomPlan.create({ data: { callSessionId: otherCall.id, itemsJson: [], sourceJson: { keep: true } } });
  const upload = join(storage, 'uploads', owner.candidateId, 'original.pdf');
  const audio = join(storage, 'audio', 'calls', call.id, 'recording.wav');
  const otherFile = join(storage, 'uploads', other.candidateId, 'keep.pdf');
  for (const [file, text] of [[upload, 'own upload'], [audio, 'own audio'], [otherFile, 'keep']] as const) {
    await mkdir(resolve(file, '..'), { recursive: true });
    await writeFile(file, text);
  }
  const response = await erase(request({ ...body, reason: 'withdraw' }, owner.cookie));
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  expect(await prisma.user.findUnique({ where: { id: 'owner' } })).toBeNull();
  expect(await prisma.candidate.findUnique({ where: { id: owner.candidateId } })).toBeNull();
  expect(await prisma.callSession.findUnique({ where: { id: call.id } })).toBeNull();
  expect(await prisma.defenseRoomPlan.findUnique({ where: { callSessionId: call.id } })).toBeNull();
  expect(await prisma.defenseRoomPlan.findUnique({ where: { callSessionId: otherCall.id } })).not.toBeNull();
  expect(await prisma.user.findUnique({ where: { id: 'other' } })).not.toBeNull();
  await expect(readFile(upload)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(audio)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(otherFile, 'utf8')).toBe('keep');
});

it('erases employer conversation logs without deleting another employer in the same company', async () => {
  const company = await prisma.company.create({ data: { name: 'Shared company' } });
  const conversationIds: string[] = [];
  for (const id of ['owner-employer', 'other-employer']) {
    await prisma.user.create({ data: { id, name: id, role: 'employer', employerProfile: { create: { id: `profile-${id}`, companyId: company.id } } } });
    const conversation = await prisma.employerConversation.create({ data: { employerProfileId: `profile-${id}` } });
    conversationIds.push(conversation.id);
    await prisma.agentRun.create({ data: { purpose: 'employer_assistant', provider: 'stub', model: 'stub', latencyMs: 1, ok: true, conversationId: conversation.id } });
  }
  const ownerCookie = `cid=${signUserSession({ userId: 'owner-employer', role: 'employer', employerProfileId: 'profile-owner-employer' })}`;
  expect((await erase(request(body, ownerCookie))).status).toBe(200);
  expect(await prisma.agentRun.count({ where: { conversationId: conversationIds[0]! } })).toBe(0);
  expect(await prisma.agentRun.count({ where: { conversationId: conversationIds[1]! } })).toBe(1);
  expect(await prisma.employerConversation.findUnique({ where: { id: conversationIds[0]! } })).toBeNull();
  expect(await prisma.employerConversation.findUnique({ where: { id: conversationIds[1]! } })).not.toBeNull();
  expect(await prisma.company.findUnique({ where: { id: company.id } })).not.toBeNull();
  expect(await prisma.user.findUnique({ where: { id: 'other-employer' } })).not.toBeNull();
});
