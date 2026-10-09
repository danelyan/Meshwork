'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, type Group, type Mesh, MeshStandardMaterial } from 'three';

import { buildHeadGeometry, JAW_OPEN } from './head-geometry';
import { mouthOpen, smoothLevel } from './level';
import type { VoiceStatus } from './voice';

/**
 * Серебристая голова-сетка компаньона на тёмном фоне (брендбук ФСП, docs/research/assets-19).
 * Металл MeshStandardMaterial + квадратная сетка в фрагментном шейдере по `gridUv` (onBeforeCompile):
 * диагоналей треугольников не видно, морфы и свет работают. Рот — морф `jawOpen` по громкости звука.
 * Грузится только через next/dynamic({ ssr: false }) — three.js не попадает в общий бандл.
 */
export interface Head3DProps {
  status: VoiceStatus;
  getLevel: () => number;
  reducedMotion?: boolean;
}

/** Плотность сетки — от высоты холста: в маленьком окне клетка крупнее, чтобы не рябило. */
const GRID = { width: 0.1, minU: 52, maxU: 120 };
export function gridDensity(heightPx: number): [number, number] {
  const u = Math.round(Math.min(GRID.maxU, Math.max(GRID.minU, heightPx / 3.2)));
  return [u, Math.round(u * 0.68)];
}

function gridMaterial(grid: { value: [number, number] }): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color('#c4c9d2'), metalness: 0.55, roughness: 0.36 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = grid;
    shader.uniforms.uWidth = { value: GRID.width };
    shader.vertexShader = shader.vertexShader
      .replace('#define STANDARD', '#define STANDARD\nattribute vec2 gridUv;\nvarying vec2 vGridUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGridUv = gridUv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#define STANDARD', '#define STANDARD\nvarying vec2 vGridUv;\nuniform vec2 uGrid;\nuniform float uWidth;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 cell = vGridUv * uGrid;
        vec2 fw = fwidth(cell);
        vec2 d = abs(fract(cell) - 0.5);
        vec2 a = smoothstep(0.5 - uWidth - fw, 0.5 - uWidth + fw * 0.5, d);
        float line = max(a.x, a.y) * (1.0 - smoothstep(0.3, 0.7, max(fw.x, fw.y)));
        diffuseColor.rgb *= mix(1.0, 0.22, line);`,
      );
  };
  m.customProgramCacheKey = () => 'fsp-grid-head';
  return m;
}

function Head({ status, getLevel, reducedMotion }: Head3DProps) {
  const { head, neck } = useMemo(() => buildHeadGeometry(), []);
  const height = useThree((st) => st.size.height);
  const grid = useMemo(() => ({ value: gridDensity(160) }), []);
  useEffect(() => {
    grid.value = gridDensity(height);
  }, [grid, height]);
  const material = useMemo(() => gridMaterial(grid), [grid]);
  const headRef = useRef<Mesh>(null);
  const groupRef = useRef<Group>(null);
  const level = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  // R3F ставит geometry пропом после создания Mesh — словарь морфов собираем явно.
  useLayoutEffect(() => {
    headRef.current?.updateMorphTargets();
  }, [head]);

  useEffect(
    () => () => {
      head.dispose();
      neck.dispose();
      material.dispose();
    },
    [head, neck, material],
  );

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const s = statusRef.current;
    const raw = s === 'speaking' ? getLevel() : 0;
    level.current = smoothLevel(level.current, raw, Math.min(dt, 0.1));
    const mesh = headRef.current;
    const jaw = mesh?.morphTargetDictionary?.[JAW_OPEN];
    if (mesh?.morphTargetInfluences && jaw !== undefined) mesh.morphTargetInfluences[jaw] = mouthOpen(level.current);
    const g = groupRef.current;
    if (!g) return;
    const motion = reducedMotion ? 0 : 1;
    // покой: дыхание и лёгкое покачивание; «думает» — наклон и медленный поворот; говорит — кивки в такт
    const thinking = s === 'thinking' || s === 'loading' ? 1 : 0;
    g.rotation.y = -0.35 + motion * (Math.sin(t * 0.4) * 0.06 + thinking * Math.sin(t * 0.9) * 0.12);
    g.rotation.x = -0.14 + motion * (Math.sin(t * 0.55) * 0.02 + thinking * 0.08 + level.current * 0.25);
    g.rotation.z = motion * thinking * 0.06;
    g.position.y = motion * Math.sin(t * 1.2) * 0.012;
  });

  return (
    <group ref={groupRef}>
      <mesh ref={headRef} geometry={head} material={material} />
      <mesh geometry={neck} material={material} />
    </group>
  );
}

export default function Head3D(props: Head3DProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, -0.18, 4.3], fov: 34 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      aria-hidden="true"
    >
      <hemisphereLight args={['#e8edf5', '#15171c', 0.9]} />
      <directionalLight position={[-2.5, 2.5, 3]} intensity={2.4} />
      <directionalLight position={[3, 1, -2.5]} intensity={1.6} color="#dfe6ff" />
      <directionalLight position={[0, -2, 2]} intensity={0.35} />
      <Head {...props} />
    </Canvas>
  );
}
