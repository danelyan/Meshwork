// Общие доменные типы, на которые ссылаются контракты лейнов.
// Совпадают с enum'ами Prisma (prisma/schema.prisma), но не зависят от клиента Prisma.

// Направления — src/lib/directions.ts (ADR 0003, дополнение 10.10): там же подписи и подкатегории.
export type { Specialization } from '../lib/directions';
export type Grade = 'junior' | 'middle';
export type FspState = 'not_linked' | 'no_achievements' | 'unavailable' | 'linked';
