import type { Grade } from '@/lib/grades';
import { GRADE_LABEL } from '@/lib/grades';
import type { SimResult } from '@/server/validation/simulator';

import { dec } from '../validation/format';

import styles from './Simulator.module.css';

const W = 640;
const H = 300;
const PAD = { l: 44, r: 84, t: 14, b: 30 };
const Y_MIN = -3;
const Y_MAX = 3;

const clamp = (v: number) => Math.max(Y_MIN, Math.min(Y_MAX, v));

/** График θ̂ ± SE по шагам и горизонтальные линии порогов грейдов. Чистый SVG, без библиотек. */
export function ThetaChart({ result }: { result: Pick<SimResult, 'steps' | 'start' | 'cuts' | 'input'> }) {
  const { steps, start, cuts, input } = result;
  const points = [{ n: 0, theta: start.theta, se: start.se, correct: null as boolean | null }, ...steps.map((s) => ({ n: s.n, theta: s.theta, se: s.se, correct: s.correct as boolean | null }))];
  const last = Math.max(1, points[points.length - 1]!.n);
  const x = (n: number) => PAD.l + ((W - PAD.l - PAD.r) * n) / last;
  const y = (v: number) => PAD.t + ((H - PAD.t - PAD.b) * (Y_MAX - clamp(v))) / (Y_MAX - Y_MIN);
  const upper = points.map((p) => `${x(p.n)},${y(p.theta + p.se)}`);
  const lower = points.map((p) => `${x(p.n)},${y(p.theta - p.se)}`).reverse();
  const line = points.map((p) => `${x(p.n)},${y(p.theta)}`).join(' ');
  const grades: Grade[] = ['junior', 'middle', 'senior'];
  const ticks = [-3, -2, -1, 0, 1, 2, 3];
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`График оценки θ по ${steps.length} шагам с доверительной полосой ±SE и порогами грейдов; итоговая оценка ${dec(points[points.length - 1]!.theta, 2)}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className={styles.grid} x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
          <text className={styles.axis} x={PAD.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
            {t}
          </text>
        </g>
      ))}
      {points.map((p) => (
        <text key={p.n} className={styles.axis} x={x(p.n)} y={H - 10} textAnchor="middle">
          {p.n}
        </text>
      ))}
      {grades.map((g) => (
        <g key={g}>
          <line className={styles.cut} x1={PAD.l} x2={W - PAD.r} y1={y(cuts[g])} y2={y(cuts[g])} />
          <text className={styles.cutLabel} x={W - PAD.r + 6} y={y(cuts[g])} dominantBaseline="middle">
            {GRADE_LABEL[g]} {dec(cuts[g], 1)}
          </text>
        </g>
      ))}
      <line className={styles.truth} x1={PAD.l} x2={W - PAD.r} y1={y(input.theta)} y2={y(input.theta)} />
      <text className={styles.truthLabel} x={W - PAD.r + 6} y={y(input.theta) + 14} dominantBaseline="middle">
        истина {dec(input.theta, 1)}
      </text>
      <polygon className={styles.band} points={[...upper, ...lower].join(' ')} />
      <polyline className={styles.thetaLine} points={line} fill="none" />
      {points.map((p) =>
        p.correct === null ? (
          <circle key={p.n} className={styles.dotStart} cx={x(p.n)} cy={y(p.theta)} r={4} />
        ) : (
          <circle key={p.n} className={p.correct ? styles.dotOk : styles.dotBad} cx={x(p.n)} cy={y(p.theta)} r={5} />
        ),
      )}
    </svg>
  );
}
