import { LEVEL_HINT, LEVEL_LABEL } from '@/lib/labels';
import type { EvidenceLevel } from '@/server/claims/types';

import ui from './ui.module.css';

export function LevelBadge({ level }: { level: EvidenceLevel }) {
  const cls = level === 'platform' ? ui.tag : level === 'self_reported' ? `${ui.tag} ${ui.outline}` : `${ui.tag} ${ui.red}`;
  return (
    <span className={cls} title={LEVEL_HINT[level]} data-level={level}>
      {LEVEL_LABEL[level]}
    </span>
  );
}
