'use client';

import { type CSSProperties, useEffect, useRef } from 'react';

import styles from './HeroGraph.module.css';
import { CompanyLogo } from './CompanyLogo';
import { buildGraph } from './graph-model';
const { nodes, edges } = buildGraph();

const SVG_NS = 'http://www.w3.org/2000/svg';

function Silhouette() {
  return (
    <svg viewBox="0 0 44 44" focusable="false" aria-hidden="true">
      <circle cx="22" cy="16" r="8" />
      <path d="M6 44c1.5-10 8-15 16-15s14.5 5 16 15z" />
    </svg>
  );
}

/** Decorative graph with public company examples, without fabricated match scores. */
export function HeroGraph() {
  const demoRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeEls = useRef<Record<string, HTMLDivElement | null>>({});
  const dots = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const demo = demoRef.current;
    const svg = svgRef.current;
    if (!demo || !svg) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const compact = matchMedia('(max-width: 640px)');
    const phase = new Map(nodes.map((n, i) => [n.id, i * 1.37]));
    const lines = edges.map(() => {
      const l = document.createElementNS(SVG_NS, 'line');
      svg.append(l);
      return l;
    });
    lines.forEach((l, i) => edges[i]!.mine && l.setAttribute('class', styles.mine!));

    const visible = (id: string) => nodeEls.current[id]?.offsetParent != null;
    const center = (id: string, box: DOMRect): [number, number] => {
      const r = nodeEls.current[id]!.getBoundingClientRect();
      return [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2];
    };

    const draw = (t: number, float: boolean) => {
      const T = t / 1000;
      if (float && !compact.matches) {
        for (const n of nodes) {
          const el = nodeEls.current[n.id];
          const ph = phase.get(n.id) ?? 0;
          if (el) el.style.translate = `${(Math.sin(T * 0.55 + ph) * 7).toFixed(1)}px ${(Math.cos(T * 0.45 + ph * 1.3) * 7).toFixed(1)}px`;
        }
      } else {
        for (const n of nodes) nodeEls.current[n.id]?.style.removeProperty('translate');
      }
      const box = demo.getBoundingClientRect();
      edges.forEach((e, i) => {
        const l = lines[i]!;
        if (!visible(e.a) || !visible(e.b)) {
          l.style.display = 'none';
          return;
        }
        l.style.display = '';
        const [ax, ay] = center(e.a, box);
        const [bx, by] = center(e.b, box);
        l.setAttribute('x1', String(ax));
        l.setAttribute('y1', String(ay));
        l.setAttribute('x2', String(bx));
        l.setAttribute('y2', String(by));
        const dot = dots.current[i];
        if (dot) {
          const q = (T * 0.22 + i * 0.17) % 1;
          dot.style.left = `${ax + (bx - ax) * q}px`;
          dot.style.top = `${ay + (by - ay) * q}px`;
        }
      });
    };

    let raf = 0;
    const loop = (t: number) => {
      draw(t, true);
      raf = requestAnimationFrame(loop);
    };
    const redrawStatic = () => draw(0, false);
    if (reduce.matches) redrawStatic();
    else raf = requestAnimationFrame(loop);
    // при reduced-motion кадров нет: перерисовка на ресайз и смену раскладки
    if (reduce.matches) {
      window.addEventListener('resize', redrawStatic);
      compact.addEventListener('change', redrawStatic);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', redrawStatic);
      compact.removeEventListener('change', redrawStatic);
      lines.forEach((l) => l.remove());
    };
  }, []);

  return (
    <div className={styles.demo} ref={demoRef} aria-hidden="true">
      <svg className={styles.edges} ref={svgRef} />
      {nodes.map((n) => {
        const style = {
          '--x': `${n.pos[0]}%`,
          '--y': `${n.pos[1]}%`,
          ...(n.mobile ? { '--mx': `${n.mobile[0]}%`, '--my': `${n.mobile[1]}%` } : {}),
        } as CSSProperties;
        return (
          <div
            key={n.id}
            ref={(el) => {
              nodeEls.current[n.id] = el;
            }}
            className={`${styles.n} ${styles[n.kind]} ${n.mobile ? '' : styles.desktopOnly}`}
            style={style}
          >
            {n.kind === 'me' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/landing/person-0.webp" alt="" />
            )}
            {n.kind === 'co' && <CompanyLogo company={{ name: n.label ?? '', logoSrc: n.logoSrc }} className={styles.companyLogo} />}
            {n.kind === 'st' && <Silhouette />}
            {n.label && <span>{n.label}</span>}
          </div>
        );
      })}
      {edges.map((e, i) =>
        e.mine ? (
          <div key={`${e.a}-${e.b}`}>
            <div
              className={styles.dot}
              ref={(el) => {
                dots.current[i] = el;
              }}
            />
          </div>
        ) : null,
      )}
    </div>
  );
}
