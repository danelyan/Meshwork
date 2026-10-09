import { ConsultantGridPreview } from '@/components/design/ConsultantGridPreview';
import { ACCEPTED_GRID_SETTINGS } from '@/components/design/grid-preview-settings';

export default function GridV2Page() {
  return <ConsultantGridPreview version="v2" source="/design/consultant-grid-v2/index.html" initialSettings={ACCEPTED_GRID_SETTINGS} />;
}
