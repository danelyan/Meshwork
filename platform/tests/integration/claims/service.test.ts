import { syncClaimCatalog } from '@/server/claims/catalog-sync';
import { getCatalog } from '@/server/claims/catalog';
import { confirmClaim, editClaim, getConfirmedClaims, getProfile, proposeClaims, rejectClaim } from '@/server/claims/service';
import type { VerifiedClaim } from '@/server/claims/types';
import { AppError } from '@/server/errors';

import { prisma, resetDb } from '../../helpers/db';

const A = 'cand-a';
const B = 'cand-b';

const v = (catalogId: string, extra?: Partial<VerifiedClaim>): VerifiedClaim => ({
  catalogId,
  statement: `Формулировка ${catalogId}`,
  quote: `цитата про ${catalogId}`,
  sourceRef: 'cv.pdf#l3',
  confidence: 'high',
  level: 'self_reported',
  limits: 'Не доказывает: x',
  suggestedProof: ['interview:defend'],
  sourceKind: 'resume',
  ...extra,
});

async function expectStatus(p: Promise<unknown>, status: number) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await p.catch((e: AppError) => expect(e.status).toBe(status));
}

beforeEach(async () => {
  await resetDb();
  await prisma.candidate.createMany({
    data: [
      { id: A, email: 'a@example.test', name: 'А', specialization: 'backend' },
      { id: B, email: 'b@example.test', name: 'Б' },
    ],
  });
});
afterAll(() => prisma.$disconnect());

describe('каталог в БД', () => {
  it('syncClaimCatalog: 72 записи, повторный запуск идемпотентен; getCatalog читает из БД', async () => {
    await syncClaimCatalog(prisma);
    await syncClaimCatalog(prisma);
    expect(await prisma.claimCatalog.count()).toBe(72);
    const cat = await getCatalog();
    expect(cat.find((c) => c.id === 'be.idempotency')).toMatchObject({ specialization: 'backend', grades: ['middle'], weight: 3 });
  });

  it('пустой ClaimCatalog: getCatalog отдаёт файл, proposeClaims досеивает', async () => {
    expect((await getCatalog()).length).toBe(72);
    await proposeClaims(A, [v('be.cache')]);
    expect(await prisma.claimCatalog.count()).toBe(72);
  });
});

describe('proposeClaims', () => {
  it('создаёт черновики proposed; неизвестный ID пропускает; кандидат не найден → 404', async () => {
    const rows = await proposeClaims(A, [v('be.cache'), v('be.nope')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ candidateId: A, catalogId: 'be.cache', status: 'proposed', level: 'self_reported', quote: 'цитата про be.cache' });
    await expectStatus(proposeClaims('ghost', [v('be.cache')]), 404);
  });

  it('уровень platform и уровень выше максимума источника — отказ', async () => {
    await expectStatus(proposeClaims(A, [v('be.cache', { level: 'platform' })]), 400);
    await expectStatus(proposeClaims(A, [v('be.cache', { level: 'third_party', sourceKind: 'resume' })]), 400);
    await expectStatus(proposeClaims(A, [v('be.cache', { level: 'artifact', sourceKind: 'chat' })]), 400);
    expect(await proposeClaims(A, [v('common.algo-complexity', { level: 'third_party', sourceKind: 'codeforces' })])).toHaveLength(1);
  });

  it('отклонённое не предлагается повторно, даже с более сильным источником', async () => {
    const [row] = await proposeClaims(A, [v('be.cache')]);
    await rejectClaim(A, row!.id);
    expect(await proposeClaims(A, [v('be.cache')])).toEqual([]);
    expect(await proposeClaims(A, [v('be.cache', { level: 'artifact', sourceKind: 'github' })])).toEqual([]);
    // другой кандидат — не затронут
    expect(await proposeClaims(B, [v('be.cache')])).toHaveLength(1);
  });

  it('тот же уровень повторно — пропуск; выше уровнем — черновик обновляется', async () => {
    const [first] = await proposeClaims(A, [v('be.cache')]);
    expect(await proposeClaims(A, [v('be.cache', { quote: 'другая' })])).toEqual([]);
    const [upd] = await proposeClaims(A, [v('be.cache', { level: 'artifact', sourceKind: 'github', quote: 'из README' })]);
    expect(upd?.id).toBe(first!.id);
    expect(upd).toMatchObject({ level: 'artifact', sourceKind: 'github', quote: 'из README', status: 'proposed' });
    expect(await prisma.claim.count({ where: { candidateId: A } })).toBe(1);
  });

  it('подтверждённое не меняется без клика: более сильное доказательство — отдельный черновик', async () => {
    const [first] = await proposeClaims(A, [v('be.cache')]);
    await confirmClaim(A, first!.id);
    const [draft] = await proposeClaims(A, [v('be.cache', { level: 'artifact', sourceKind: 'github' })]);
    expect(draft?.id).not.toBe(first!.id);
    expect((await prisma.claim.findUnique({ where: { id: first!.id } }))?.status).toBe('confirmed');
    const p = await getProfile(A);
    expect(p.claims.map((c) => [c.level, c.status])).toEqual([
      ['artifact', 'proposed'],
      ['self_reported', 'confirmed'],
    ]);
  });

  it('один вызов с дублями ID — одна запись', async () => {
    const rows = await proposeClaims(A, [v('be.cache'), v('be.cache')]);
    expect(rows).toHaveLength(1);
  });
});

