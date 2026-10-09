import { describe, expect, it } from 'vitest';

import { DEFAULT_HEAD_STYLE, HEAD_STYLES, isHeadStyle, styleIndex } from '@/components/avatar/head-styles';
import { gridDensity, HEAD_MODEL, jawWeight, sphericalGrid } from '@/components/avatar/Head3D';

describe('head-styles', () => {
  it('стиль по умолчанию — сетка-металл по референсу, id уникальны', () => {
    expect(DEFAULT_HEAD_STYLE).toBe('grid');
    expect(new Set(HEAD_STYLES.map((s) => s.id)).size).toBe(HEAD_STYLES.length);
    expect(styleIndex('metal')).toBe(0);
    expect(isHeadStyle('particles')).toBe(true);
    expect(isHeadStyle('neon')).toBe(false);
  });
});

describe('процедурная челюсть', () => {
  it('двигает подбородок, не трогает лоб, шею и затылок', () => {
    expect(jawWeight(HEAD_MODEL.chinY + 0.05, 0.2)).toBeGreaterThan(0.9); // подбородок спереди
    expect(jawWeight(HEAD_MODEL.mouthY + 0.2, 0.2)).toBe(0); // лоб
    expect(jawWeight(HEAD_MODEL.chinY - 0.1, 0.2)).toBe(0); // шея
    expect(jawWeight(HEAD_MODEL.chinY + 0.05, -0.3)).toBe(0); // затылок
  });

  it('ось челюсти выше рта, рот выше подбородка', () => {
    expect(HEAD_MODEL.jawPivotY).toBeGreaterThan(HEAD_MODEL.mouthY);
    expect(HEAD_MODEL.mouthY).toBeGreaterThan(HEAD_MODEL.chinY);
  });
});

describe('плотность сетки', () => {
  it('ограничена снизу и сверху, у GLB широт меньше', () => {
    expect(gridDensity(50)[0]).toBe(80);
    expect(gridDensity(5000)[0]).toBe(230);
    const g = gridDensity(320);
    expect(sphericalGrid(g)[0]).toBe(g[0]);
    expect(sphericalGrid(g)[1]).toBeLessThan(g[1]);
  });
});
