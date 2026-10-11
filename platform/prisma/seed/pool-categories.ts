import { DEMO_POOL_AI_CATEGORIES } from './pool-ai';
import { DEMO_POOL_BACKEND } from './pool-backend';
import { DEMO_POOL_ENGINEERING } from './pool-engineering';
import { DEMO_POOL_FRONTEND } from './pool-frontend';
import type { DemoProfile } from './employer';

/** Демо-кандидаты по всем 51 категории (pool-<направление>.ts); засеваются в seedDirections до дозаполнения подкатегорий. */
export const DEMO_POOL_CATEGORIES: DemoProfile[] = [...DEMO_POOL_BACKEND, ...DEMO_POOL_FRONTEND, ...DEMO_POOL_AI_CATEGORIES, ...DEMO_POOL_ENGINEERING];
