import { POST as claimAction } from '@/app/api/claims/[id]/[action]/route';
import { GET as profile } from '@/app/api/profile/route';
import { proposeClaims } from '@/server/claims/service';
import type { VerifiedClaim } from '@/server/claims/types';
import { signSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { jsonRequest } from '../../helpers/requests';

const cookieOf = (id: string) => `cid=${signSession(id)}`;
const ctx = (id: string, action: string) => ({ params: Promise.resolve({ id, action }) });
const verified: VerifiedClaim = {
  catalogId: 'be.cache',
  statement: 'Кэшировал данные',
  quote: 'Кэшировал справочники в Redis',
  sourceRef: 'cv.pdf#l4',
  confidence: 'high',
  level: 'self_reported',
  limits: 'Не доказывает: x',
  suggestedProof: ['interview:defend'],
  sourceKind: 'resume',
};

let claimId: string;
beforeEach(async () => {
  await resetDb();
  await prisma.candidate.createMany({
    data: [
      { id: 'owner', email: 'o@example.test', name: 'Владелец' },
      { id: 'other', email: 'x@example.test', name: 'Чужой' },
    ],
  });
  const rows = await proposeClaims('owner', [verified]);
  claimId = rows[0]?.id ?? '';
});
afterAll(() => prisma.$disconnect());

describe('GET /api/profile', () => {
  it('без сессии → 401; поддельная кука → 401', async () => {
    expect((await profile(jsonRequest('/api/profile', 'GET'))).status).toBe(401);
    expect((await profile(jsonRequest('/api/profile', 'GET', undefined, 'cid=owner.9999999999.forged'))).status).toBe(401);
  });

  it('свой профиль: утверждения с цитатой и уровнем; чужие не видны', async () => {
    const res = await profile(jsonRequest('/api/profile', 'GET', undefined, cookieOf('owner')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claims).toEqual([expect.objectContaining({ id: claimId, quote: 'Кэшировал справочники в Redis', level: 'self_reported', status: 'proposed' })]);
    const other = await (await profile(jsonRequest('/api/profile', 'GET', undefined, cookieOf('other')))).json();
    expect(other.claims).toEqual([]);
  });

  it('сессия на удалённого кандидата → 401 session_stale', async () => {
    expect((await profile(jsonRequest('/api/profile', 'GET', undefined, cookieOf('ghost')))).status).toBe(401);
  });
});

describe('POST /api/claims/:id/:action', () => {
  it('без сессии → 401', async () => {
    expect((await claimAction(jsonRequest(`/api/claims/${claimId}/confirm`, 'POST'), ctx(claimId, 'confirm'))).status).toBe(401);
  });

  it('confirm → 200 confirmed', async () => {
    const res = await claimAction(jsonRequest(`/api/claims/${claimId}/confirm`, 'POST', undefined, cookieOf('owner')), ctx(claimId, 'confirm'));
    expect(res.status).toBe(200);
    expect((await res.json()).claim).toMatchObject({ id: claimId, status: 'confirmed' });
  });

  it('edit → только формулировка; уровень и цитату из тела не принимает', async () => {
    const res = await claimAction(
      jsonRequest(`/api/claims/${claimId}/edit`, 'POST', { statement: 'Кэшировал справочники', level: 'third_party', quote: 'подмена' }, cookieOf('owner')),
      ctx(claimId, 'edit'),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).claim).toMatchObject({ statement: 'Кэшировал справочники', status: 'edited', level: 'self_reported', quote: 'Кэшировал справочники в Redis' });
  });

  it('edit без statement → 400 validation_failed', async () => {
    const res = await claimAction(jsonRequest(`/api/claims/${claimId}/edit`, 'POST', {}, cookieOf('owner')), ctx(claimId, 'edit'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation_failed');
  });

  it('reject → 200, затем confirm → 409', async () => {
    expect((await claimAction(jsonRequest('/x', 'POST', undefined, cookieOf('owner')), ctx(claimId, 'reject'))).status).toBe(200);
    const res = await claimAction(jsonRequest('/x', 'POST', undefined, cookieOf('owner')), ctx(claimId, 'confirm'));
    expect(res.status).toBe(409);
  });

  it('чужое утверждение → 404 для всех действий; запись не меняется', async () => {
    for (const action of ['confirm', 'reject']) {
      expect((await claimAction(jsonRequest('/x', 'POST', undefined, cookieOf('other')), ctx(claimId, action))).status).toBe(404);
    }
    expect((await claimAction(jsonRequest('/x', 'POST', { statement: 'Взлом' }, cookieOf('other')), ctx(claimId, 'edit'))).status).toBe(404);
    expect(await prisma.claim.findUniqueOrThrow({ where: { id: claimId } })).toMatchObject({ status: 'proposed', statement: 'Кэшировал данные' });
  });

  it('неизвестное действие → 404', async () => {
    expect((await claimAction(jsonRequest('/x', 'POST', undefined, cookieOf('owner')), ctx(claimId, 'promote'))).status).toBe(404);
  });
});
