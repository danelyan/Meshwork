// Признак одноразового эксперта жюри (режим эксперта, server/expert): почта в зарезервированном домене .invalid
// (RFC 2606). Без зависимостей — импортируется и в подборку работодателя (employer/matching.ts).
export const EXPERT_EMAIL_DOMAIN = 'expert.invalid';
export const EXPERT_EMAIL_SUFFIX = `@${EXPERT_EMAIL_DOMAIN}`;

/** Фрагмент where для Candidate: не эксперт. Для мест, где кандидаты видны работодателю. */
export const NOT_EXPERT_CANDIDATE = { NOT: { email: { endsWith: EXPERT_EMAIL_SUFFIX } } } as const;

export function isExpertEmail(email: string | null | undefined): boolean {
  return Boolean(email?.endsWith(EXPERT_EMAIL_SUFFIX));
}
