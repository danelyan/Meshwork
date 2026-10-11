import { GRADE_LABEL, GRADES, type Grade } from '@/lib/grades';
import type { BankInformation } from '@/server/validation/method';

import { dec } from '../validation/format';

import styles from './Method.module.css';

const W = 680;
const PAD = { l: 44, r: 16, t: 26, b: 34 };
const X_MIN = -3;
const X_MAX = 3;
const X_TICKS = [-3, -2, -1, 0, 1, 2, 3];
const CURVE: Record<Grade, string> = { junior: styles.curveJunior!, middle: styles.curveMiddle!, senior: styles.curveSenior! };

/** «Красивый» верхний предел оси: 1, 2, 2,5, 5 × 10ⁿ. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function frame(h: number, yMax: number) {
  const x = (t: number) => PAD.l + ((W - PAD.l - PAD.r) * (t - X_MIN)) / (X_MAX - X_MIN);
  const y = (v: number) => PAD.t + ((h - PAD.t - PAD.b) * (yMax - Math.min(yMax, Math.max(0, v)))) / yMax;
  return { x, y };
}

function Axes({ h, yTicks, x, y, cuts, yTitle }: { h: number; yTicks: number[]; x: (t: number) => number; y: (v: number) => number; cuts: Record<Grade, number>; yTitle: string }) {
  return (
    <>
      {yTicks.map((t) => (
        <g key={t}>
          <line className={styles.grid} x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
          <text className={styles.axis} x={PAD.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
            {dec(t, 2).replace(/,?0+$/, '')}
          </text>
        </g>
      ))}
      {X_TICKS.map((t) => (
        <text key={t} className={styles.axis} x={x(t)} y={h - 16} textAnchor="middle">
          {t}
        </text>
      ))}
      <text className={styles.axisTitle} x={W - PAD.r} y={h - 2} textAnchor="end">
        уровень кандидата θ
      </text>
      <text className={styles.axisTitle} x={PAD.l} y={12}>
        {yTitle}
      </text>
      {GRADES.map((g, i) => (
        <g key={g}>
          <line className={styles.cut} x1={x(cuts[g])} x2={x(cuts[g])} y1={PAD.t} y2={y(0)} />
          <text className={styles.cutLabel} x={x(cuts[g]) + 4} y={PAD.t + 10 + (i % 2) * 14}>
            {GRADE_LABEL[g]} {dec(cuts[g], 1)}
          </text>
        </g>
      ))}
    </>
  );
}

const path = (xs: readonly number[], ys: readonly number[], x: (t: number) => number, y: (v: number) => number) =>
  xs.map((t, i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(ys[i]!).toFixed(1)}`).join(' ');

/** Информационная функция банка подкатегории по грейдам и потолок одной попытки. Чистый SVG. */
export function InfoChart({ info, cuts, maxItems }: { info: BankInformation; cuts: Record<Grade, number>; maxItems: number }) {
  const H = 320;
  const top = Math.max(...info.best, ...GRADES.flatMap((g) => info.byGrade[g]));
  const yMax = niceMax(top);
  const { x, y } = frame(H, yMax);
  const yTicks = [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax];
  const peakI = info.best[info.thetas.indexOf(info.peakTheta)]!;
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Информация Фишера банка по θ от −3 до 3: кривые заданий Junior, Middle, Senior и сумма ${maxItems} лучших заданий; максимум при θ ${dec(info.peakTheta, 1)}`}
    >
      <Axes h={H} yTicks={yTicks} x={x} y={y} cuts={cuts} yTitle="информация I(θ)" />
      {GRADES.map((g) => (
        <path key={g} className={CURVE[g]} d={path(info.thetas, info.byGrade[g], x, y)} />
      ))}
      <path className={styles.curveBest} d={path(info.thetas, info.best, x, y)} />
      <circle className={styles.peak} cx={x(info.peakTheta)} cy={y(peakI)} r={5} />
      <text className={styles.peakLabel} x={x(info.peakTheta)} y={y(peakI) - 10} textAnchor={info.peakTheta > 1.5 ? 'end' : 'middle'}>
        максимум {dec(peakI, 1)} при θ = {dec(info.peakTheta, 1)}
      </text>
    </svg>
  );
}

/** Стандартная ошибка SE(θ) = 1/√I(θ) для попытки из maxItems лучших заданий и порог точности SE_STOP. */
export function SeChart({ info, cuts, seStop }: { info: BankInformation; cuts: Record<Grade, number>; seStop: number }) {
  const H = 220;
  const yMax = 1;
  const { x, y } = frame(H, yMax);
  const se = info.bestSe.map((v) => Math.min(v, yMax));
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Стандартная ошибка оценки θ по уровню кандидата; порог точности ${dec(seStop, 1)}`}>
      <Axes h={H} yTicks={[0, 0.25, 0.5, 0.75, 1]} x={x} y={y} cuts={cuts} yTitle="SE(θ) = 1/√I(θ)" />
      <line className={styles.seStop} x1={PAD.l} x2={W - PAD.r} y1={y(seStop)} y2={y(seStop)} />
      <text className={styles.seStopLabel} x={W - PAD.r - 4} y={y(seStop) - 6} textAnchor="end">
        SE = {dec(seStop, 1)}
      </text>
      <path className={styles.curveSe} d={path(info.thetas, se, x, y)} />
    </svg>
  );
}
