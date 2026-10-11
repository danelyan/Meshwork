/** Ссылка на обезличенную выгрузку (без `server-only`: нужна и странице, и тестам). */
export const toCsvHref = (kind: 'test' | 'matching' | 'llm', days: number) => `/api/admin/export/${kind}.csv?days=${days}`;
