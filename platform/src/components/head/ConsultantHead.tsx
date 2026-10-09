import { ConsultantGridPreview } from '@/components/design/ConsultantGridPreview';
import { ACCEPTED_GRID_SETTINGS } from '@/components/design/grid-preview-settings';

/** Approved mirrored grid, shared with v3; the conversation stays in React. */
export function ConsultantHead() {
  return <ConsultantGridPreview portrait version="v3"
    source="/design/consultant-grid-v3/head.html" initialSettings={ACCEPTED_GRID_SETTINGS} />;
}
