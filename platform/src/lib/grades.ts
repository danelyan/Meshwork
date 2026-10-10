// Грейды (ADR-0002; Senior — ADR 0003, дополнение 10.10 16:15). Один источник для кода, UI и zod-схем.
// Совпадает с enum Grade (prisma/schema.prisma). Чистый модуль — его читают и клиентские компоненты.
// Senior — сверх ТЗ (организаторам достаточно двух грейдов), в документе сдачи так и названо.

export const GRADES = ['junior', 'middle', 'senior'] as const;
export type Grade = (typeof GRADES)[number];

export const GRADE_LABEL: Record<Grade, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior' };

export function isGrade(v: unknown): v is Grade {
  return typeof v === 'string' && (GRADES as readonly string[]).includes(v);
}

export function gradeLabel(g: string | null | undefined): string {
  return isGrade(g) ? GRADE_LABEL[g] : (g ?? '');
}

/** Грейд ниже (Senior → Middle → Junior); у Junior — null. */
export function lowerGrade(g: Grade): Grade | null {
  const i = GRADES.indexOf(g);
  return i > 0 ? GRADES[i - 1]! : null;
}
