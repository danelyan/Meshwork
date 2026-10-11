'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, type Group, type Mesh, MeshStandardMaterial } from 'three';

import { buildHeadGeometry, JAW_OPEN } from './head-geometry';

/**
 * «Овальный болванчик» — первая версия головы компаньона (процедурная, коммит ca1c7ca2, 09.10) для страницы 404.
 * Металл MeshStandardMaterial + квадратная сетка по `gridUv` в фрагментном шейдере, как в первой версии Head3D.
 * Поза: рот приоткрыт, голова покачивается и время от времени мотает «нет». Грузится только через next/dynamic({ ssr: false }).
 */
const GRID: [number, number] = [96, 65];

function gridMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color('#c4c9d2'), metalness: 0.55, roughness: 0.36 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = { value: GRID };
    shader.uniforms.uWidth = { value: 0.1 };
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
  m.customProgramCacheKey = () => 'fsp-oval-head-404';
  return m;
}

function Head({ reducedMotion }: { reducedMotion: boolean }) {
  const { head, neck } = useMemo(() => buildHeadGeometry(), []);
  const material = useMemo(() => gridMaterial(), []);
  const headRef = useRef<Mesh>(null);
  const groupRef = useRef<Group>(null);

  useLayoutEffect(() => {
    const mesh = headRef.current;
    if (!mesh) return;
    mesh.updateMorphTargets();
    const jaw = mesh.morphTargetDictionary?.[JAW_OPEN];
    if (mesh.morphTargetInfluences && jaw !== undefined) mesh.morphTargetInfluences[jaw] = 0.35;
  }, [head]);

  useEffect(
    () => () => {
      head.dispose();
      neck.dispose();
      material.dispose();
    },
    [head, neck, material],
  );

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const motion = reducedMotion ? 0 : 1;
    // каждые 6 с — короткое «нет»: затухающее покачивание по Y длиной 1.4 с
    const phase = t % 6;
    const shake = phase < 1.4 ? Math.sin(phase * 14) * 0.22 * (1 - phase / 1.4) : 0;
    g.rotation.y = -0.35 + motion * (Math.sin(t * 0.4) * 0.06 + shake);
    g.rotation.x = -0.1 + motion * Math.sin(t * 0.55) * 0.03;
    g.rotation.z = 0.05 + motion * Math.sin(t * 0.3) * 0.02;
    g.position.y = motion * Math.sin(t * 1.2) * 0.012;
  });

  return (
    <group ref={groupRef}>
      <mesh ref={headRef} geometry={head} material={material} />
      <mesh geometry={neck} material={material} />
    </group>
  );
}

export default function OvalHeadCanvas({ reducedMotion = false }: { reducedMotion?: boolean }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, -0.3, 4.6], fov: 34 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      aria-hidden="true"
    >
      <hemisphereLight args={['#e8edf5', '#15171c', 0.9]} />
      <directionalLight position={[-2.5, 2.5, 3]} intensity={2.4} />
      <directionalLight position={[3, 1, -2.5]} intensity={1.6} color="#dfe6ff" />
      <directionalLight position={[0, -2, 2]} intensity={0.35} />
      <Head reducedMotion={reducedMotion} />
    </Canvas>
  );
}
