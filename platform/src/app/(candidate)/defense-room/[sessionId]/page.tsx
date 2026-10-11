import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DefensePanel } from '@/components/call/DefensePanel';
import { requirePageCandidate } from '@/server/auth/page';
import { buildSnapshot, ICE_SERVERS } from '@/server/defense-room';
import { prisma } from '@/server/db';

export const metadata: Metadata = { title: 'Защита проекта - MESHWORK' };
export const dynamic = 'force-dynamic';

export default async function DefenseRoomPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const s = await requirePageCandidate(`/defense-room/${encodeURIComponent(sessionId)}`);
  const row = await prisma.callSession.findUnique({ where: { id: sessionId }, select: { candidateId: true, kind: true } });
  if (!row || row.candidateId !== s.candidateId || row.kind !== 'defense') notFound();
  return <DefensePanel sessionId={sessionId} initial={await buildSnapshot(sessionId)} iceServers={ICE_SERVERS} />;
}
