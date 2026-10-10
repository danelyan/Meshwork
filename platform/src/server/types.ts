// Общие доменные типы, на которые ссылаются контракты лейнов.
// Совпадают с enum'ами Prisma (prisma/schema.prisma), но не зависят от клиента Prisma.

export type Specialization = 'backend' | 'frontend';
export type Grade = 'junior' | 'middle' | 'senior';
export type FspState = 'not_linked' | 'no_achievements' | 'unavailable' | 'linked';
