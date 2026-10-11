import { withErrors } from '@/server/errors';
import { listBlindVacancies } from '@/server/validation/blind-load';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/evaluate/blind/vacancies — демо-вакансии для слепой разметки жюри (вход не нужен). */
export const GET = withErrors(async () => {
  return Response.json({ vacancies: await listBlindVacancies() }, { headers: { 'cache-control': 'no-store' } });
});