describe('confirm / edit / reject', () => {
  let id: string;
  beforeEach(async () => {
    const rows = await proposeClaims(A, [v('be.cache')]);
    id = rows[0]?.id ?? '';
  });

  it('confirm: proposed → confirmed с датой; повторно — идемпотентно', async () => {
    const c = await confirmClaim(A, id);
    expect(c.status).toBe('confirmed');
    expect(c.confirmedAt).toBeInstanceOf(Date);
    const again = await confirmClaim(A, id);
    expect(again.confirmedAt?.getTime()).toBe(c.confirmedAt?.getTime());
  });

  it('edit меняет только формулировку: уровень, цитата, источник, ID — прежние; статус edited с датой', async () => {
    const before = await prisma.claim.findUniqueOrThrow({ where: { id } });
    const c = await editClaim(A, id, '  Кэшировал справочники в Redis  ');
    expect(c).toMatchObject({
      statement: 'Кэшировал справочники в Redis',
      status: 'edited',
      level: before.level,
      quote: before.quote,
      sourceRef: before.sourceRef,
      sourceKind: before.sourceKind,
      catalogId: before.catalogId,
    });
    expect(c.confirmedAt).toBeInstanceOf(Date);
    const again = await editClaim(A, id, 'Ещё раз');
    expect(again.confirmedAt?.getTime()).toBe(c.confirmedAt?.getTime());
  });

  it('edit: пустая/длинная формулировка → ZodError', async () => {
    await expect(editClaim(A, id, ' ')).rejects.toMatchObject({ name: 'ZodError' });
    await expect(editClaim(A, id, 'x'.repeat(301))).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('reject из confirmed; после reject confirm/edit → 409, reject — идемпотентно', async () => {
    await confirmClaim(A, id);
    expect((await rejectClaim(A, id)).status).toBe('rejected');
    await expectStatus(confirmClaim(A, id), 409);
    await expectStatus(editClaim(A, id, 'Новое'), 409);
    expect((await rejectClaim(A, id)).status).toBe('rejected');
    expect((await prisma.claim.findUniqueOrThrow({ where: { id } })).statement).toBe('Формулировка be.cache');
  });

  it('чужое утверждение и несуществующий/кривой ID → 404, запись не меняется', async () => {
    await expectStatus(confirmClaim(B, id), 404);
    await expectStatus(editClaim(B, id, 'Взлом'), 404);
    await expectStatus(rejectClaim(B, id), 404);
    await expectStatus(confirmClaim(A, 'nope'), 404);
    await expectStatus(confirmClaim(A, '../../x'), 404);
    const row = await prisma.claim.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'proposed', statement: 'Формулировка be.cache' });
  });
});

describe('getProfile', () => {
  it('по уровням (выше — первыми), с датой и источником; отклонённые не показываются; категория только из теста', async () => {
    const rows = await proposeClaims(A, [
      v('be.cache'),
      v('common.git', { level: 'artifact', sourceKind: 'github', sourceRef: 'github:a/r#README:l3' }),
      v('be.transactions'),
    ]);
    await rejectClaim(A, rows.find((r) => r.catalogId === 'be.transactions')!.id);
    await confirmClaim(A, rows.find((r) => r.catalogId === 'be.cache')!.id);
    const p = await getProfile(A);
    expect(p.candidate).toMatchObject({ id: A, specialization: 'backend', fspState: 'not_linked' });
    expect(p.category).toBeNull();
    expect(p.claims.map((c) => c.catalogId)).toEqual(['common.git', 'be.cache']);
    expect(p.claims[0]).toMatchObject({ level: 'artifact', sourceKind: 'github', sourceRef: 'github:a/r#README:l3', suggestedProof: ['interview:defend'] });
    expect(typeof p.claims[0]?.createdAt).toBe('string');
    expect(p.byLevel.artifact.map((c) => c.catalogId)).toEqual(['common.git']);
    expect(p.byLevel.self_reported.map((c) => c.catalogId)).toEqual(['be.cache']);
    expect(p.byLevel.platform).toEqual([]);

    await prisma.candidateCategory.create({ data: { candidateId: A, specialization: 'backend', grade: 'junior' } });
    expect((await getProfile(A)).category).toMatchObject({ specialization: 'backend', grade: 'junior' });
  });

  it('getConfirmedClaims — только подтверждённые кликом', async () => {
    const rows = await proposeClaims(A, [v('be.cache'), v('common.git')]);
    await editClaim(A, rows[1]!.id, 'Работал с ветками');
    expect((await getConfirmedClaims(A)).map((c) => [c.catalogId, c.status])).toEqual([['common.git', 'edited']]);
  });

  it('кандидат не найден → 404', async () => {
    await expectStatus(getProfile('ghost'), 404);
  });
});
