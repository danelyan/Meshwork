/** Лог сбоя необязательной загрузки (разговор, боковая панель): лента остаётся рабочей без неё. */
export const warn = (what: string) => (err: unknown) => console.warn(`[consultant] ${what} failed`, err instanceof Error ? err.message : err);
