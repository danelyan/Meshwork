'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

import { initTelemetry, TELEMETRY_EVENT, telemetryOn } from './telemetry';

// Панель грузится отдельным чанком и только при включённом флаге: без флага в бандл чата не попадает.
const TelemetryPanel = dynamic(() => import('./TelemetryPanel').then((m) => m.TelemetryPanel), { ssr: false });

/** Точка монтирования панели телеметрии чата (флаг – telemetry.ts). */
export function TelemetryMount() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    initTelemetry();
    setOn(telemetryOn());
    const sync = () => setOn(telemetryOn());
    window.addEventListener(TELEMETRY_EVENT, sync);
    return () => window.removeEventListener(TELEMETRY_EVENT, sync);
  }, []);
  return on ? <TelemetryPanel /> : null;
}
