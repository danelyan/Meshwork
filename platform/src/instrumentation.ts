/**
 * Next.js вызывает register() один раз при старте серверного процесса. Фоновые задачи — только в Node.js-рантайме:
 * очистка аудио созвонов по сроку хранения (ADR 0005, CALL_RECORDING_RETENTION_DAYS) при старте и раз в сутки.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startRecordingRetentionJob } = await import('./server/consent/recordings');
  startRecordingRetentionJob();
}
