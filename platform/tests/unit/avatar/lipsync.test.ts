import { describe, expect, it } from 'vitest';

import { BAND_PRIOR, BANDS, classifyViseme, LipSync, smoothShape, type SpectrumFeatures, spectrumFeatures, VISEME_SHAPE } from '@/components/avatar/lipsync';

const BIN = 46.875; // 48 кГц / 1024

/** Спектр из амплитуд полос (0…1) — для синтетических кадров. */
function spectrum(levels: number[]): Uint8Array {
  const freq = new Uint8Array(512);
  BANDS.forEach(([start, end], i) => {
    for (let b = Math.round(start / BIN); b < Math.round(end / BIN); b++) freq[b] = Math.round((levels[i] ?? 0) * 255);
  });
  return freq;
}
/** Полосы как отношения к среднему голоса SpeechKit (1 = как в среднем). */
const ratio = (r: number[]) => r.map((v, i) => Math.min(1, v * (BAND_PRIOR[i] ?? 0.3)));
const feat = (levels: number[]): SpectrumFeatures => spectrumFeatures(spectrum(levels), BIN);
const same = (r: number[]) => classifyViseme(feat(ratio(r)), feat(ratio(r)));

describe('признаки спектра', () => {
  it('тишина → нулевые полосы и центроид 0', () => {
    const f = spectrumFeatures(new Uint8Array(512), BIN);
    expect(f.volume).toBe(0);
    expect(f.centroid).toBe(0);
  });
  it('энергия в полосе → её амплитуда и центроид внутри полосы', () => {
    const f = feat([0, 0, 0, 1, 0, 0, 0]);
    expect(f.bands[3]).toBeCloseTo(1, 1);
    expect(f.centroid).toBeGreaterThan(800);
    expect(f.centroid).toBeLessThan(1500);
  });
});

describe('висемы по нормированным полосам (замер SpeechKit, research/20)', () => {
  it('тишина', () => expect(same([0, 0, 0, 0, 0, 0, 0])).toBe('sil'));
  it('«а»: F2 800–1500 выше среднего, 1500–2500 — нет', () => expect(same([1.1, 1.0, 1.1, 1.5, 0.8, 0.6, 0.4])).toBe('aa'));
  it('«и»: 1500–2500 высоко, F2 передняя обычная', () => expect(same([0.9, 0.9, 0.9, 1.0, 1.6, 1.2, 0.8])).toBe('I'));
  it('«э»: обе полосы F2 высоко', () => expect(same([1.0, 1.1, 1.2, 1.5, 1.5, 1.1, 0.9])).toBe('E'));
  it('«о»/«у»: только низ, центроид низкий', () => {
    expect(same([0.9, 1.1, 1.1, 0.9, 0.05, 0.01, 0])).toBe('O');
    expect(same([0.9, 0.9, 0.8, 0.4, 0.05, 0.01, 0])).toBe('U');
  });
  it('шипящие: верхняя полоса вдвое выше среднего, центроид высокий', () => expect(same([0.5, 0.6, 0.6, 0.7, 1.0, 1.4, 2.6])).toBe('SS'));
  it('затухание слога — смычка', () => expect(same([0.5, 0.5, 0.5, 0.3, 0.3, 0.1, 0.05])).toBe('nn'));
  it('взрывной: скачок центроида после тихого кадра', () => {
    const quiet = feat([0.02, 0.02, 0.02, 0.02, 0.01, 0, 0]);
    expect(classifyViseme(feat([0, 0, 0, 0.05, 0.1, 0.3, 0.6]), quiet)).toBe('DD');
    expect(classifyViseme(feat([0.1, 0.3, 0.4, 0.4, 0.3, 0.1, 0.05]), quiet)).toBe('PP');
  });
});

describe('LipSync', () => {
  it('держит висему минимум 70 мс, в тишину уходит сразу, нормировка тянется к голосу', () => {
    const lip = new LipSync(BIN);
    const a = spectrum(ratio([1.1, 1.0, 1.1, 1.5, 0.8, 0.6, 0.4]));
    for (let i = 0; i < 5; i++) lip.update(a, 1 / 60);
    expect(lip.viseme).toBe('aa');
    expect(lip.shape).toEqual(VISEME_SHAPE.aa);
    expect(lip.norm[3]).toBeGreaterThan(BAND_PRIOR[3]!);
    lip.update(spectrum(ratio([0.9, 0.9, 0.9, 1.0, 1.6, 1.2, 0.8])), 1 / 60);
    expect(lip.viseme).toBe('aa'); // ещё не прошло 70 мс
    lip.update(new Uint8Array(512), 1 / 60);
    expect(lip.viseme).toBe('sil');
    lip.reset();
    expect(lip.norm).toEqual([...BAND_PRIOR]);
  });
});

describe('сглаживание формы', () => {
  it('открывается быстрее, чем закрывается', () => {
    const up = smoothShape(VISEME_SHAPE.sil, VISEME_SHAPE.aa, 1 / 60);
    const down = smoothShape(VISEME_SHAPE.aa, VISEME_SHAPE.sil, 1 / 60);
    expect(up.open).toBeGreaterThan(1 - down.open);
    expect(smoothShape(VISEME_SHAPE.aa, VISEME_SHAPE.sil, 0)).toBe(VISEME_SHAPE.aa);
  });
});
