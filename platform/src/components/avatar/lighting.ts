/**
 * Пресеты света сцены Head3D. Чистые данные (без three.js), чтобы их можно было проверить тестом
 * и показать на демо (`/design/avatar`, select «Свет»). Компонент `SceneLights` в Head3D строит из
 * пресета лампы, карту окружения (RoomEnvironment или своя студия `softbox`) и
 * `scene.environmentIntensity`. Голова – металл: её тон задаёт прежде всего окружение, а не лампы,
 * поэтому тёмная теневая сторона получается только с тёмным окружением-студией.
 *
 * Камера смотрит вдоль −Z из точки (0, −0.18, 4.3): «справа» – +X, «сверху» – +Y, «спереди» – +Z,
 * «контровой» – отрицательный Z (за головой). Направленный свет бьёт из position в начало координат.
 *
 * Референс брендбука (docs/research/assets-19-fsp-wireframe-head.png): жёсткий ключ сверху-справа,
 * теневая сторона уходит в тёмно-серый, нити в тени почти пропадают. «Как сейчас» заливает голову
 * ровно со всех сторон – этим и отличается от референса.
 */

export type LightingPreset = 'current' | 'studio' | 'soft' | 'rim';

export interface DirectionalSpec {
  position: [number, number, number];
  intensity: number;
  color?: string;
}

/** Окружение-фотостудия (softbox-environment.ts): яркость стен и панели-софтбоксы, повёрнутые к центру. */
export interface SoftboxEnvironment {
  /** Яркость стен комнаты (0 – чёрные): чем ниже, тем темнее теневая сторона металла. */
  wall: number;
  softboxes: Array<{
    position: [number, number, number];
    size: [number, number];
    intensity: number;
  }>;
}

export interface LightRig {
  /** scene.environmentIntensity: доля отражений и рассеянного света от карты окружения. */
  environment: number;
  /** Своё окружение-студия вместо RoomEnvironment; нет – RoomEnvironment (светлая комната со всех сторон). */
  softbox?: SoftboxEnvironment;
  hemisphere: { sky: string; ground: string; intensity: number };
  directional: DirectionalSpec[];
}

export const DEFAULT_LIGHTING: LightingPreset = 'current';

export const LIGHTING_PRESETS: ReadonlyArray<{
  id: LightingPreset;
  label: string;
  hint: string;
  rig: LightRig;
}> = [
  {
    id: 'current',
    label: 'Как сейчас',
    hint: 'Прежние лампы: ключ слева-сверху, контровой справа-сзади, подсветка снизу, окружение 0.85 – голова освещена ровно со всех сторон.',
    rig: {
      environment: 0.85,
      hemisphere: { sky: '#e8edf5', ground: '#15171c', intensity: 0.5 },
      directional: [
        { position: [-2.5, 2.5, 3], intensity: 1.8 },
        { position: [3, 1, -2.5], intensity: 1.4, color: '#dfe6ff' },
        { position: [0, -2, 2], intensity: 0.3 },
      ],
    },
  },
  {
    id: 'studio',
    label: 'Студия как на референсе',
    hint: 'Тёмная студия с софтбоксом сверху-справа-спереди, слабым заполняющим слева и контровой полосой сзади-справа: левая сторона уходит в тёмно-серый, нити в тени гаснут.',
    rig: {
      environment: 1,
      softbox: {
        wall: 0.018,
        softboxes: [
          { position: [8, 7, 9], size: [16, 14], intensity: 5 },
          { position: [3, 12, 2], size: [9, 9], intensity: 1 },
          { position: [-11, 0, 5], size: [4, 6], intensity: 0.35 },
          { position: [6, 5, -10], size: [2, 9], intensity: 4 },
        ],
      },
      hemisphere: { sky: '#d9dee8', ground: '#0b0c10', intensity: 0.04 },
      directional: [
        { position: [2.6, 3.2, 2.4], intensity: 2.2 },
        { position: [-3, 0.4, 1.6], intensity: 0.1, color: '#cfd8ff' },
        { position: [1.6, 1.8, -3.2], intensity: 0.8, color: '#dfe6ff' },
      ],
    },
  },
  {
    id: 'soft',
    label: 'Мягкая студия',
    hint: 'Тот же софтбокс сверху-справа, но светлее стены и сильнее заполняющий слева: тень мягкая, нити видны и на теневой стороне – для светлой страницы.',
    rig: {
      environment: 1,
      softbox: {
        wall: 0.1,
        softboxes: [
          { position: [8, 7, 9], size: [16, 14], intensity: 3.2 },
          { position: [3, 12, 2], size: [9, 9], intensity: 1.2 },
          { position: [-11, 1, 6], size: [10, 10], intensity: 1.3 },
          { position: [-5, 5, -10], size: [3, 9], intensity: 3 },
        ],
      },
      hemisphere: { sky: '#e8edf5', ground: '#15171c', intensity: 0.2 },
      directional: [
        { position: [2.6, 3.2, 2.4], intensity: 1.8 },
        { position: [-3, 0.6, 2], intensity: 0.6, color: '#dfe6ff' },
        { position: [-1.4, 1.8, -3.2], intensity: 0.8, color: '#dfe6ff' },
      ],
    },
  },
  {
    id: 'rim',
    label: 'Кромка',
    hint: 'Две контровые полосы сзади слева и справа и слабый софтбокс спереди-сверху: силуэт обведён светом, лицо в полутени – драматичный вариант для тёмного фона.',
    rig: {
      environment: 1,
      softbox: {
        wall: 0.02,
        softboxes: [
          { position: [1, 9, 9], size: [10, 8], intensity: 1.4 },
          { position: [10, 3, -7], size: [3, 14], intensity: 9 },
          { position: [-10, 3, -7], size: [3, 14], intensity: 9 },
        ],
      },
      hemisphere: { sky: '#d9dee8', ground: '#0b0c10', intensity: 0.04 },
      directional: [
        { position: [0.6, 2.6, 3], intensity: 0.9 },
        { position: [3, 1.2, -2.6], intensity: 2.4, color: '#dfe6ff' },
        { position: [-3, 1.2, -2.6], intensity: 2.4, color: '#dfe6ff' },
      ],
    },
  },
];

export function isLightingPreset(value: string): value is LightingPreset {
  return LIGHTING_PRESETS.some((p) => p.id === value);
}

export function lightRig(preset: LightingPreset = DEFAULT_LIGHTING): LightRig {
  const found = LIGHTING_PRESETS.find((p) => p.id === preset) ?? LIGHTING_PRESETS.find((p) => p.id === DEFAULT_LIGHTING);
  if (!found) throw new Error('lighting: default preset is missing');
  return found.rig;
}
