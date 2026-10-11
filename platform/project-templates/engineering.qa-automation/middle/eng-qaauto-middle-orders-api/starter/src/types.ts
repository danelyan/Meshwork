// Типы контракта (contract.md). Менять не нужно.
import type { Express } from 'express';

/** Возвращает новое приложение с пустым состоянием. */
export type CreateApp = () => Express;
