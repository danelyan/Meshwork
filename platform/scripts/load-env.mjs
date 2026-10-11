// Загрузка .env платформы для скриптов (сид, eval): без неё скрипт, запущенный в worktree
// без переменных, уйдёт в чужую БД – Prisma Client общий и сам подгружает .env другого каталога.
// Ничего не перезаписывает: уже заданные переменные окружения главнее файла.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Если DATABASE_URL не задан – прочитать <platform>/.env (или `file`, если передан).
 * Возвращает путь прочитанного файла или null.
 */
export function loadPlatformEnv(file = join(PLATFORM_DIR, '.env')) {
  if (process.env.DATABASE_URL) return null;
  if (!existsSync(file)) return null;
  process.loadEnvFile(file);
  return file;
}
