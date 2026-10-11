// Импортируется первым в eval/call/personas.ts и eval/defense/personas.ts (до db.ts и env.ts):
// грузит .env, включает stub по флагу --stub, ставит одновременность LLM = 1 (вызовы строго
// последовательные – машина слабая) и не даёт писать персоны в рабочую БД.
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

export const STUB = process.argv.includes('--stub');
if (STUB) {
  process.env.LLM_PROVIDER = 'stub';
  process.env.LLM_STUB_DEMO = 'false';
}
process.env.LLM_MAX_CONCURRENCY = '1';
// Персоны создают кандидатов, созвоны и сабмиты: только в отдельной БД (имя содержит validation/eval/test).
const url = process.env.EVAL_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const dbName = url.split('?')[0]!.split('/').pop() ?? '';
if (!/(validation|eval|test)/i.test(dbName)) {
  console.error(`eval: БД «${dbName || '(не задана)'}» не похожа на отдельную. Задай EVAL_DATABASE_URL (имя с validation/eval/test) – персоны пишут в БД кандидатов и созвоны.`);
  process.exit(2);
}
process.env.DATABASE_URL = url;
// Аудио в этих прогонах нет, но драйвер созвона пишет каталог данных: держим его во временной папке.
process.env.CALL_DATA_DIR ??= `${process.env.TMPDIR ?? '/tmp'}/fsp-eval-calls`;
// Суточный лимит созвонов на кандидата не мешает: у каждого созвона свой кандидат.
