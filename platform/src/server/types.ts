// Общие доменные типы, на которые ссылаются контракты лейнов.
// Совпадают с enum'ами Prisma (prisma/schema.prisma), но не зависят от клиента Prisma.

// Направления – src/lib/directions.ts (ADR 0003, дополнение 10.10): там же подписи и подкатегории.
export type { Specialization } from '../lib/directions';
// Грейды – src/lib/grades.ts (Senior – ADR 0003, дополнение 10.10 16:15).
export type { Grade } from '../lib/grades';
export type FspState = 'not_linked' | 'no_achievements' | 'unavailable' | 'linked';
