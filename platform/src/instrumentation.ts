/**
 * Next.js вызывает register() один раз при старте серверного процесса. Фоновые задачи — только в Node.js-рантайме:
 * очистка аудио созвонов по сроку хранения (ADR 0005, CALL_RECORDING_RETENTION_DAYS) при старте и раз в сутки.
 *
 * Импорт node-кода — строго внутри `if (process.env.NEXT_RUNTIME === 'nodejs')` (документация Next.js,
 * «Importing runtime-specific code»): ранний `return` сборщик не распознаёт, и node:crypto/fs попадают
 * в edge-бандл — dev-сервер падает на каждой странице.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
