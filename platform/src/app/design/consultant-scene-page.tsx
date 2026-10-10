import { AvatarScene, type AvatarSceneVariant } from '@/components/avatar/AvatarScene';
import { ConsultantFeed } from '@/components/consultant/ConsultantFeed';
import { requirePageCandidate } from '@/server/auth/page';

/**
 * Общая серверная часть тестовых экранов консультанта с нашей головой: тот же guard и та же слитая
 * лента (онбординг + консультант), что у /consultant. Сцена получает ленту как children.
 */
export async function ConsultantSceneVariantPage({ path, variant }: { path: string; variant: AvatarSceneVariant }) {
  const s = await requirePageCandidate(path);
  return (
    <AvatarScene variant={variant}>
      <ConsultantFeed candidateId={s.candidateId} userId={s.userId} tag="consultant-variant" />
    </AvatarScene>
  );
}
