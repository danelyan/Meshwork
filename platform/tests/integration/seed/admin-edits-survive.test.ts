// Повторный сид не перезаписывает правки из админки (/admin/catalog): Subcategory.status/order,
// ClaimCatalog.statement/limits. Недостающие записи сид создаёт, остальные поля обновляет как раньше.
import { seedClaims } from '../../../prisma/seed/claims';
import { seedDirections } from '../../../prisma/seed/directions';
import { SUBCATEGORIES } from '@/lib/directions';
import { prisma, resetDb } from '../../helpers/db';

describe('сид и правки админки (БД)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    await seedDirections(prisma);
  });
  afterAll(() => prisma.$disconnect());

  it('Subcategory: status и order из админки переживают повторный сид, title обновляется, удалённая создаётся заново', async () => {
    const [a, b] = SUBCATEGORIES as [(typeof SUBCATEGORIES)[number], (typeof SUBCATEGORIES)[number]];
    const newStatus = a.status === 'active' ? 'planned' : 'active';
    await prisma.subcategory.update({ where: { id: a.id }, data: { status: newStatus, order: 999, title: 'Чужой заголовок' } });
    await prisma.subcategory.delete({ where: { id: b.id } });

    await seedDirections(prisma);

    const rowA = await prisma.subcategory.findUniqueOrThrow({ where: { id: a.id } });
    expect(rowA).toMatchObject({ status: newStatus, order: 999, title: a.title });
    const rowB = await prisma.subcategory.findUniqueOrThrow({ where: { id: b.id } });
    expect(rowB).toMatchObject({ status: b.status, order: b.order, title: b.title });
  });

  it('ClaimCatalog: statement и limits из админки переживают повторный сид, weight обновляется', async () => {
    const x = await prisma.claimCatalog.findFirstOrThrow({ orderBy: { id: 'asc' } });
    await prisma.claimCatalog.update({ where: { id: x.id }, data: { statement: 'Правка админа', limits: 'Лимит админа', weight: x.weight + 7 } });

    await seedClaims(prisma);

    const rowX = await prisma.claimCatalog.findUniqueOrThrow({ where: { id: x.id } });
    expect(rowX).toMatchObject({ statement: 'Правка админа', limits: 'Лимит админа', weight: x.weight });
  });
});
