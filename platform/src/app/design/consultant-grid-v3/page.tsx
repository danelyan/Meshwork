import { ConsultantGridPreview } from '@/components/design/ConsultantGridPreview';
import { ACCEPTED_GRID_SETTINGS } from '@/components/design/grid-preview-settings';

export default function GridV3Page() {
  return <ConsultantGridPreview version="v3" source="/design/consultant-grid-v3/index.html" initialSettings={ACCEPTED_GRID_SETTINGS} />;
}
