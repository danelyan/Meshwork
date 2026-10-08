import type { AgentTool } from '../types';

/**
 * Реестр инструментов консультанта (ТЗ § 4.1, 14 штук). Наполняет лейн agent.
 * Записывающих в профиль инструментов здесь быть не должно (ТЗ § 2).
 */
// Разнотипные инструменты в одном списке: вход/выход проверяются Zod-схемой каждого.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tools: AgentTool<any, any>[] = [];
