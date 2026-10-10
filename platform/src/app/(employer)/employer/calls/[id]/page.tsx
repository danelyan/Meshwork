import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import styles from '@/components/call/call.module.css';
import { EmployerRoom } from '@/components/call/EmployerRoom';
import { Kicker } from '@/components/ui';
import { requirePageEmployer } from '@/server/auth/page';
import { prisma } from '@/server/db';
import { buildSnapshot, redactSnapshot, resolveViewer } from '@/server/defense-room';
import { AppError } from '@/server/errors';

export const metadata: Metadata = { title: 'Комната защиты - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Комната работодателя (ADR 0003): только при принятом приглашении кандидата, иначе 404. */
export default async function EmployerCallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePageEmployer(`/employer/calls/${encodeURIComponent(id)}`);
  let viewer;
  let session;
  try {
    ({ viewer, session } = await resolveViewer(s, id));
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const candidate = await prisma.candidate.findUnique({ where: { id: session.candidateId }, select: { name: true } });
  return (
    <div className={styles.page}>
      <div>
        <Kicker>Комната защиты</Kicker>
        <h1>{candidate?.name ?? 'Кандидат'}</h1>
      </div>
      <EmployerRoom sessionId={id} initial={redactSnapshot(await buildSnapshot(id), viewer)} candidateId={session.candidateId} selfUserId={s.userId} />
    </div>
  );
}
