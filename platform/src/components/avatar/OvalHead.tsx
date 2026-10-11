'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

import { MarkFallback } from './MarkFallback';
import { hasWebGL } from './webgl';

const OvalHeadCanvas = dynamic(() => import('./OvalHeadCanvas'), { ssr: false });

const silent = () => 0;

/** Болванчик для 404: three.js грузится лениво; без WebGL — знак ФСП. */
export function OvalHead({ avoidPointer = false, reducedMotion: fixedReduced }: { avoidPointer?: boolean; reducedMotion?: boolean } = {}) {
  const [mode, setMode] = useState<'pending' | 'webgl' | 'fallback'>('pending');
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setMode(hasWebGL() ? 'webgl' : 'fallback');
    if (typeof window.matchMedia === 'function') setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  if (mode === 'pending') return null;
  if (mode === 'fallback') return <MarkFallback status="idle" getLevel={silent} />;
  return <OvalHeadCanvas reducedMotion={fixedReduced ?? reducedMotion} avoidPointer={avoidPointer} />;
}
