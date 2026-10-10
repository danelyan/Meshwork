import { AvatarScene, type AvatarSceneVariant } from '@/components/avatar/AvatarScene';
import { loadLastChat, type RestoredChat } from '@/server/agent/restore';
import { requirePageCandidate } from '@/server/auth/page';
import { resolveChatDemoContext } from '@/server/demo/context';

/** Общая серверная часть тестовых экранов консультанта с нашей головой: тот же guard и данные, что у /consultant. */
export async function ConsultantSceneVariantPage({ path, variant }: { path: string; variant: AvatarSceneVariant }) {
  const s = await requirePageCandidate(path);
  const demo = await resolveChatDemoContext(s.candidateId).catch(() => ({ noLlm: false, resume: null }));
  let initial: RestoredChat | undefined;
  try {
    initial = await loadLastChat(s.candidateId);
  } catch (err) {
    console.warn('[consultant-variant] restore failed', err instanceof Error ? err.message : err);
  }
  return <AvatarScene variant={variant} demo={demo} initial={initial} />;
}
