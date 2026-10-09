import { prisma } from '@/server/db';
import { demoResumeFor, readDemoResumePdf } from '@/server/demo/resumes';
import { getEnv } from '@/server/env';
import { AppError, errors, withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Демо-резюме текущего демо-кандидата (PDF) — чтобы жюри не искало файлы на диске.
 * Только при DEMO_LOGIN и только для isDemo; чужого резюме по параметру не отдаём.
 * `?info=1` — метаданные (имя файла, ссылка для вставки) вместо файла.
 */
export const GET = withErrors(async (req: Request) => {
  if (!getEnv().DEMO_LOGIN) throw new AppError('forbidden', 'Демо-вход выключен', 403);
  const candidateId = requireCandidate(req);
  const candidate = await prisma.candidate.findFirst({ where: { id: candidateId, isDemo: true }, select: { id: true } });
  if (!candidate) throw errors.notFound('Демо-резюме есть только у демо-кандидатов');
  const resume = demoResumeFor(candidate.id);
  if (!resume) throw errors.notFound('Для этого демо-кандидата нет резюме');

  if (new URL(req.url).searchParams.get('info') === '1') {
    return Response.json({ fileName: resume.fileName, link: resume.link });
  }
  const pdf = await readDemoResumePdf(resume);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${resume.fileName}"`,
      'cache-control': 'no-store',
    },
  });
});
