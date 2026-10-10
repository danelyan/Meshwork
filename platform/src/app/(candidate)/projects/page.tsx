import type { Metadata } from 'next';

import { ProjectFeed } from '@/components/project/ProjectFeed';
import { requirePageCandidate } from '@/server/auth/page';
import { listFeed } from '@/server/project/service';

export const metadata: Metadata = { title: 'Проекты - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/** Лента проектных заданий (ADR 0003, ступень 2): обезличенные задачи работодателей направления кандидата. */
export default async function ProjectsPage() {
  const s = await requirePageCandidate('/projects');
  const { items, limit } = await listFeed(s.candidateId);
  return <ProjectFeed items={items} limit={limit} />;
}
