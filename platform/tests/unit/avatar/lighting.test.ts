import { describe, expect, it } from 'vitest';

import { DEFAULT_LIGHTING, type DirectionalSpec, isLightingPreset, LIGHTING_PRESETS, lightRig } from '@/components/avatar/lighting';

describe('lighting presets', () => {
  it('keeps the previous lamps as the default preset', () => {
    expect(DEFAULT_LIGHTING).toBe('current');
    const rig = lightRig();
    expect(rig.environment).toBe(0.85);
    expect(rig.hemisphere).toEqual({
      sky: '#e8edf5',
      ground: '#15171c',
      intensity: 0.5,
    });
    expect(rig.directional.map((d) => [d.position, d.intensity])).toEqual([
      [[-2.5, 2.5, 3], 1.8],
      [[3, 1, -2.5], 1.4],
      [[0, -2, 2], 0.3],
    ]);
  });

  it('has unique ids, labels and at least four presets', () => {
    const ids = LIGHTING_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['current', 'studio', 'soft', 'rim']));
    for (const p of LIGHTING_PRESETS) expect(p.label.length).toBeGreaterThan(0);
  });

  it('studio: key from top-right-front, weak fill from the left, rim behind, dark studio environment', () => {
    const rig = lightRig('studio');
    const [key, fill, rim] = rig.directional as [DirectionalSpec, DirectionalSpec, DirectionalSpec];
    expect(key.position[0]).toBeGreaterThan(0);
    expect(key.position[1]).toBeGreaterThan(0);
    expect(key.position[2]).toBeGreaterThan(0);
    expect(fill.position[0]).toBeLessThan(0);
    expect(fill.intensity).toBeLessThan(key.intensity / 5);
    expect(rim.position[2]).toBeLessThan(0);
    // окружение – тёмная студия: стены почти чёрные, самый яркий софтбокс сверху-справа-спереди
    expect(rig.softbox?.wall).toBeLessThan(0.05);
    const brightest = [...(rig.softbox?.softboxes ?? [])].sort((a, b) => b.intensity - a.intensity)[0];
    expect(brightest?.position.every((v) => v > 0)).toBe(true);
  });

  it('only the current preset keeps RoomEnvironment', () => {
    expect(lightRig('current').softbox).toBeUndefined();
    for (const id of ['studio', 'soft', 'rim'] as const) expect(lightRig(id).softbox).toBeDefined();
  });

  it('soft studio fills the shadow side more than studio', () => {
    const studio = lightRig('studio');
    const soft = lightRig('soft');
    expect(soft.directional[1]?.intensity).toBeGreaterThan(studio.directional[1]?.intensity ?? Infinity);
    expect(soft.softbox?.wall).toBeGreaterThan(studio.softbox?.wall ?? Infinity);
  });

  it('validates preset ids and falls back to the default', () => {
    expect(isLightingPreset('studio')).toBe(true);
    expect(isLightingPreset('nope')).toBe(false);
    expect(lightRig('nope' as never)).toBe(lightRig('current'));
  });
});
