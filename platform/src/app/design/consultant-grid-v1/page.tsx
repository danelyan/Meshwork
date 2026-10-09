import { ConsultantGridPreview } from '@/components/design/ConsultantGridPreview';
import { ACCEPTED_GRID_SETTINGS } from '@/components/design/grid-preview-settings';

export default function GridV1Page() {
  return <ConsultantGridPreview version="v1" source="/design/consultant-grid-v1/index.html" initialSettings={ACCEPTED_GRID_SETTINGS} />;
}
