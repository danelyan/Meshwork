import { POST as batch } from '@/app/api/claims/confirm-batch/route';
import { proposeClaims } from '@/server/claims/service';
import type { VerifiedClaim } from '@/server/claims/types';
import { signSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const cookieOf = (id: string) => `cid=${signSession(id)}`;
const v = (catalogId: string, level: VerifiedClaim['level'], sourceKind: VerifiedClaim['sourceKind']): VerifiedClaim => ({
  catalogId, statement: `S ${catalogId}`, quote: `Цитата для ${catalogId} достаточно длинная`, sourceRef: 'cv.pdf#l1', confidence: 'high', level,
  limits: 'x', suggestedProof: [], sourceKind,
});
const post = (ids: unknown, who = 'owner') => batch(jsonRequest('/api/claims/confirm-batch', 'POST', { ids }, cookieOf(who)));

let ids: Record<string, string>;
beforeEach(async () => {
  await resetDb();
  await prisma.candidate.createMany({ data: [
    { id: 'owner', email: 'o@example.test', name: 'В' },
    { id: 'other', email: 'x@example.test', name: 'Ч' },
  ] });
  const mine = await proposeClaims('owner', [v('be.lang-core', 'self_reported', 'resume'), v('be.framework', 'self_reported', 'resume'), v('be.rest-design', 'artifact', 'github')]);
  const theirs = await proposeClaims('other', [v('be.lang-core', 'self_reported', 'resume')]);
  ids = { a: mine[0]!.id, b: mine[1]!.id, art: mine[2]!.id, foreign: theirs[0]!.id };
});
afterAll(() => prisma.$disconnect());

describe('POST /api/claims/confirm-batch', () => {
  it('без сессии → 401', async () => {
    expect((await batch(jsonRequest('/api/claims/confirm-batch', 'POST', { ids: ['x'] }))).status).toBe(401);
  });

  it('подтверждает self_reported; artifact и чужие пропускает с причиной', async () => {
    const res = await post([ids.a, ids.b, ids.art, ids.foreign, 'nope']);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmed.sort()).toEqual([ids.a, ids.b].sort());
    expect(body.skipped).toEqual(expect.arrayContaining([
      { id: ids.art, reason: 'not_self_reported' },
      { id: ids.foreign, reason: 'not_found' },
      { id: 'nope', reason: 'not_found' },
    ]));
    const st = async (id: string) => (await prisma.claim.findUnique({ where: { id } }))?.status;
    expect(await st(ids.a!)).toBe('confirmed');
    expect(await st(ids.art!)).toBe('proposed');
    expect(await st(ids.foreign!)).toBe('proposed');
  });

  it('идемпотентность: повтор ничего не меняет и сообщает already_confirmed', async () => {
    await post([ids.a]);
    const body = await (await post([ids.a, ids.a])).json();
    expect(body.confirmed).toEqual([]);
    expect(body.skipped).toEqual([{ id: ids.a, reason: 'already_confirmed' }]);
  });

  it('отклонённое не оживает', async () => {
    await prisma.claim.update({ where: { id: ids.a! }, data: { status: 'rejected' } });
    const body = await (await post([ids.a])).json();
    expect(body.skipped).toEqual([{ id: ids.a, reason: 'rejected' }]);
    expect((await prisma.claim.findUnique({ where: { id: ids.a! } }))?.status).toBe('rejected');
  });

  it('пустой список → 400', async () => {
    expect((await post([])).status).toBe(400);
  });
});
