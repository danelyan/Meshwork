import { LEVEL_HINT, LEVEL_LABEL } from '@/lib/labels';
import type { EvidenceLevel } from '@/server/claims/types';

import ui from './ui.module.css';

// Различимы без цвета: текст + знак (заполненность/форма) + стиль рамки. Лайм здесь не используется.
const MARK: Record<EvidenceLevel, string> = {
  self_reported: '○', // пусто: ничем не подтверждено
  artifact: '◐', // след работы
  third_party: '◑', // подтверждено со стороны
  platform: '●', // проверено на платформе
};

const STYLE: Record<EvidenceLevel, string> = {
  self_reported: `${ui.tag} ${ui.red}`, // пунктир
  artifact: `${ui.tag} ${ui.outline}`, // тонкий контур
  third_party: `${ui.tag}`, // серая заливка
  platform: `${ui.tag} ${ui.solid}`, // синяя заливка
};

export function LevelBadge({ level }: { level: EvidenceLevel }) {
  return (
    <span className={STYLE[level]} title={LEVEL_HINT[level]} data-level={level}>
      <span aria-hidden="true" style={{ marginRight: 6 }}>
        {MARK[level]}
      </span>
      {LEVEL_LABEL[level]}
    </span>
  );
}
