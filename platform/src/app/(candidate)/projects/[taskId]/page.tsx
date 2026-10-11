import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProjectTaskView } from '@/components/project/ProjectTaskView';
import { requirePageCandidate } from '@/server/auth/page';
import { AppError } from '@/server/errors';
import { getTaskForCandidate } from '@/server/project/service';

export const metadata: Metadata = { title: 'Проектное задание - MESHWORK' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ taskId: string }> };

/** Задание кандидату: условие, контракт, видимые тесты, заготовка, сдача репозитория и результат проверки. */
export default async function ProjectTaskPage({ params }: Props) {
  const { taskId } = await params;
  const s = await requirePageCandidate(`/projects/${taskId}`);
  const task = await getTaskForCandidate(s.candidateId, taskId).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  return <ProjectTaskView key={task.id} task={task} />;
}
