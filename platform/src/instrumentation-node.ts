/** Node.js-часть instrumentation.ts: очистка записей созвонов по сроку хранения (ADR 0005). */
import { startRecordingRetentionJob } from './server/consent/recordings';

if (process.env.NEXT_PHASE !== 'phase-production-build') {
  startRecordingRetentionJob();
}
