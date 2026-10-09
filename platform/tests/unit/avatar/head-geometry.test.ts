import { buildHeadGeometry, JAW_OPEN } from '@/components/avatar/head-geometry';

describe('процедурная голова', () => {
  const { head, neck } = buildHeadGeometry(48, 36);
  const pos = head.getAttribute('position');
  const open = head.morphAttributes.position![0]!;

  it('морф jawOpen с нормалями и атрибут сетки', () => {
    expect(open.name).toBe(JAW_OPEN);
    expect(head.morphAttributes.normal![0]!.count).toBe(pos.count);
    expect(head.getAttribute('gridUv').count).toBe(pos.count);
    expect(neck.getAttribute('gridUv').count).toBe(neck.getAttribute('position').count);
  });

  it('морф двигает только нижнюю часть лица: подбородок опускается, макушка на месте', () => {
    let chinDrop = 0;
    let crownMove = 0;
    for (let i = 0; i < pos.count; i++) {
      const dy = open.getY(i) - pos.getY(i);
      const dz = open.getZ(i) - pos.getZ(i);
      if (pos.getY(i) > 0.3) crownMove = Math.max(crownMove, Math.hypot(dy, dz));
      if (pos.getZ(i) > 0.3 && pos.getY(i) < -0.6) chinDrop = Math.min(chinDrop, dy);
    }
    expect(crownMove).toBeLessThan(1e-3);
    expect(chinDrop).toBeLessThan(-0.05);
  });

  it('лицо смотрит в +Z: нос — самая выступающая точка спереди', () => {
    let maxZ = -Infinity;
    let atY = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) > maxZ) {
        maxZ = pos.getZ(i);
        atY = pos.getY(i);
      }
    }
    expect(maxZ).toBeGreaterThan(0.9);
    expect(atY).toBeGreaterThan(-0.3);
    expect(atY).toBeLessThan(0.2);
  });
});
