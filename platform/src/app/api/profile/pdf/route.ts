import { withErrors } from '@/server/errors';
import { profilePdf } from '@/server/profile-pdf';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/profile/pdf – стандартизированный PDF-профиль текущего кандидата (R-C-03): категория из теста,
 * основное, подтверждённые утверждения с уровнем доказанности, ФСП, ступени проверки. Формируется сервером,
 * отдаётся файлом (`attachment`). Только свои данные – candidateId из сессии.
 */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const { filename, data } = await profilePdf(candidateId);
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(data.length),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
});
