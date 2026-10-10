import { HEAD_STYLES, type HeadStyle } from '@/components/avatar/head-styles';
import type { MouthShape } from '@/components/avatar/lipsync';

/** Что умеет вариант на демо-экране: вращение мышью, губы по общей озвучке. */
export type Variant =
  | { id: string; label: string; hint: string; kind: 'three'; style: HeadStyle }
  | { id: string; label: string; hint: string; kind: 'glass' }
  | { id: string; label: string; hint: string; kind: 'grid'; source: string };

export const GRID_VARIANTS: readonly Extract<Variant, { kind: 'grid' }>[] = [
  { id: 'grid-v1', label: 'Карина · сетка v1', kind: 'grid', source: '/design/consultant-grid-v1/index.html', hint: 'Iframe-макет Карины: следит за курсором сам, вращения и губ нет — у файла нет канала речи.' },
  { id: 'grid-v2', label: 'Карина · сетка v2', kind: 'grid', source: '/design/consultant-grid-v2/index.html', hint: 'Iframe-макет Карины: следит за курсором сам, вращения и губ нет — у файла нет канала речи.' },
  { id: 'grid-v3', label: 'Карина · сетка v3 (принятая)', kind: 'grid', source: '/design/consultant-grid-v3/head.html', hint: 'Iframe-голова из чата: следит за курсором (через её канал pointer), вращения и губ нет — у файла нет канала речи.' },
];

/** Список строится из HEAD_STYLES, поэтому новые стили (например, от лейна weave) подхватываются сами. */
export const VARIANTS: readonly Variant[] = [
  ...HEAD_STYLES.map((s): Variant => ({ id: `three-${s.id}`, label: `Наша · ${s.label}`, kind: 'three', style: s.id, hint: s.hint })),
  { id: 'glass', label: 'Карина · стеклянная голова', kind: 'glass', hint: 'Raw-WebGL голова с морфами рта (head-mouth.glb): губы по общей озвучке, вращение мышью; следит за курсором.' },
  ...GRID_VARIANTS,
];

export function variantById(id: string): Variant {
  return VARIANTS.find((v) => v.id === id) ?? VARIANTS[0]!;
}

export type MouthSink = (shape: MouthShape) => void;
/** Один источник формы рта (озвучка или ползунок) — на все панели, которые умеют губы. */
export interface MouthBus {
  subscribe(sink: MouthSink): () => void;
}
